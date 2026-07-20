/**
 * Sameko Dev C++ IDE - GDB/MI Debug Session
 *
 * Owns ONE gdb process driven over Machine Interface v3. Pure Node core
 * (child_process / fs / os / path / events) — no Electron — so it is testable
 * headless and has a single, well-defined lifecycle.
 *
 * Design: every feature (locals, watch, hover, breakpoints, stepping) is a thin
 * wrapper over the same `send()` primitive + variable objects. There is only
 * ONE command/response mechanism (token-correlated promises) and ONE output
 * pump. Nothing bypasses them.
 *
 * Events (EventEmitter):
 *   'ready'        ()                         gdb up, pretty-printing enabled
 *   'stopped'      ({reason,frame,threadId,results})
 *   'running'      ()
 *   'programOut'   (text)                     inferior stdout/stderr
 *   'console'      (text)                     gdb console stream (~)
 *   'log'          (text)                     gdb log stream (&) — dev only
 *   'notify'       ({class,results})          =breakpoint-modified, etc.
 *   'programExited'({code})                   inferior exited
 *   'terminated'   ({code})                   gdb process itself exited
 *   'error'        (Error)
 *
 * @module app/services/debugger/gdb-session
 */

'use strict';

const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseLine } = require('./mi-parser');

const COMMAND_TIMEOUT_MS = 20000; // guard against a wedged gdb; generous for big containers

class GdbSession extends EventEmitter {
    /**
     * @param {Object} cfg
     * @param {string} cfg.gdbPath           absolute path to gdb.exe
     * @param {string} cfg.exePath           absolute path to the (-g compiled) target
     * @param {string} [cfg.printerPythonDir] dir containing libstdcxx/v6/printers.py
     * @param {string} [cfg.cwd]             working dir for the inferior
     * @param {Object} [cfg.env]             environment for gdb
     */
    constructor(cfg) {
        super();
        this.cfg = cfg;
        this.proc = null;
        this.seq = 0;
        this.pending = new Map();       // token -> {resolve,reject,timer}
        this.stdoutBuf = '';
        this.state = 'idle';            // idle|starting|running|stopped|terminated
        this.disposed = false;
        this._initFile = null;
        this._stdinFile = null;
        // Inferior stdout/stderr are redirected to dedicated files so the MI
        // pipe carries ONLY protocol. Sharing the pipe let newline-less program
        // output merge with the next MI record and corrupt both.
        this._stdoutFile = null;
        this._stderrFile = null;
        this._outOffset = 0;
        this._errOffset = 0;
        this._pumpTimer = null;
    }

    // ---- lifecycle ---------------------------------------------------------

    /** Spawn gdb, load pretty-printers, enable MI pretty-printing. Resolves when ready. */
    async start() {
        if (this.proc) throw new Error('Session already started');
        this.state = 'starting';
        this._initFile = this._writeInitFile();

        const args = ['--interpreter=mi3', '-nx'];
        if (this._initFile) args.push('-x', this._initFile);
        args.push(this.cfg.exePath);

        this.proc = spawn(this.cfg.gdbPath, args, {
            cwd: this.cfg.cwd || path.dirname(this.cfg.exePath),
            env: this.cfg.env || process.env,
            windowsHide: true,
        });

        this.proc.stdout.on('data', (d) => this._onStdout(d));
        this.proc.stderr.on('data', (d) => this.emit('log', d.toString()));
        this.proc.on('error', (err) => {
            this.emit('error', err);
            this._failAllPending(err);
        });
        this.proc.on('exit', (code) => {
            this.state = 'terminated';
            this._failAllPending(new Error('gdb exited'));
            this.emit('terminated', { code });
            this._cleanupTempFiles();
        });

        // Enable pretty-printing for variable objects (REQUIRED for STL trees).
        // Registration of the printers themselves happens in the init file.
        await this.send('-enable-pretty-printing');
        // Sensible, CP-safe defaults.
        await this.send('-gdb-set print elements 200');
        await this.send('-gdb-set print repeats 100');
        this.emit('ready');
    }

    _writeInitFile() {
        const lines = [];
        const pdir = this.cfg.printerPythonDir;
        if (pdir && fs.existsSync(pdir)) {
            const posix = pdir.replace(/\\/g, '/');
            lines.push(
                'python',
                'import sys',
                `sys.path.insert(0, r'${posix}')`,
                'try:',
                '    from libstdcxx.v6.printers import register_libstdcxx_printers',
                '    register_libstdcxx_printers(None)',
                'except Exception as e:',
                "    print('sameko: printer registration failed:', e)",
                'end',
            );
        }
        lines.push(
            'set print pretty on',
            'set print static-members off',
            'set print thread-events off',
            'set pagination off',
            'set confirm off',
            '',
        );
        try {
            const file = path.join(os.tmpdir(), `sameko-gdbinit-${process.pid}-${Date.now()}.gdb`);
            fs.writeFileSync(file, lines.join('\n'), 'utf8');
            return file;
        } catch (_) {
            return null; // gdb still works, just without pretty printers
        }
    }

    // ---- command / response primitive -------------------------------------

    /**
     * Send one MI command; resolve with its result record (`^done` etc.),
     * reject on `^error` or timeout. This is the ONLY way commands are issued.
     * @param {string} cmd  MI command WITHOUT leading token or trailing newline
     * @returns {Promise<Object>} the parsed result-record `results` object
     */
    send(cmd) {
        return new Promise((resolve, reject) => {
            if (!this.proc || this.state === 'terminated' || this.disposed) {
                return reject(new Error('gdb session not running'));
            }
            const token = ++this.seq;
            const timer = setTimeout(() => {
                this.pending.delete(token);
                reject(new Error(`MI command timed out: ${cmd}`));
            }, COMMAND_TIMEOUT_MS);
            this.pending.set(token, { resolve, reject, timer, cmd });
            try {
                this.proc.stdin.write(`${token}${cmd}\n`);
            } catch (err) {
                clearTimeout(timer);
                this.pending.delete(token);
                reject(err);
            }
        });
    }

    _onStdout(chunk) {
        this.stdoutBuf += chunk.toString();
        let idx;
        while ((idx = this.stdoutBuf.indexOf('\n')) !== -1) {
            const line = this.stdoutBuf.slice(0, idx).replace(/\r$/, '');
            this.stdoutBuf = this.stdoutBuf.slice(idx + 1);
            if (line.length) this._dispatch(line);
        }
    }

    _dispatch(line) {
        let rec;
        try { rec = parseLine(line); }
        catch (_) { this.emit('programOut', line + '\n'); return; }

        switch (rec.type) {
            case 'result': {
                const p = this.pending.get(rec.token);
                if (p) {
                    this.pending.delete(rec.token);
                    clearTimeout(p.timer);
                    if (rec.class === 'error') {
                        p.reject(new MiError(rec.results && rec.results.msg, p.cmd, rec.results));
                    } else {
                        p.resolve(rec.results || {});
                    }
                }
                break;
            }
            case 'exec': {
                if (rec.class === 'running') {
                    this.state = 'running';
                    this.emit('running');
                } else if (rec.class === 'stopped') {
                    this._onStopped(rec.results || {});
                }
                break;
            }
            case 'notify':
                this.emit('notify', { class: rec.class, results: rec.results });
                if (rec.class === 'thread-group-exited') { /* handled by *stopped */ }
                break;
            case 'stream':
                if (rec.stream === 'console') this.emit('console', rec.text);
                else if (rec.stream === 'target') this.emit('programOut', rec.text);
                else this.emit('log', rec.text);
                break;
            case 'output':
                // Program I/O is redirected to files, so the MI pipe carries
                // ONLY protocol. A bare/unparsed line here is gdb noise (an
                // async class we don't model) — surface as a log, never as
                // program output, so it can't pollute the terminal.
                this.emit('log', rec.text + '\n');
                break;
            case 'prompt':
            case 'status':
            default:
                break;
        }
    }

    _onStopped(results) {
        const reason = results.reason || '';
        if (reason.startsWith('exited')) {
            this.state = 'stopped';
            this._stopPump(); // flush remaining program output before signalling exit
            const code = results['exit-code'] !== undefined
                ? parseInt(results['exit-code'], 10)
                : (reason === 'exited-normally' ? 0 : null);
            this.emit('programExited', { code });
            return;
        }
        this.state = 'stopped';
        const frame = results.frame || null;
        this.emit('stopped', {
            reason,
            frame,
            threadId: results['thread-id'] || null,
            results,
        });
    }

    // ---- high-level operations (all thin wrappers over send) ---------------

    /**
     * Insert a breakpoint using explicit-location options (`--source/--line`),
     * which are unambiguous for Windows paths (spaces and the `C:` drive colon
     * both survive, unlike the `file:line` linespec form).
     * @returns {Promise<{id:number, line:number, raw:Object}>}
     */
    async setBreakpoint(file, line, condition) {
        let cmd = '-break-insert';
        if (condition && condition.trim()) cmd += ` -c ${quote(condition.trim())}`;
        cmd += ` --source ${quote(toPosix(file))} --line ${line}`;
        const r = await this.send(cmd);
        const bkpt = r.bkpt || {};
        return { id: parseInt(bkpt.number, 10), line: parseInt(bkpt.line, 10), raw: bkpt };
    }

    removeBreakpoint(id) { return this.send(`-break-delete ${id}`); }
    enableBreakpoint(id) { return this.send(`-break-enable ${id}`); }
    disableBreakpoint(id) { return this.send(`-break-disable ${id}`); }
    setCondition(id, cond) {
        return this.send(`-break-condition ${id}${cond ? ' ' + cond : ''}`);
    }

    /**
     * Run the inferior. stdin (if any) is fed from a temp file, and stdout+stderr
     * are redirected to temp files (`< in > out 2> err`) so program I/O never
     * touches the MI pipe. Output is streamed back by polling those files.
     */
    async run(stdinContent) {
        const stamp = `${process.pid}-${Date.now()}`;
        const redirs = [];
        if (typeof stdinContent === 'string' && stdinContent.length) {
            this._stdinFile = path.join(os.tmpdir(), `sameko-stdin-${stamp}.txt`);
            fs.writeFileSync(this._stdinFile, stdinContent, 'utf8');
            redirs.push(`< ${quote(this._stdinFile)}`);
        }
        this._stdoutFile = path.join(os.tmpdir(), `sameko-stdout-${stamp}.txt`);
        this._stderrFile = path.join(os.tmpdir(), `sameko-stderr-${stamp}.txt`);
        fs.writeFileSync(this._stdoutFile, '');
        fs.writeFileSync(this._stderrFile, '');
        this._outOffset = 0;
        this._errOffset = 0;
        redirs.push(`> ${quote(this._stdoutFile)}`, `2> ${quote(this._stderrFile)}`);

        await this.send(`-exec-arguments ${redirs.join(' ')}`);
        this._startPump();
        return this.send('-exec-run');
    }

    _startPump() {
        if (this._pumpTimer) return;
        this._pumpTimer = setInterval(() => this._pump(), 120);
    }
    _stopPump() {
        if (this._pumpTimer) { clearInterval(this._pumpTimer); this._pumpTimer = null; }
        this._pump(); // final flush
    }
    _pump() {
        this._readDelta(this._stdoutFile, 'out');
        this._readDelta(this._stderrFile, 'err');
    }
    _readDelta(file, which) {
        if (!file) return;
        try {
            const size = fs.statSync(file).size;
            const off = which === 'out' ? this._outOffset : this._errOffset;
            if (size <= off) return;
            const len = size - off;
            const buf = Buffer.alloc(len);
            const fd = fs.openSync(file, 'r');
            try { fs.readSync(fd, buf, 0, len, off); } finally { fs.closeSync(fd); }
            if (which === 'out') this._outOffset = size; else this._errOffset = size;
            this.emit('programOut', buf.toString());
        } catch (_) { /* file not ready / race — next tick */ }
    }

    cont() { return this.send('-exec-continue'); }
    next() { return this.send('-exec-next'); }
    step() { return this.send('-exec-step'); }
    finish() { return this.send('-exec-finish'); }
    interrupt() { return this.send('-exec-interrupt'); }
    /**
     * Run to a specific line ("Run to Cursor"). Implemented as a *temporary*
     * breakpoint at the explicit location (`--source/--line`) followed by
     * continue, which is far more robust on Windows than an `-exec-until`
     * linespec — the latter has to parse a `file:line` string whose `C:` drive
     * colon is ambiguous. The temp breakpoint auto-deletes when hit, and unlike
     * `-exec-until` it reliably stops on the target even across loop iterations.
     */
    async runToLine(file, line) {
        await this.send(`-break-insert -t --source ${quote(toPosix(file))} --line ${line}`);
        return this.send('-exec-continue');
    }

    listFrames() { return this.send('-stack-list-frames'); }
    selectFrame(n) { return this.send(`-stack-select-frame ${n}`); }
    listLocals() { return this.send('-stack-list-variables --all-values'); }
    listLocalNames() { return this.send('-stack-list-variables --no-values'); }

    /** One-shot evaluate (hover / quick watch). Never creates a varobj. */
    evaluate(expr) { return this.send(`-data-evaluate-expression ${quote(expr)}`); }

    // Variable objects — the engine behind Locals / Watch trees.
    varCreate(name, expr) { return this.send(`-var-create ${name} * ${quote(expr)}`); }
    varDelete(name) { return this.send(`-var-delete ${name}`); }
    varListChildren(name, from, to) {
        let cmd = `-var-list-children --all-values ${name}`;
        if (Number.isInteger(from) && Number.isInteger(to)) cmd += ` ${from} ${to}`;
        return this.send(cmd);
    }
    varUpdate() { return this.send('-var-update --all-values *'); }
    varSetFormat(name, fmt) { return this.send(`-var-set-format ${name} ${fmt}`); }

    // ---- teardown ----------------------------------------------------------

    /** Gracefully quit gdb, then hard-kill the process tree so no inferior leaks. */
    async dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this._stopPump();
        const pid = this.proc && this.proc.pid;
        try { if (this.proc && this.proc.stdin.writable) this.proc.stdin.write('-gdb-exit\n'); } catch (_) { }

        await new Promise((resolve) => {
            let done = false;
            const finish = () => { if (!done) { done = true; resolve(); } };
            if (this.proc) this.proc.once('exit', finish);
            setTimeout(finish, 800);
        });

        if (pid && process.platform === 'win32') {
            // /t kills the whole tree (gdb + inferior); ignore errors.
            try { execFile('taskkill', ['/pid', String(pid), '/f', '/t']); } catch (_) { }
        }
        try { if (this.proc) this.proc.kill('SIGKILL'); } catch (_) { }
        this._failAllPending(new Error('session disposed'));
        this._cleanupTempFiles();
        this.proc = null;
        this.state = 'terminated';
    }

    _failAllPending(err) {
        for (const { reject, timer } of this.pending.values()) {
            clearTimeout(timer);
            try { reject(err); } catch (_) { }
        }
        this.pending.clear();
    }

    _cleanupTempFiles() {
        for (const f of [this._initFile, this._stdinFile, this._stdoutFile, this._stderrFile]) {
            if (f) { try { fs.unlinkSync(f); } catch (_) { } }
        }
        this._initFile = null;
        this._stdinFile = null;
        this._stdoutFile = null;
        this._stderrFile = null;
    }
}

/** Error carrying the raw MI message + failing command for precise UI feedback. */
class MiError extends Error {
    constructor(msg, cmd, results) {
        super(msg || 'GDB MI error');
        this.name = 'MiError';
        this.cmd = cmd;
        this.results = results;
    }
}

/**
 * Quote an MI argument. MI uses c-string quoting; wrap in double quotes and
 * escape backslashes + quotes so paths with spaces and expressions with quotes
 * (e.g. m["a"]) survive intact.
 */
function quote(s) {
    return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/** GDB accepts forward slashes on Windows; use them to dodge backslash escaping. */
function toPosix(p) {
    return String(p).replace(/\\/g, '/');
}

module.exports = { GdbSession, MiError };
