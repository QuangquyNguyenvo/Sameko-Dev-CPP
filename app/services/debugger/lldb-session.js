/**
 * Sameko Dev C++ IDE - LLDB debug session (macOS)
 *
 * GDB does not run on Apple Silicon. This class drives lldb-dap over the Debug Adapter Protocol
 * and exposes the same methods, events and result shapes as GdbSession, so the facade, the IPC
 * handlers and the debugger UI are the same on every system.
 *
 * DAP has no variable objects: a variablesReference is only valid until the program resumes.
 * Each "varobj" here therefore remembers how to find itself again (its expression, or its parent
 * and index), and varUpdate() walks them after every stop and reports what changed.
 *
 * @module app/services/debugger/lldb-session
 */

'use strict';

const { spawn, execFileSync } = require('child_process');
const { EventEmitter } = require('events');
const { StringDecoder } = require('string_decoder');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { GdbSession } = require('./gdb-session');

const REQUEST_TIMEOUT_MS = 20000;
const CHILD_PAGE = 1000;

/** Absolute path of lldb-dap (Xcode, Command Line Tools or Homebrew LLVM). */
function findLldbDap() {
    try {
        const found = execFileSync('/usr/bin/xcrun', ['-f', 'lldb-dap'], {
            encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000,
        }).trim();
        if (found && fs.existsSync(found)) return found;
    } catch (_) { /* no developer tools selected */ }
    const known = ['/Library/Developer/CommandLineTools/usr/bin/lldb-dap',
        '/opt/homebrew/opt/llvm/bin/lldb-dap', '/usr/local/opt/llvm/bin/lldb-dap'];
    const hit = known.find((candidate) => fs.existsSync(candidate));
    if (hit) return hit;
    throw new Error('LLDB was not found. Run "xcode-select --install" in Terminal, then try again.');
}

const STOP_REASONS = {
    breakpoint: 'breakpoint-hit',
    'function breakpoint': 'breakpoint-hit',
    step: 'end-stepping-range',
    pause: 'signal-received',
    exception: 'signal-received',
    signal: 'signal-received',
    'data breakpoint': 'watchpoint-trigger',
    watchpoint: 'watchpoint-trigger',
};

// How lldb-dap describes a crash (Apple Silicon reports Mach exceptions), as the signal gdb names.
const CRASH_PATTERNS = [
    [/\bEXC_BAD_ACCESS\b/, 'SIGSEGV'], // code=2 too: a stack overflow is a bad access
    [/\bEXC_ARITHMETIC\b/, 'SIGFPE'],
    [/\bEXC_BAD_INSTRUCTION\b/, 'SIGILL'],
    [/\bEXC_CRASH\b/, 'SIGABRT'],
];
// Signals that mean "stopped from outside" (Pause on macOS stops with SIGSTOP), not a crash.
const PAUSE_SIGNALS = new Set(['SIGSTOP', 'SIGINT', 'SIGTRAP', 'SIGTSTP', 'SIGCONT']);
// Frames counted for the stack-overflow check; gdb's session counts to the same limit.
const MAX_COUNTED_FRAMES = 2001;
const FRAME_PAGE = 200;

/** The gdb-style signal name of a crash stop, or '' when the stop is not a crash. */
function crashSignal(body) {
    if (body.reason !== 'exception' && body.reason !== 'signal') return '';
    const text = `${body.description || ''}\n${body.text || ''}`;
    const signal = /\bsignal\s+(SIG[A-Z0-9]+)\b/.exec(text)?.[1];
    if (signal) return PAUSE_SIGNALS.has(signal) ? '' : signal;
    for (const [pattern, name] of CRASH_PATTERNS) if (pattern.test(text)) return name;
    // __builtin_trap() on arm64; a user breakpoint arrives with reason "breakpoint" instead.
    if (body.reason === 'exception' && /\bEXC_BREAKPOINT\b/.test(text)) return 'SIGILL';
    return '';
}

function toFrame(f, level) {
    return {
        level: String(level),
        id: f.id,
        func: f.name,
        file: f.source?.path || f.source?.name || undefined,
        fullname: f.source?.path || undefined,
        line: f.line ? String(f.line) : undefined,
        addr: f.instructionPointerReference,
    };
}

function formatValue(value, fmt) {
    if (fmt !== 'hexadecimal') return value;
    const text = String(value).trim();
    if (!/^-?\d+$/.test(text)) return value;
    const n = BigInt(text);
    return '0x' + (n < 0n ? BigInt.asUintN(64, n) : n).toString(16);
}

class LldbSession extends EventEmitter {
    /**
     * @param {Object} cfg
     * @param {string} cfg.dapPath  absolute path to lldb-dap
     * @param {string} cfg.exePath  absolute path to the (-g compiled) target
     * @param {string} [cfg.cwd]    working dir for the program
     * @param {Object} [cfg.env]    environment for the adapter
     */
    constructor(cfg) {
        super();
        this.cfg = cfg;
        this.proc = null;
        this.seq = 0;
        this.pending = new Map();
        this.buffer = Buffer.alloc(0);
        this.state = 'idle';
        this.disposed = false;
        this.launched = false;
        this.threadId = null;
        this.frames = [];
        this.frameIndex = 0;
        this.nextBreakpointId = 1;
        this.breakpoints = new Map();
        this.vars = new Map();
        this._exitReported = false;
        this._initialized = new Promise((resolve) => { this._resolveInitialized = resolve; });
        this._stdinFile = null;
        this._stdoutFile = null;
        this._stderrFile = null;
        this._outOffset = 0;
        this._errOffset = 0;
        this._pumpTimer = null;
        this._pauseRequested = false;
    }

    // ---- protocol ----------------------------------------------------------

    request(command, args) {
        return new Promise((resolve, reject) => {
            if (!this.proc || this.state === 'terminated' || this.disposed) {
                return reject(new Error('debug session not running'));
            }
            const seq = ++this.seq;
            const timer = setTimeout(() => {
                this.pending.delete(seq);
                reject(new Error(`LLDB request timed out: ${command}`));
            }, REQUEST_TIMEOUT_MS);
            this.pending.set(seq, { resolve, reject, timer });
            const body = Buffer.from(JSON.stringify({ seq, type: 'request', command, arguments: args || {} }));
            try {
                this.proc.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
                this.proc.stdin.write(body);
            } catch (err) {
                clearTimeout(timer);
                this.pending.delete(seq);
                reject(err);
            }
        });
    }

    _onData(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        for (;;) {
            const end = this.buffer.indexOf('\r\n\r\n');
            if (end < 0) return;
            const match = /Content-Length:\s*(\d+)/i.exec(this.buffer.slice(0, end).toString());
            if (!match) { this.buffer = this.buffer.slice(end + 4); continue; }
            const length = Number(match[1]);
            if (this.buffer.length < end + 4 + length) return;
            const body = this.buffer.slice(end + 4, end + 4 + length).toString('utf8');
            this.buffer = this.buffer.slice(end + 4 + length);
            try { this._onMessage(JSON.parse(body)); } catch (err) { this.emit('log', `${err.message}\n`); }
        }
    }

    _onMessage(msg) {
        if (msg.type === 'response') {
            const p = this.pending.get(msg.request_seq);
            if (!p) return;
            this.pending.delete(msg.request_seq);
            clearTimeout(p.timer);
            if (msg.success) p.resolve(msg.body || {});
            else p.reject(new Error(msg.body?.error?.format || msg.message || 'LLDB request failed'));
            return;
        }
        if (msg.type !== 'event') return;
        const body = msg.body || {};
        switch (msg.event) {
            case 'initialized': this._resolveInitialized(); break;
            case 'stopped': this._onStopped(body).catch((err) => this.emit('log', `${err.message}\n`)); break;
            case 'continued': this._markRunning(); break;
            case 'exited': this._reportExit(body.exitCode); break;
            case 'terminated': this._reportExit(null); break;
            case 'output': if (body.category === 'console') this.emit('log', body.output || ''); break;
            default: break;
        }
    }

    _markRunning() {
        if (this.state === 'running') return;
        this.state = 'running';
        this.vars.forEach((v) => { v.ref = 0; });
        this.emit('running');
    }

    _reportExit(code) {
        if (this._exitReported || !this.launched) return;
        this._exitReported = true;
        this.state = 'stopped';
        this._stopPump();
        this.emit('programExited', { code: Number.isInteger(code) ? code : 0 });
    }

    async _onStopped(body) {
        this.threadId = body.threadId ?? this.threadId;
        this.state = 'stopped';
        this.frameIndex = 0;
        await this._loadFrames();
        let reason = STOP_REASONS[body.reason] || body.reason || '';
        const results = {};
        const signal = this._pauseRequested ? '' : crashSignal(body);
        this._pauseRequested = false;
        if (signal) {
            results['signal-name'] = signal;
            results['signal-meaning'] = String(body.description || body.text || signal).trim();
        }

        // lldb-dap versions name this stop differently, and a step can change a watched value
        // too, so the value itself decides, as with a GDB watchpoint.
        for (const bp of this.breakpoints.values()) {
            if (bp.kind !== 'data' || !bp.enabled) continue;
            const now = await this._quietEvaluate(bp.expr);
            if (now === null || now === bp.value) continue;
            if (!results.wpt) {
                results.wpt = { number: String(bp.id), exp: bp.expr };
                results.value = { old: bp.value, new: now };
                reason = 'watchpoint-trigger';
            }
            bp.value = now;
        }
        // Temporary breakpoints (Run to Cursor, the stop at main) end at the first stop.
        const temporary = [...this.breakpoints.values()].filter((bp) => bp.temporary);
        for (const bp of temporary) this.breakpoints.delete(bp.id);
        for (const file of new Set(temporary.filter((bp) => bp.kind === 'source').map((bp) => bp.file))) {
            await this._syncSource(file).catch(() => { });
        }
        if (temporary.some((bp) => bp.kind === 'function')) await this._syncFunctions().catch(() => { });

        this.emit('stopped', { reason, frame: this.frames[0] || null, threadId: String(this.threadId), results });
    }

    async _loadFrames() {
        const r = await this.request('stackTrace', { threadId: this.threadId, startFrame: 0, levels: FRAME_PAGE });
        this.frames = (r.stackFrames || []).map(toFrame);
    }

    get frameId() {
        return this.frames[this.frameIndex]?.id;
    }

    // ---- lifecycle ---------------------------------------------------------

    async start() {
        if (this.proc) throw new Error('Session already started');
        this.state = 'starting';
        this.proc = spawn(this.cfg.dapPath, [], {
            cwd: this.cfg.cwd || path.dirname(this.cfg.exePath),
            env: this.cfg.env || process.env,
        });
        this.proc.stdout.on('data', (d) => this._onData(d));
        this.proc.stderr.setEncoding('utf8');
        this.proc.stderr.on('data', (d) => this.emit('log', d));
        this.proc.stdin.on('error', () => { });
        this.proc.on('error', (err) => {
            this.emit('error', err);
            this._failAllPending(err);
        });
        this.proc.on('exit', (code) => {
            this.state = 'terminated';
            this._failAllPending(new Error('lldb exited'));
            this.emit('terminated', { code });
            this._cleanupTempFiles();
        });
        await this.request('initialize', {
            clientID: 'sameko', adapterID: 'lldb-dap', pathFormat: 'path',
            linesStartAt1: true, columnsStartAt1: true, supportsVariableType: true,
        });
        this.emit('ready');
    }

    async run(stdinContent, stdinPath) {
        const stamp = `${process.pid}-${Date.now()}`;
        let input = stdinPath || '/dev/null';
        if (!stdinPath && typeof stdinContent === 'string') {
            this._stdinFile = path.join(os.tmpdir(), `sameko-stdin-${stamp}.txt`);
            fs.writeFileSync(this._stdinFile, stdinContent, 'utf8');
            input = this._stdinFile;
        }
        this._stdoutFile = path.join(os.tmpdir(), `sameko-stdout-${stamp}.txt`);
        this._stderrFile = path.join(os.tmpdir(), `sameko-stderr-${stamp}.txt`);
        fs.writeFileSync(this._stdoutFile, '');
        fs.writeFileSync(this._stderrFile, '');
        this._outOffset = 0;
        this._errOffset = 0;
        this._outDecoder = new StringDecoder('utf8');
        this._errDecoder = new StringDecoder('utf8');

        const setting = (name, value) => `settings set ${name} ${JSON.stringify(value)}`;
        const launch = this.request('launch', {
            program: this.cfg.exePath,
            cwd: this.cfg.cwd || path.dirname(this.cfg.exePath),
            stopOnEntry: false,
            initCommands: [
                setting('target.input-path', input),
                setting('target.output-path', this._stdoutFile),
                setting('target.error-path', this._stderrFile),
            ],
        });
        await Promise.race([this._initialized, launch]);
        await this._initialized;
        this.launched = true;
        for (const file of new Set([...this.breakpoints.values()].filter((b) => b.kind === 'source').map((b) => b.file))) {
            await this._syncSource(file);
        }
        await this._syncFunctions();
        this._startPump();
        this.state = 'running';
        this.emit('running');
        await this.request('configurationDone');
        await launch;
        return {};
    }

    async dispose() {
        if (this.disposed || this._disposing) return;
        this._disposing = true;
        this._stopPump();
        const proc = this.proc;
        if (proc && this.state !== 'terminated') {
            await Promise.race([
                this.request('disconnect', { terminateDebuggee: true }).catch(() => { }),
                new Promise((resolve) => setTimeout(resolve, 800)),
            ]);
        }
        this.disposed = true;
        try { if (proc) proc.kill('SIGKILL'); } catch (_) { }
        this._failAllPending(new Error('session disposed'));
        this._cleanupTempFiles();
        this.proc = null;
        this.state = 'terminated';
    }

    // ---- breakpoints -------------------------------------------------------

    async _syncSource(file) {
        if (!this.launched) return;
        const list = [...this.breakpoints.values()]
            .filter((bp) => bp.kind === 'source' && bp.file === file && bp.enabled);
        const r = await this.request('setBreakpoints', {
            source: { path: file },
            breakpoints: list.map((bp) => (bp.condition ? { line: bp.line, condition: bp.condition } : { line: bp.line })),
        });
        (r.breakpoints || []).forEach((resolved, i) => {
            if (list[i] && resolved.line) list[i].resolvedLine = resolved.line;
        });
    }

    async _syncFunctions() {
        if (!this.launched) return;
        const names = [...this.breakpoints.values()].filter((bp) => bp.kind === 'function').map((bp) => ({ name: bp.name }));
        await this.request('setFunctionBreakpoints', { breakpoints: names });
    }

    /** Run an lldb command. Watchpoints use these: DAP data breakpoints were accepted but never hit. */
    async _command(command) {
        const r = await this.request('evaluate', { expression: `\`${command}`, frameId: this.frameId, context: 'repl' });
        return String(r.result || '');
    }

    _syncBreakpoint(bp) {
        if (bp.kind === 'data') {
            const verb = this.breakpoints.has(bp.id) ? (bp.enabled ? 'enable' : 'disable') : 'delete';
            return this._command(`watchpoint ${verb} ${bp.lldbId}`);
        }
        if (bp.kind === 'function') return this._syncFunctions();
        return this._syncSource(bp.file);
    }

    async setBreakpoint(file, line, condition) {
        const bp = {
            id: this.nextBreakpointId++, kind: 'source', file, line, resolvedLine: line,
            condition: condition && condition.trim() ? condition.trim() : '', enabled: true,
        };
        this.breakpoints.set(bp.id, bp);
        await this._syncSource(file);
        return { id: bp.id, line: bp.resolvedLine, raw: {} };
    }

    async breakAtMain() {
        const bp = { id: this.nextBreakpointId++, kind: 'function', name: 'main', enabled: true, temporary: true };
        this.breakpoints.set(bp.id, bp);
        await this._syncFunctions();
        return {};
    }

    async setWatchpoint(expr) {
        if (this.state !== 'stopped') throw new Error('Pause the debugger first.');
        if (!expr || /[\0\r\n]/.test(expr)) throw new Error('Enter a single watch expression.');
        const address = /0x[0-9a-f]+/i.exec(await this._quietEvaluate(`&(${expr})`) || '')?.[0];
        const size = parseInt(await this._quietEvaluate(`sizeof(${expr})`) || '', 10);
        if (!address || !(size > 0)) throw new Error('LLDB cannot watch this expression.');
        // "modify" stops only when the value changes, as GDB does; older LLDB only has "write".
        const create = (mode) => this._command(`watchpoint set expression -w ${mode} -s ${size} -- ${address}`).catch(() => '');
        const created = /Watchpoint created: Watchpoint (\d+)/i;
        const match = created.exec(await create('modify')) || created.exec(await create('write'));
        if (!match) throw new Error('LLDB cannot watch this expression.');
        const bp = {
            id: this.nextBreakpointId++, kind: 'data', lldbId: Number(match[1]), expr, enabled: true,
            value: await this._quietEvaluate(expr),
        };
        this.breakpoints.set(bp.id, bp);
        return { id: bp.id };
    }

    async removeBreakpoint(id) {
        const bp = this.breakpoints.get(id);
        if (!bp) return {};
        this.breakpoints.delete(id);
        await this._syncBreakpoint(bp);
        return {};
    }

    async enableBreakpoint(id) { return this._setEnabled(id, true); }
    async disableBreakpoint(id) { return this._setEnabled(id, false); }

    async _setEnabled(id, enabled) {
        const bp = this.breakpoints.get(id);
        if (!bp) return {};
        bp.enabled = enabled;
        await this._syncBreakpoint(bp);
        return {};
    }

    async setCondition(id, condition) {
        const bp = this.breakpoints.get(id);
        if (!bp) return {};
        bp.condition = condition || '';
        await this._syncBreakpoint(bp);
        return {};
    }

    async runToLine(file, line) {
        const bp = { id: this.nextBreakpointId++, kind: 'source', file, line, enabled: true, temporary: true };
        this.breakpoints.set(bp.id, bp);
        await this._syncSource(file);
        return this.cont();
    }

    // ---- execution ---------------------------------------------------------

    _resume(command) {
        const request = this.request(command, { threadId: this.threadId });
        this._markRunning();
        return request;
    }

    cont() { return this._resume('continue'); }
    next() { return this._resume('next'); }
    step() { return this._resume('stepIn'); }
    finish() { return this._resume('stepOut'); }

    async interrupt() {
        if (!this.threadId) {
            const r = await this.request('threads');
            this.threadId = r.threads?.[0]?.id ?? null;
        }
        this._pauseRequested = true;
        return this.request('pause', { threadId: this.threadId }).catch((err) => {
            this._pauseRequested = false;
            throw err;
        });
    }

    // ---- frames and values -------------------------------------------------

    async listFrames() { return { stack: this.frames.map(({ id, ...frame }) => frame) }; }

    /**
     * The selected thread's depth, counted up to MAX_COUNTED_FRAMES as gdb's session does. Newer
     * lldb-dap only estimates totalFrames, so when the loaded page is full the rest is fetched in
     * one request instead of trusting it.
     */
    async stackDepth() {
        if (this.frames.length < FRAME_PAGE) return this.frames.length;
        const r = await this.request('stackTrace', {
            threadId: this.threadId, startFrame: this.frames.length, levels: MAX_COUNTED_FRAMES - this.frames.length,
        });
        return this.frames.length + (r.stackFrames || []).length;
    }

    async listThreads() {
        const r = await this.request('threads');
        const threads = (r.threads || []).map((t) => ({ id: String(t.id), 'target-id': t.name || '', name: t.name || '' }));
        return { threads, 'current-thread-id': this.threadId === null ? '' : String(this.threadId) };
    }

    async framesOfThread(id) {
        if (!/^\d+$/.test(String(id))) throw new Error('Invalid thread ID');
        const r = await this.request('stackTrace', { threadId: Number(id), startFrame: 0, levels: 32 });
        return { stack: (r.stackFrames || []).map((f, level) => { const { id: _ref, ...frame } = toFrame(f, level); return frame; }) };
    }

    async selectThread(id) {
        if (!/^\d+$/.test(String(id))) throw new Error('Invalid thread ID');
        if (this.state !== 'stopped') throw new Error('Pause the debugger first.');
        const previous = this.threadId;
        this.threadId = Number(id);
        this.frameIndex = 0;
        try {
            await this._loadFrames();
        } catch (err) {
            this.threadId = previous;
            await this._loadFrames().catch(() => { });
            throw err;
        }
        return {};
    }

    async selectFrame(n) {
        if (!this.frames[n]) throw new Error('No such frame');
        this.frameIndex = n;
        return {};
    }

    async listLocals() {
        if (this.frameId === undefined) return { variables: [] };
        const { scopes = [] } = await this.request('scopes', { frameId: this.frameId });
        const locals = scopes.find((s) => /^locals$/i.test(s.name)) || scopes[0];
        if (!locals) return { variables: [] };
        const r = await this.request('variables', { variablesReference: locals.variablesReference });
        return { variables: (r.variables || []).map((v) => ({ name: v.name, value: v.value, type: v.type })) };
    }

    async evaluate(expr) {
        const r = await this.request('evaluate', { expression: expr, frameId: this.frameId, context: 'watch' });
        return { value: r.result };
    }

    async _quietEvaluate(expr) {
        try { return (await this.evaluate(expr)).value; } catch (_) { return null; }
    }

    async _childCount(item) {
        if (!item.variablesReference) return 0;
        if (Number.isInteger(item.indexedVariables) || Number.isInteger(item.namedVariables)) {
            return (item.indexedVariables || 0) + (item.namedVariables || 0);
        }
        const r = await this.request('variables', { variablesReference: item.variablesReference, count: CHILD_PAGE });
        return (r.variables || []).length;
    }

    _record(name, v, count) {
        const isContainer = /^(?:std::)/.test(v.type || '') && count > 0;
        return {
            name,
            numchild: String(count),
            value: formatValue(v.value, v.fmt),
            type: v.type || '',
            ...(isContainer ? { dynamic: '1', has_more: '0' } : {}),
        };
    }

    async varCreate(name, expr) {
        const r = await this.request('evaluate', { expression: expr, frameId: this.frameId, context: 'watch' });
        const count = await this._childCount(r);
        const v = {
            name, expr, parent: null, index: 0, ref: r.variablesReference || 0,
            value: r.result, type: r.type || '', count, fmt: 'natural',
        };
        this.vars.set(name, v);
        return this._record(name, v, count);
    }

    async varDelete(name) {
        const prefix = `${name}.`;
        for (const key of [...this.vars.keys()]) {
            if (key === name || key.startsWith(prefix)) this.vars.delete(key);
        }
        return {};
    }

    async _ensureRef(v) {
        if (v.ref) return v.ref;
        if (!v.parent) {
            const r = await this.request('evaluate', { expression: v.expr, frameId: this.frameId, context: 'watch' });
            v.ref = r.variablesReference || 0;
            return v.ref;
        }
        const parent = this.vars.get(v.parent);
        if (!parent) return 0;
        const parentRef = await this._ensureRef(parent);
        if (!parentRef) return 0;
        const r = await this.request('variables', { variablesReference: parentRef, start: v.index, count: 1 });
        v.ref = r.variables?.[0]?.variablesReference || 0;
        return v.ref;
    }

    async varListChildren(name, from, to) {
        const v = this.vars.get(name);
        if (!v) throw new Error('Unknown variable');
        const ref = await this._ensureRef(v);
        if (!ref) return { numchild: '0', children: [], has_more: '0' };
        const start = Number.isInteger(from) ? from : 0;
        const count = Number.isInteger(to) ? Math.max(0, to - start) : CHILD_PAGE;
        const r = await this.request('variables', { variablesReference: ref, start, count });
        const children = [];
        let index = start;
        for (const item of r.variables || []) {
            const childName = `${name}.${index}`;
            const childCount = await this._childCount(item);
            const child = {
                name: childName, expr: null, parent: name, index, ref: item.variablesReference || 0,
                key: item.name, evaluateName: item.evaluateName || '', value: item.value, type: item.type || '', count: childCount, fmt: v.fmt,
            };
            this.vars.set(childName, child);
            children.push({ ...this._record(childName, child, childCount), exp: item.name });
            index++;
        }
        const total = Math.max(v.count, start + children.length);
        return { numchild: String(total), children, has_more: start + children.length < total ? '1' : '0' };
    }

    /** Re-read every variable after a stop and report the ones whose value changed. */
    async varUpdate() {
        const changelist = [];
        const byDepth = [...this.vars.values()].sort((a, b) => a.name.split('.').length - b.name.split('.').length);
        for (const v of byDepth) {
            let current = null;
            try {
                if (!v.parent) {
                    current = await this.request('evaluate', { expression: v.expr, frameId: this.frameId, context: 'watch' });
                    current = { ...current, value: current.result };
                } else {
                    const parent = this.vars.get(v.parent);
                    const parentRef = parent ? await this._ensureRef(parent) : 0;
                    if (parentRef) {
                        const r = await this.request('variables', { variablesReference: parentRef, start: v.index, count: 1 });
                        current = r.variables?.[0] || null;
                    }
                }
            } catch (_) { current = null; }
            if (!current) {
                if (!v.gone) changelist.push({ name: v.name, in_scope: 'false', type_changed: 'false' });
                v.gone = true;
                v.ref = 0;
                continue;
            }
            const count = await this._childCount(current);
            const entry = { name: v.name, in_scope: 'true', type_changed: 'false' };
            let changed = !!v.gone;
            v.gone = false;
            v.ref = current.variablesReference || 0;
            if (current.value !== v.value) { v.value = current.value; changed = true; }
            if (count !== v.count) { v.count = count; entry.new_num_children = String(count); changed = true; }
            if (changed) changelist.push({ ...entry, value: formatValue(v.value, v.fmt) });
        }
        return { changelist };
    }

    /**
     * Change a variable's value while paused. DAP setVariable needs the container and the child's
     * name there: a child knows its parent, a root (a local or a watch) is looked up in the frame's
     * scopes. Anything else is assigned as an expression.
     */
    async varAssign(name, expr) {
        if (this.state !== 'stopped') throw new Error('Pause the debugger first.');
        if (!expr || /[\0\r\n]/.test(expr)) throw new Error('Enter a single value.');
        const v = this.vars.get(name);
        if (!v) throw new Error('Unknown variable');
        let done = false;
        try {
            const target = await this._assignTarget(v);
            if (target) {
                await this.request('setVariable', { variablesReference: target.ref, name: target.name, value: expr });
                done = true;
            }
        } catch (_) { done = false; }
        const lhs = v.parent ? v.evaluateName : v.expr;
        if (!done && lhs) {
            try {
                await this.request('evaluate', { expression: `(${lhs}) = (${expr})`, frameId: this.frameId, context: 'watch' });
                done = true;
            } catch (_) { done = false; }
        }
        if (!done) throw new Error('LLDB cannot change this value.');
        // Read it back the way varUpdate() does, so the next update does not report it again.
        const value = await this._readValue(v);
        if (value === null) throw new Error('LLDB cannot change this value.');
        v.value = value;
        v.gone = false;
        return { value: formatValue(v.value, v.fmt) };
    }

    /** Where setVariable can change this varobj: its container's reference and its name there. */
    async _assignTarget(v) {
        if (v.parent) {
            const parent = this.vars.get(v.parent);
            const ref = parent ? await this._ensureRef(parent) : 0;
            return ref && v.key ? { ref, name: v.key } : null;
        }
        if (!/^[A-Za-z_]\w*$/.test(v.expr || '') || this.frameId === undefined) return null;
        const { scopes = [] } = await this.request('scopes', { frameId: this.frameId });
        for (const scope of scopes) {
            if (!scope.variablesReference || /^registers$/i.test(scope.name)) continue;
            const r = await this.request('variables', { variablesReference: scope.variablesReference });
            if ((r.variables || []).some((item) => item.name === v.expr)) return { ref: scope.variablesReference, name: v.expr };
        }
        return null;
    }

    async _readValue(v) {
        try {
            if (!v.parent) {
                const r = await this.request('evaluate', { expression: v.expr, frameId: this.frameId, context: 'watch' });
                v.ref = r.variablesReference || 0;
                return r.result ?? null;
            }
            const parent = this.vars.get(v.parent);
            const parentRef = parent ? await this._ensureRef(parent) : 0;
            if (!parentRef) return null;
            const r = await this.request('variables', { variablesReference: parentRef, start: v.index, count: 1 });
            const item = r.variables?.[0];
            if (!item) return null;
            v.ref = item.variablesReference || 0;
            return item.value ?? null;
        } catch (_) { return null; }
    }

    async varSetFormat(name, fmt) {
        const v = this.vars.get(name);
        if (!v) throw new Error('Unknown variable');
        v.fmt = fmt === 'hexadecimal' ? 'hexadecimal' : 'natural';
        return { value: formatValue(v.value, v.fmt), format: fmt };
    }
}

// Program output is read from files exactly as in the GDB session.
for (const method of ['_startPump', '_stopPump', '_pump', '_readDelta', '_failAllPending']) {
    LldbSession.prototype[method] = GdbSession.prototype[method];
}

LldbSession.prototype._cleanupTempFiles = function cleanupTempFiles() {
    for (const f of [this._stdinFile, this._stdoutFile, this._stderrFile]) {
        if (f) { try { fs.unlinkSync(f); } catch (_) { } }
    }
    this._stdinFile = null;
    this._stdoutFile = null;
    this._stderrFile = null;
};

module.exports = { LldbSession, findLldbDap };
