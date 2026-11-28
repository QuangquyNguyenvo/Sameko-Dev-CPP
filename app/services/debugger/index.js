/**
 * Sameko Dev C++ IDE - Debugger Service (facade)
 *
 * Electron-aware wrapper around GdbSession. Owns AT MOST ONE active session,
 * resolves toolchain paths from the compiler detector, and forwards session
 * events to the renderer through a single callback (same pattern as the
 * compiler service). All IPC handlers go through this facade — the renderer
 * never touches GdbSession directly.
 *
 * @module app/services/debugger
 */

'use strict';

const path = require('path');
const { GdbSession } = require('./gdb-session');
const { describeExit } = require('../../shared/exit-codes');
const { IS_MAC } = require('../../shared/platform');
const {
    getDebuggerPath,
    getPrinterPythonDir,
    getCompilerEnv,
} = require('../compiler/toolchain/detector');

/** @type {GdbSession|null} */
let session = null;
/** Bumped by every start() and stop(): an older start() that resumes gives up. */
let lifecycle = 0;
let sendToRendererCallback = null;

function setSendToRendererCallback(cb) { sendToRendererCallback = cb; }
function send(channel, data) {
    if (sendToRendererCallback) sendToRendererCallback(channel, data);
}

function isActive() {
    return !!session && session.state !== 'terminated' && !session.disposed;
}

/**
 * Start a debug session on an already-compiled (-g) executable.
 * Disposes any previous session first. Wires all events to the renderer.
 * @param {{exePath:string, cwd?:string}} opts
 */
async function start({ exePath, cwd }) {
    const mine = ++lifecycle;
    await disposeSession(); // ensure single session
    // Disposing waits for the old gdb; meanwhile Stop or another start may have
    // run. The newest one owns the debugger.
    if (mine !== lifecycle) throw new Error('Debug start cancelled');

    if (IS_MAC) {
        // GDB does not run on Apple Silicon; LldbSession has the same interface.
        const { LldbSession, findLldbDap } = require('./lldb-session');
        session = new LldbSession({
            dapPath: findLldbDap(),
            exePath,
            cwd: cwd || path.dirname(exePath),
            env: getCompilerEnv(),
        });
    } else {
        session = new GdbSession({
            gdbPath: getDebuggerPath(),
            exePath,
            printerPythonDir: getPrinterPythonDir(),
            cwd: cwd || path.dirname(exePath),
            env: getCompilerEnv(),
        });
    }

    session.on('running', () => send('debug:running', {}));
    session.on('console', (text) => send('debug:console', { text }));
    session.on('programOut', (text) => send('debug:output', { text }));
    session.on('notify', (n) => send('debug:notify', n));
    session.on('error', (err) => send('debug:error', { message: err && err.message }));
    session.on('programExited', ({ code, signal, meaning }) => send('debug:programExited', {
        code,
        crash: signal ? crashInfo(signal, meaning, 0) : describeExit(code),
    }));
    session.on('terminated', ({ code }) => send('debug:terminated', { code }));

    // On every stop, eagerly fetch call stack + top-frame locals so the UI can
    // render in one shot (fewer round-trips). Guarded so a failed sub-query
    // never swallows the stop event itself.
    const owner = session;
    session.on('stopped', async (s) => {
        const payload = {
            reason: s.reason,
            threadId: s.threadId,
            frame: s.frame ? normFrame(s.frame) : null,
            frames: [],
            locals: [],
        };
        if (s.reason === 'watchpoint-trigger' && s.results.wpt) {
            payload.watchpoint = {
                expr: s.results.wpt.exp,
                oldValue: s.results.value?.old,
                newValue: s.results.value?.new,
            };
        }
        if (s.reason === 'watchpoint-scope') payload.expiredWatchpointId = Number(s.results.wpnum);
        const signal = s.reason === 'signal-received' ? s.results['signal-name'] : '';
        const crashed = !!signal && !PAUSE_SIGNALS.has(signal);
        try {
            let stack = await readStack(owner, !!signal);
            payload.threads = await threadList(owner);
            // Pause on Windows lands in a helper thread with no code of the user's.
            if (signal && !crashed && !stack.frames.some(isUserFrame) && payload.threads.length) {
                const target = payload.threads[0];
                await owner.selectThread(target.id);
                stack = await readStack(owner, true);
                payload.threadId = target.id;
                payload.threads = payload.threads.map(t => ({ ...t, current: t.id === target.id }));
            }
            payload.frames = stack.frames;
            payload.depth = stack.depth;
            payload.selectedLevel = stack.level;
            if (crashed) payload.crash = await crashAtStop(owner, signal, s.results['signal-meaning'], stack.depth);
        } catch (_) {
            if (crashed) payload.crash = crashInfo(signal, s.results['signal-meaning'], 0);
        }
        try {
            const l = await owner.listLocals();
            payload.locals = l.variables || [];
        } catch (_) { }
        // Stopped (or replaced) while the stack was being read: the renderer
        // already ended the session, and this stop must not bring it back.
        if (session !== owner) return;
        send('debug:stopped', payload);
    });

    await session.start();
    return { ok: true };
}

// What gdb reports when the user pressed Pause, as opposed to a program that crashed.
const PAUSE_SIGNALS = new Set(['SIGINT', 'SIGTRAP', '0']);
const STACK_OVERFLOW_DEPTH = 2000;
const STACK_OVERFLOW_STATUS = 0xC00000FD;
const LIBRARY_FILE = /[\\/]include[\\/]c\+\+[\\/]|[\\/]Sameko-GCC[\\/]|^\/(?:usr|lib|opt\/homebrew)\//;

/** A frame in the user's own source, not the standard library or a system file. */
function isUserFrame(frame) {
    return !!(frame && frame.file && path.isAbsolute(frame.file) && !LIBRARY_FILE.test(frame.file.replace(/\\/g, '/')));
}

/** The name and advice for a crash signal; very deep stacks are named as a stack overflow. */
function crashInfo(signal, meaning, depth) {
    if (signal === 'SIGSEGV' && depth >= STACK_OVERFLOW_DEPTH) return describeExit(STACK_OVERFLOW_STATUS);
    return describeExit(null, signal) || { hex: signal, name: meaning || signal, hint: '' };
}

/**
 * gdb has no signal name for some Windows exceptions (abort() and an uncaught C++ exception end
 * with 0xC0000409 and show as "?"), so the exception's own code names the crash.
 */
async function crashAtStop(active, signal, meaning, depth) {
    if (signal === '?' && active.evaluate) {
        try {
            const { value } = await active.evaluate('(unsigned int)$_siginfo.ExceptionCode');
            const known = describeExit(Number(String(value).split(' ')[0]));
            if (known) return known;
        } catch (_) { /* older gdb: keep its own wording */ }
    }
    return crashInfo(signal, meaning, depth);
}

/** The selected thread's stack; with preferUser, gdb's focus moves to the first frame of the user's code. */
async function readStack(active, preferUser) {
    const listed = await active.listFrames();
    const frames = (listed.stack || []).map(normFrame);
    const depth = active.stackDepth ? await active.stackDepth().catch(() => frames.length) : frames.length;
    let level = 0;
    if (preferUser) {
        const user = frames.findIndex(isUserFrame);
        if (user > 0) {
            await active.selectFrame(user);
            level = user;
        }
    }
    return { frames, depth, level };
}

/** Threads that run the user's code. Runtime helper threads (Windows has several) are left out. */
async function threadList(active) {
    if (!active.listThreads) return [];
    const info = await active.listThreads();
    const all = info.threads || [];
    if (all.length < 2) return [];
    const current = String(info['current-thread-id'] || '');
    const threads = [];
    for (const thread of all.slice(0, 32)) {
        const id = String(thread.id);
        let frames;
        try {
            frames = ((await active.framesOfThread(id)).stack || []).map(normFrame);
        } catch (_) {
            continue;
        }
        const top = frames.find(isUserFrame);
        if (top) threads.push({ id, func: top.func, file: top.file, line: top.line, current: id === current });
    }
    return threads;
}

/** Moves the debugger to another thread and returns what the panel shows for it. */
async function selectThread(id) {
    const active = requireSession();
    if (!active.selectThread) throw new Error('This debugger cannot switch threads.');
    await active.selectThread(id);
    const stack = await readStack(active, true);
    const locals = await active.listLocals();
    return { frames: stack.frames, depth: stack.depth, selectedLevel: stack.level, locals: locals.variables || [] };
}

function normFrame(fr) {
    return {
        level: fr.level !== undefined ? parseInt(fr.level, 10) : 0,
        func: fr.func || '??',
        file: fr.fullname || fr.file || null,
        line: fr.line ? parseInt(fr.line, 10) : null,
        addr: fr.addr || null,
    };
}

async function stop() {
    lifecycle++;   // a start() still disposing the previous gdb gives up
    await disposeSession();
}

async function disposeSession() {
    if (session) {
        const s = session;
        session = null;
        try { await s.dispose(); } catch (_) { }
    }
}

// ---- thin proxies (require an active session) -----------------------------

function requireSession() {
    if (!isActive()) throw new Error('No active debug session');
    return session;
}

const setBreakpoint = (file, line, cond) => requireSession().setBreakpoint(file, line, cond);
const setWatchpoint = (expr) => requireSession().setWatchpoint(expr);
const breakAtMain = () => requireSession().breakAtMain();
const removeBreakpoint = (id) => requireSession().removeBreakpoint(id);
const enableBreakpoint = (id) => requireSession().enableBreakpoint(id);
const disableBreakpoint = (id) => requireSession().disableBreakpoint(id);
const setCondition = (id, cond) => requireSession().setCondition(id, cond);
const runToLine = (file, line) => requireSession().runToLine(file, line);
const varSetFormat = (name, fmt) => requireSession().varSetFormat(name, fmt);
const varAssign = async (name, expr) => {
    const active = requireSession();
    if (!active.varAssign) throw new Error('This debugger cannot change values.');
    return active.varAssign(name, expr);
};
const cont = () => requireSession().cont();
const next = () => requireSession().next();
const step = () => requireSession().step();
const finish = () => requireSession().finish();
const interrupt = () => requireSession().interrupt();
const run = (stdin, stdinPath) => requireSession().run(stdin, stdinPath);
const selectFrame = (n) => requireSession().selectFrame(n);
const listLocals = () => requireSession().listLocals();
const listFrames = () => requireSession().listFrames();
const evaluate = (expr) => requireSession().evaluate(expr);
const varCreate = (name, expr) => requireSession().varCreate(name, expr);
const varDelete = (name) => requireSession().varDelete(name);
const varListChildren = (name, from, to) => requireSession().varListChildren(name, from, to);
const varUpdate = () => requireSession().varUpdate();

// Batched forms. gdb reads MI commands from a pipe and answers each by token,
// so a whole scope's variable objects can be written in one go instead of one
// renderer<->main round trip per variable.
async function varCreateMany(items) {
    const s = requireSession();
    const settled = await Promise.allSettled((items || []).map((it) => s.varCreate(it.name, it.expr)));
    return settled.map((r) => (r.status === 'fulfilled' ? { ok: true, var: r.value } : { ok: false }));
}
async function varDeleteMany(names) {
    const s = requireSession();
    await Promise.allSettled((names || []).map((n) => s.varDelete(n)));
}

module.exports = {
    setSendToRendererCallback,
    isActive,
    start,
    stop,
    setBreakpoint,
    setWatchpoint,
    breakAtMain,
    removeBreakpoint,
    enableBreakpoint,
    disableBreakpoint,
    setCondition,
    runToLine,
    varSetFormat,
    varAssign,
    cont,
    next,
    step,
    finish,
    interrupt,
    run,
    selectFrame,
    selectThread,
    listLocals,
    listFrames,
    evaluate,
    varCreate,
    varDelete,
    varListChildren,
    varUpdate,
    varCreateMany,
    varDeleteMany,
};
