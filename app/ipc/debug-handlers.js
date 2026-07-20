/**
 * Sameko Dev C++ IDE - Debugger IPC Handlers
 *
 * Bridges the renderer to the debugger service (GDB/MI). The service owns the
 * session; these handlers are a thin request/response layer plus the
 * renderer-callback wiring for streamed debug events.
 *
 * @module app/ipc/debug-handlers
 */

'use strict';

const { ipcMain } = require('electron');
const { IPC } = require('../shared/constants');
const dbg = require('../services/debugger');

let mainWindow = null;

function setMainWindow(window) {
    mainWindow = window;
    dbg.setSendToRendererCallback((channel, data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(channel, data);
        }
    });
}

/** Wrap a session op so MI/session errors become a structured result, never a throw. */
async function guard(fn) {
    try {
        const r = await fn();
        return { ok: true, ...(r && typeof r === 'object' ? r : {}) };
    } catch (err) {
        return { ok: false, error: err && err.message ? err.message : String(err) };
    }
}

function registerHandlers() {
    // Start a session on an already-compiled (-g) exe, register breakpoints, run.
    ipcMain.handle(IPC.DEBUG.START, async (event, { exePath, cwd, breakpoints, stdin }) => {
        return guard(async () => {
            await dbg.start({ exePath, cwd });
            const registered = [];
            for (const bp of (breakpoints || [])) {
                try {
                    const r = await dbg.setBreakpoint(bp.file, bp.line, bp.condition);
                    registered.push({ file: bp.file, line: bp.line, id: r.id });
                } catch (_) { /* skip an unresolvable breakpoint, keep going */ }
            }
            await dbg.run(stdin);
            return { breakpoints: registered };
        });
    });

    ipcMain.handle(IPC.DEBUG.STOP, async () => guard(async () => { await dbg.stop(); }));

    ipcMain.handle(IPC.DEBUG.SET_BREAKPOINT, async (event, { file, line, condition }) =>
        guard(async () => {
            const r = await dbg.setBreakpoint(file, line, condition);
            return { id: r.id, line: r.line };
        }));

    ipcMain.handle(IPC.DEBUG.REMOVE_BREAKPOINT, async (event, { id }) =>
        guard(() => dbg.removeBreakpoint(id)));

    ipcMain.handle(IPC.DEBUG.SET_CONDITION, async (event, { id, condition }) =>
        guard(() => dbg.setCondition(id, condition)));

    ipcMain.handle(IPC.DEBUG.CONTINUE, async () => guard(() => dbg.cont()));
    ipcMain.handle(IPC.DEBUG.INTERRUPT, async () => guard(() => dbg.interrupt()));
    ipcMain.handle(IPC.DEBUG.STEP_OVER, async () => guard(() => dbg.next()));
    ipcMain.handle(IPC.DEBUG.STEP_INTO, async () => guard(() => dbg.step()));
    ipcMain.handle(IPC.DEBUG.STEP_OUT, async () => guard(() => dbg.finish()));

    ipcMain.handle(IPC.DEBUG.SELECT_FRAME, async (event, { level }) =>
        guard(async () => {
            await dbg.selectFrame(level);
            const l = await dbg.listLocals();
            return { locals: l.variables || [] };
        }));

    ipcMain.handle(IPC.DEBUG.EVALUATE, async (event, { expr }) =>
        guard(async () => {
            const r = await dbg.evaluate(expr);
            return { value: r.value };
        }));

    ipcMain.handle(IPC.DEBUG.VAR_CREATE, async (event, { name, expr }) =>
        guard(async () => {
            const r = await dbg.varCreate(name, expr);
            return { var: r };
        }));

    ipcMain.handle(IPC.DEBUG.VAR_CHILDREN, async (event, { name, from, to }) =>
        guard(async () => {
            const r = await dbg.varListChildren(name, from, to);
            return {
                children: r.children || [],
                hint: r.displayhint || null,
                hasMore: r.has_more === '1',
                numchild: r.numchild ? parseInt(r.numchild, 10) : (r.children || []).length,
            };
        }));

    ipcMain.handle(IPC.DEBUG.VAR_UPDATE, async () =>
        guard(async () => {
            const r = await dbg.varUpdate();
            return { changed: r.changelist || [] };
        }));

    ipcMain.handle(IPC.DEBUG.VAR_DELETE, async (event, { name }) =>
        guard(() => dbg.varDelete(name)));
}

module.exports = { registerHandlers, setMainWindow };
