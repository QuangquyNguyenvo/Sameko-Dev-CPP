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
const {
    getDebuggerPath,
    getPrinterPythonDir,
    getCompilerEnv,
} = require('../compiler/detector');

/** @type {GdbSession|null} */
let session = null;
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
    await stop(); // ensure single session

    session = new GdbSession({
        gdbPath: getDebuggerPath(),
        exePath,
        printerPythonDir: getPrinterPythonDir(),
        cwd: cwd || path.dirname(exePath),
        env: getCompilerEnv(),
    });

    session.on('running', () => send('debug:running', {}));
    session.on('console', (text) => send('debug:console', { text }));
    session.on('programOut', (text) => send('debug:output', { text }));
    session.on('notify', (n) => send('debug:notify', n));
    session.on('error', (err) => send('debug:error', { message: err && err.message }));
    session.on('programExited', ({ code }) => send('debug:programExited', { code }));
    session.on('terminated', ({ code }) => send('debug:terminated', { code }));

    // On every stop, eagerly fetch call stack + top-frame locals so the UI can
    // render in one shot (fewer round-trips). Guarded so a failed sub-query
    // never swallows the stop event itself.
    session.on('stopped', async (s) => {
        const payload = {
            reason: s.reason,
            threadId: s.threadId,
            frame: s.frame ? normFrame(s.frame) : null,
            frames: [],
            locals: [],
        };
        try {
            const f = await session.listFrames();
            payload.frames = (f.stack || []).map(normFrame);
        } catch (_) { }
        try {
            const l = await session.listLocals();
            payload.locals = l.variables || [];
        } catch (_) { }
        send('debug:stopped', payload);
    });

    await session.start();
    send('debug:ready', {});
    return { ok: true };
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
const breakAtMain = () => requireSession().breakAtMain();
const removeBreakpoint = (id) => requireSession().removeBreakpoint(id);
const enableBreakpoint = (id) => requireSession().enableBreakpoint(id);
const disableBreakpoint = (id) => requireSession().disableBreakpoint(id);
const setCondition = (id, cond) => requireSession().setCondition(id, cond);
const runToLine = (file, line) => requireSession().runToLine(file, line);
const varSetFormat = (name, fmt) => requireSession().varSetFormat(name, fmt);
const cont = () => requireSession().cont();
const next = () => requireSession().next();
const step = () => requireSession().step();
const finish = () => requireSession().finish();
const interrupt = () => requireSession().interrupt();
const run = (stdin) => requireSession().run(stdin);
const selectFrame = (n) => requireSession().selectFrame(n);
const listLocals = () => requireSession().listLocals();
const listFrames = () => requireSession().listFrames();
const evaluate = (expr) => requireSession().evaluate(expr);
const varCreate = (name, expr) => requireSession().varCreate(name, expr);
const varDelete = (name) => requireSession().varDelete(name);
const varListChildren = (name, from, to) => requireSession().varListChildren(name, from, to);
const varUpdate = () => requireSession().varUpdate();

module.exports = {
    setSendToRendererCallback,
    isActive,
    start,
    stop,
    setBreakpoint,
    breakAtMain,
    removeBreakpoint,
    enableBreakpoint,
    disableBreakpoint,
    setCondition,
    runToLine,
    varSetFormat,
    cont,
    next,
    step,
    finish,
    interrupt,
    run,
    selectFrame,
    listLocals,
    listFrames,
    evaluate,
    varCreate,
    varDelete,
    varListChildren,
    varUpdate,
};
