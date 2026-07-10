/**
 * Sameko Dev C++ IDE - Debugger UI (renderer)
 *
 * Self-contained GDB/MI debug front-end. Talks to main ONLY through
 * window.electronAPI.debug* (defined in preload.js). Renders its own panel and
 * toolbar, manages Monaco breakpoint glyphs + the current-line marker, and
 * builds the Variables / Watch trees.
 *
 * Design principle ("nothing left to remove"): Locals, Watch and Hover are the
 * SAME mechanism — GDB variable objects / evaluate — surfaced from three input
 * points. There is one tree renderer, one value pipeline.
 *
 * Dual-export (renderer module convention). No require('electron') here.
 *
 * @module src/features/debugger/debugger-ui
 */

(function () {
    'use strict';

    const api = () => window.electronAPI;
    const mainEditor = () => (window.App && window.App.editor) || null;
    // Monaco's AMD loader exposes `monaco` as a lexical global that is NOT
    // necessarily a window property. Reference the bare identifier (resolves up
    // the shared global scope) and fall back to window.monaco. Using
    // `window.monaco` alone silently returned undefined -> handlers never fired.
    let _mon = null;
    function mon() {
        if (_mon) return _mon;
        try { if (typeof monaco !== 'undefined' && monaco) return (_mon = monaco); } catch (_) { }
        if (window.monaco) return (_mon = window.monaco);
        return null;
    }

    // ---- state -------------------------------------------------------------
    let state = 'idle';                 // idle | starting | running | stopped
    let inited = false;
    const bpByFile = new Map();         // normPath -> Map(line -> {condition, id})
    let bpDecoIds = [];
    let curLineDecoIds = [];
    let hoverProviderReg = null;
    let varSeq = 0;
    let liveVarobjs = [];               // varobj names to delete on next stop
    const watches = [];                 // array of expression strings
    let stopFrames = [];
    let selectedFrame = 0;
    let lastRawEndedNL = true;           // did the last program-output chunk end with '\n'?

    // ---- path helpers ------------------------------------------------------
    function norm(p) { return p ? String(p).replace(/\\/g, '/').toLowerCase() : ''; }
    function activeTab() {
        if (!window.App || typeof getPreferredTabId !== 'function') return null;
        const id = getPreferredTabId();
        return (window.App.tabs || []).find(t => t.id === id) || null;
    }
    function activePath() { const t = activeTab(); return t ? t.path : null; }

    // ---- terminal routing --------------------------------------------------
    function toTerminalRaw(text) {
        if (!text) return;
        if (window.TerminalManager && window.TerminalManager.writeProgram) {
            window.TerminalManager.writeProgram(text, null, true, 'output');
        } else if (typeof window.log === 'function') {
            window.log(text, '');
        }
        lastRawEndedNL = /\n$/.test(text);
    }
    function sys(msg, type) { if (typeof window.log === 'function') window.log(msg, type || 'system'); }
    /** Ensure a following system line starts on its own row (program output may lack a trailing newline). */
    function freshLine() { if (!lastRawEndedNL) { toTerminalRaw('\n'); } }

    // ========================================================================
    // INIT
    // ========================================================================
    function init() {
        if (inited) return;
        inited = true;
        const step = (name, fn) => { try { fn(); } catch (e) { console.error('[Debugger] init step failed:', name, e); } };
        step('injectStyles', injectStyles);
        step('buildPanel', buildPanel);
        step('wireToolbar', wireToolbar);
        step('wireEditor', wireEditor);
        step('wireEvents', wireEvents);
        step('wireHover', wireHover);
    }

    function injectStyles() {
        if (document.getElementById('sameko-debug-styles')) return;
        const MONO = "'Cascadia Code','JetBrains Mono',Consolas,monospace";
        const css = `
        #sameko-debug-panel{position:fixed;top:56px;right:12px;bottom:12px;width:340px;
          background:var(--bg-glass-heavy,rgba(26,37,48,.97));color:var(--text-primary,#e0f0ff);
          border:2.5px solid var(--border-strong,var(--accent,#88c9ea));border-radius:var(--radius,20px);
          z-index:1400;display:none;flex-direction:column;font-family:'Nunito','Segoe UI',sans-serif;
          font-size:12.5px;box-shadow:0 12px 44px rgba(0,0,0,.4);overflow:hidden}
        #sameko-debug-panel.open{display:flex}
        .sdbg-toolbar{display:flex;gap:6px;padding:11px 12px;align-items:center;
          background:var(--bg-header,rgba(21,37,53,.5));border-bottom:2px solid var(--border,#3a6075)}
        .sdbg-btn{background:var(--bg-button,#2a4050);border:none;color:var(--text-primary,#e0f0ff);
          border-radius:11px;width:32px;height:32px;cursor:pointer;font-size:15px;line-height:1;
          display:inline-flex;align-items:center;justify-content:center;
          transition:background-color .12s,color .12s,transform .12s}
        .sdbg-btn:hover:not(:disabled){background:var(--accent,#88c9ea);color:#11212e;transform:translateY(-1px)}
        .sdbg-btn:disabled{opacity:.3;cursor:default}
        .sdbg-btn.stop:hover:not(:disabled){background:#ff6b81;color:#fff}
        .sdbg-status{margin-left:auto;font-weight:800;font-size:10.5px;color:var(--accent,#88c9ea);
          text-transform:uppercase;letter-spacing:.06em;padding:4px 10px;border-radius:20px;
          background:var(--bg-button,rgba(136,201,234,.15))}
        .sdbg-body{overflow:auto;flex:1;padding:8px}
        .sdbg-section{background:var(--bg-page,rgba(26,37,48,.4));border:1.5px solid var(--border,#3a6075);
          border-radius:14px;margin-bottom:9px;overflow:hidden}
        .sdbg-head{display:flex;align-items:center;gap:8px;padding:8px 12px;
          font-weight:800;text-transform:uppercase;letter-spacing:.06em;font-size:10.5px;
          color:var(--accent,#88c9ea);border-bottom:2px dashed var(--border,#3a6075);
          background:var(--bg-header,rgba(21,37,53,.35))}
        .sdbg-head svg{width:14px;height:14px;flex:0 0 14px}
        .sdbg-secbody{padding:4px 0}
        .sdbg-row{display:flex;align-items:flex-start;padding:2.5px 10px;
          font-family:${MONO};cursor:default;line-height:1.55;border-radius:7px;margin:0 5px}
        .sdbg-row:hover{background:var(--bg-button,rgba(136,201,234,.14))}
        .sdbg-tw{width:15px;flex:0 0 15px;text-align:center;cursor:pointer;user-select:none;
          color:var(--text-muted,#7990a0)}
        .sdbg-name{color:var(--accent,#88c9ea);font-weight:700}
        .sdbg-eq{color:var(--text-muted,#7990a0);padding:0 5px}
        .sdbg-val{color:var(--text-primary,#e0f0ff);white-space:pre-wrap;word-break:break-word}
        .sdbg-val.changed{color:#ffcf5e;font-weight:700}
        .sdbg-frame{display:flex;align-items:center;gap:6px;padding:4px 12px;cursor:pointer;
          border-left:3px solid transparent;margin:0 5px;border-radius:7px}
        .sdbg-frame:hover{background:var(--bg-button,rgba(136,201,234,.14))}
        .sdbg-frame.sel{border-left-color:var(--accent,#88c9ea);background:var(--bg-button,rgba(136,201,234,.22));font-weight:800}
        .sdbg-frame .tick{width:12px;flex:0 0 12px;color:var(--accent,#88c9ea);font-weight:900;font-size:12px}
        .sdbg-frame .fn{color:#7fe0a8;font-family:${MONO}}
        .sdbg-frame .loc{color:var(--text-muted,#7990a0);font-size:11px}
        .sdbg-watchin{width:calc(100% - 20px);margin:6px 10px;background:var(--bg-input,#1a2a3a);
          border:1.5px solid var(--border,#3a6075);color:var(--text-primary,#e0f0ff);border-radius:10px;
          padding:6px 10px;font-family:${MONO};font-size:12px;outline:none}
        .sdbg-watchin:focus{border-color:var(--accent,#88c9ea)}
        .sdbg-more{padding:3px 12px 5px 28px;color:var(--accent,#88c9ea);cursor:pointer;font-size:11px;font-weight:700}
        .sdbg-empty{color:var(--text-muted,#7990a0);padding:5px 14px;font-style:italic}
        .sdbg-help{margin:2px 8px 8px;padding:9px 12px;border:1.5px dashed var(--border,#3a6075);
          border-radius:12px;background:var(--bg-page,rgba(26,37,48,.4));
          color:var(--text-secondary,#a9c2d4);font-size:11px;line-height:1.75}
        .sdbg-help-h{color:var(--accent,#88c9ea);font-weight:800;text-transform:uppercase;
          letter-spacing:.06em;font-size:10px;margin-bottom:4px}
        .sdbg-help b{color:var(--accent,#88c9ea)}
        .sdbg-help kbd{background:var(--bg-button,#2a4050);border:1px solid var(--border,#3a6075);
          border-radius:5px;padding:0 5px;font-family:${MONO};font-size:10px;color:var(--text-primary,#e0f0ff)}
        /* Breakpoint — a check mark (✓) in the gutter next to the line number, plus a
           bold, colored line number. No whole-line tint, so it never fights the
           yellow current-line highlight while stepping. */
        .sameko-bp-linenum{color:#ff5964!important;font-weight:900!important}
        .sameko-bp-linenum-cond{color:#ffb02e!important;font-weight:900!important}
        .sameko-bp-glyph{cursor:pointer;background:center/15px no-repeat url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='%23ff5964'%20stroke-width='3.6'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Cpath%20d='M5%2013l4%204L19%207'/%3E%3C/svg%3E")!important}
        .sameko-bp-cond{cursor:pointer;background:center/15px no-repeat url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='%23ffb02e'%20stroke-width='3.6'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Cpath%20d='M5%2013l4%204L19%207'/%3E%3C/svg%3E")!important}
        .sameko-curline{background:rgba(255,207,94,.18)}
        .sameko-arrow{width:0!important;height:0!important;border-top:6px solid transparent;
          border-bottom:6px solid transparent;border-left:10px solid #ffcf5e;margin-left:5px;margin-top:5px}`;
        const style = document.createElement('style');
        style.id = 'sameko-debug-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }

    let els = {};
    function buildPanel() {
        if (document.getElementById('sameko-debug-panel')) return;
        const p = document.createElement('div');
        p.id = 'sameko-debug-panel';
        p.innerHTML = `
          <div class="sdbg-toolbar">
            <button class="sdbg-btn" data-act="continue" title="Continue (F5)">&#9654;|</button>
            <button class="sdbg-btn" data-act="stepOver" title="Step Over (F10)">&#8631;</button>
            <button class="sdbg-btn" data-act="stepInto" title="Step Into (F11)">&#8615;</button>
            <button class="sdbg-btn" data-act="stepOut" title="Step Out (Shift+F11)">&#8613;</button>
            <button class="sdbg-btn stop" data-act="stop" title="Stop (Shift+F5)">&#9632;</button>
            <span class="sdbg-status">idle</span>
          </div>
          <div class="sdbg-body">
            <div class="sdbg-section">
              <div class="sdbg-head">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7l8-4 8 4-8 4-8-4z"/><path d="M4 12l8 4 8-4M4 17l8 4 8-4"/></svg>
                Call Stack
              </div>
              <div class="sdbg-secbody" id="sdbg-stack"></div>
            </div>
            <div class="sdbg-section">
              <div class="sdbg-head">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1M16 3h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1"/></svg>
                Variables
              </div>
              <div class="sdbg-secbody" id="sdbg-locals"></div>
            </div>
            <div class="sdbg-section">
              <div class="sdbg-head">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>
                Watch
              </div>
              <input class="sdbg-watchin" id="sdbg-watchin" placeholder="add expression, Enter…" />
              <div class="sdbg-secbody" id="sdbg-watch"></div>
            </div>
          </div>
          <div class="sdbg-help">
            <div class="sdbg-help-h">How to debug</div>
            <div><b>1.</b> Click the left gutter (next to a line) to drop a red breakpoint · <i>Alt+click</i> = conditional</div>
            <div><b>2.</b> Press <kbd>F5</kbd> to run — the program stops at your breakpoint</div>
            <div><b>3.</b> <kbd>F10</kbd> step over · <kbd>F11</kbd> step into · <kbd>Shift+F11</kbd> step out · <kbd>F5</kbd> continue</div>
            <div><b>4.</b> Hover any variable in the code to see its value · watch expressions above</div>
            <div><b>5.</b> <kbd>Shift+F5</kbd> to stop</div>
          </div>`;
        document.body.appendChild(p);
        els = {
            panel: p,
            status: p.querySelector('.sdbg-status'),
            stack: p.querySelector('#sdbg-stack'),
            locals: p.querySelector('#sdbg-locals'),
            watch: p.querySelector('#sdbg-watch'),
            watchIn: p.querySelector('#sdbg-watchin'),
        };
        p.querySelectorAll('.sdbg-btn').forEach(b => {
            b.addEventListener('click', () => {
                const a = b.dataset.act;
                if (a === 'continue') continueExec();
                else if (a === 'stepOver') stepOver();
                else if (a === 'stepInto') stepInto();
                else if (a === 'stepOut') stepOut();
                else if (a === 'stop') stop();
            });
        });
        els.watchIn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && els.watchIn.value.trim()) {
                watches.push(els.watchIn.value.trim());
                els.watchIn.value = '';
                if (state === 'stopped') refreshTrees();
            }
        });
    }

    function wireToolbar() {
        const btn = document.getElementById('btn-debug');
        if (btn) btn.addEventListener('click', () => start());
    }

    function showPanel(show) { els.panel && els.panel.classList.toggle('open', show); }
    function setStatus(s) {
        state = s;
        if (els.status) els.status.textContent = s;
        const stepping = (s === 'stopped');
        els.panel && els.panel.querySelectorAll('[data-act]').forEach(b => {
            if (b.dataset.act === 'stop') return;
            b.disabled = !stepping;
        });
    }

    // ========================================================================
    // BREAKPOINTS (Monaco glyph margin)
    // ========================================================================
    function wireEditor() {
        const ed = mainEditor();
        const monaco = mon();
        if (!ed || !monaco) { console.warn('[Debugger] editor/monaco unavailable at init'); return; }
        const MT = monaco.editor.MouseTargetType;
        // Accept any click in the left gutter (glyph margin, line numbers, or the
        // line-decorations strip) so the breakpoint target is easy to hit.
        const GUTTER = new Set([MT.GUTTER_GLYPH_MARGIN, MT.GUTTER_LINE_NUMBERS, MT.GUTTER_LINE_DECORATIONS]);
        ed.onMouseDown((e) => {
            const t = e.target && e.target.type;
            if (!GUTTER.has(t)) return;
            const line = e.target.position && e.target.position.lineNumber;
            if (!line) return;
            if (e.event && e.event.altKey) addConditionalBreakpoint(line);
            else toggleBreakpoint(line);
        });
    }

    function fileMap(path) {
        const k = norm(path);
        let m = bpByFile.get(k);
        if (!m) { m = new Map(); bpByFile.set(k, m); }
        return m;
    }

    async function toggleBreakpoint(line) {
        const path = activePath();
        if (!path) { sys('Save the file before setting breakpoints.', 'warning'); return; }
        const m = fileMap(path);
        if (m.has(line)) {
            const bp = m.get(line);
            m.delete(line);
            renderBreakpoints();            // instant visual feedback, before the gdb round-trip
            if (bp.id != null) { try { await api().debugRemoveBreakpoint(bp.id); } catch (_) { } }
        } else {
            const bp = { condition: null, id: null };
            m.set(line, bp);
            renderBreakpoints();            // instant visual feedback, before the gdb round-trip
            if (isSessionLive()) {
                const r = await api().debugSetBreakpoint({ file: path, line });
                if (r && r.ok) bp.id = r.id;
            }
        }
    }

    async function addConditionalBreakpoint(line) {
        const path = activePath();
        if (!path) return;
        const cond = window.prompt('Breakpoint condition (e.g. i==n-1):', '');
        if (cond === null) return;
        const m = fileMap(path);
        const bp = m.get(line) || { condition: null, id: null };
        bp.condition = cond.trim() || null;
        m.set(line, bp);
        if (isSessionLive()) {
            if (bp.id != null) { try { await api().debugRemoveBreakpoint(bp.id); } catch (_) { } }
            const r = await api().debugSetBreakpoint({ file: path, line, condition: bp.condition });
            if (r && r.ok) bp.id = r.id;
        }
        renderBreakpoints();
    }

    function renderBreakpoints() {
        const ed = mainEditor();
        const monaco = mon();
        if (!ed || !monaco) return;
        const path = activePath();
        const m = bpByFile.get(norm(path));
        const decos = [];
        if (m) {
            for (const [line, bp] of m.entries()) {
                decos.push({
                    range: new monaco.Range(line, 1, line, 1),
                    options: {
                        lineNumberClassName: bp.condition ? 'sameko-bp-linenum-cond' : 'sameko-bp-linenum',
                        glyphMarginClassName: bp.condition ? 'sameko-bp-cond' : 'sameko-bp-glyph',
                        glyphMarginHoverMessage: {
                            value: bp.condition ? 'Breakpoint if `' + bp.condition + '`' : 'Breakpoint',
                        },
                        stickiness: 1, // NeverGrowsWhenTypingAtEdges
                    },
                });
            }
        }
        bpDecoIds = ed.deltaDecorations(bpDecoIds, decos);
    }

    /** Re-render decorations when the visible file changes (tabs share one model). */
    function onFileShown() {
        renderBreakpoints();
        renderCurrentLine();
    }

    // ========================================================================
    // CURRENT LINE MARKER
    // ========================================================================
    let stopFile = null, stopLine = null;
    function renderCurrentLine() {
        const ed = mainEditor();
        const monaco = mon();
        if (!ed || !monaco) return;
        let decos = [];
        if (state === 'stopped' && stopLine && norm(stopFile) === norm(activePath())) {
            decos = [{
                range: new monaco.Range(stopLine, 1, stopLine, 1),
                options: {
                    isWholeLine: true,
                    className: 'sameko-curline',
                    glyphMarginClassName: 'sameko-arrow',
                },
            }];
            ed.revealLineInCenterIfOutsideViewport(stopLine);
            ed.setPosition({ lineNumber: stopLine, column: 1 });
        }
        curLineDecoIds = ed.deltaDecorations(curLineDecoIds, decos);
    }

    // ========================================================================
    // SESSION CONTROL
    // ========================================================================
    function isSessionLive() { return state === 'running' || state === 'stopped' || state === 'starting'; }

    async function start() {
        if (isSessionLive()) { return continueExec(); }
        let tab = activeTab();
        if (!tab) { sys('⚠ Open a C++ file before debugging.', 'error'); return; }
        if (!tab.path) {
            sys('⚠ Please save the file first (Ctrl+S) — the debugger needs a file on disk. Opening Save…', 'error');
            try { if (typeof window.saveAs === 'function') await window.saveAs(); } catch (_) { }
            tab = activeTab();
            if (!tab || !tab.path) { sys('Debug cancelled: file not saved.', 'warning'); return; }
        }
        const ed = mainEditor();
        if (ed) tab.content = ed.getValue();
        try { await api().saveFile({ path: tab.path, content: tab.content }); } catch (_) { }

        showPanel(true);
        setStatus('starting');
        lastRawEndedNL = true;
        sys('Debug: compiling with -g …', 'info');

        const std = (window.App.settings && window.App.settings.compiler && window.App.settings.compiler.cppStandard) || '';
        const flags = '-g -O0' + (std ? ' -std=' + std : '');
        const r = await api().compile({
            filePath: tab.path, content: tab.content, flags,
            singleFileMode: (window.App.settings?.compiler?.singleFileMode !== false),
            useLLD: false, noBuildCache: true, realtimeOutput: false,
        });
        if (!r || !r.success) {
            sys('Debug build failed.', 'error');
            if (r && r.error) sys(r.error, 'error');
            setStatus('idle'); showPanel(false);
            return;
        }

        const stdin = (document.getElementById('input-area') || {}).value || '';
        const bps = collectBreakpoints();
        const dir = tab.path.replace(/[\\/][^\\/]*$/, '');
        const res = await api().debugStart({ exePath: r.outputPath, cwd: dir, breakpoints: bps, stdin });
        if (!res || !res.ok) {
            sys('Debugger failed to start: ' + ((res && res.error) || 'unknown'), 'error');
            setStatus('idle'); showPanel(false);
            return;
        }
        // adopt gdb-assigned breakpoint ids
        if (res.breakpoints) {
            for (const b of res.breakpoints) {
                const m = bpByFile.get(norm(b.file));
                if (m && m.has(b.line)) m.get(b.line).id = b.id;
            }
        }
        sys('Debug session started.', 'success');
    }

    function collectBreakpoints() {
        const out = [];
        // resolve normalized keys back to a usable path via active tab set
        for (const [key, m] of bpByFile.entries()) {
            const realPath = resolveRealPath(key);
            for (const [line, bp] of m.entries()) {
                out.push({ file: realPath || key, line, condition: bp.condition });
            }
        }
        return out;
    }
    function resolveRealPath(normKey) {
        const tabs = (window.App && window.App.tabs) || [];
        const t = tabs.find(x => norm(x.path) === normKey);
        return t ? t.path : null;
    }

    async function continueExec() { if (state === 'stopped') { clearTrees(); await api().debugContinue(); } }
    async function stepOver() { if (state === 'stopped') { await api().debugStepOver(); } }
    async function stepInto() { if (state === 'stopped') { await api().debugStepInto(); } }
    async function stepOut() { if (state === 'stopped') { await api().debugStepOut(); } }

    async function stop() {
        try { await api().debugStop(); } catch (_) { }
        endSession();
    }

    function endSession() {
        setStatus('idle');
        stopFile = stopLine = null;
        renderCurrentLine();
        clearTrees();
        showPanel(false);
        // keep breakpoints (their ids are now stale; clear ids)
        for (const m of bpByFile.values()) for (const bp of m.values()) bp.id = null;
    }

    // ========================================================================
    // EVENTS FROM MAIN
    // ========================================================================
    function wireEvents() {
        const a = api();
        a.onDebugRunning(() => { setStatus('running'); stopFile = stopLine = null; renderCurrentLine(); });
        a.onDebugStopped((d) => onStopped(d));
        a.onDebugOutput((d) => { if (d && d.text) toTerminalRaw(d.text); });
        a.onDebugConsole((d) => { /* gdb chatter: keep quiet unless it's an error */ });
        a.onDebugProgramExited((d) => {
            freshLine();
            sys('Program exited (code ' + (d && d.code != null ? d.code : '?') + ').', 'system');
            endSession();
        });
        a.onDebugTerminated(() => { freshLine(); endSession(); });
        a.onDebugError((d) => { if (d && d.message) sys('[gdb] ' + d.message, 'error'); });
    }

    async function onStopped(d) {
        stopFrames = d.frames || [];
        selectedFrame = 0;
        stopFile = d.frame ? d.frame.file : (stopFrames[0] && stopFrames[0].file);
        stopLine = d.frame ? d.frame.line : (stopFrames[0] && stopFrames[0].line);
        setStatus('stopped');
        renderCurrentLine();
        renderStack();
        await refreshTrees(d.locals);
    }

    function renderStack() {
        els.stack.innerHTML = '';
        if (!stopFrames.length) { els.stack.innerHTML = '<div class="sdbg-empty">no frames</div>'; return; }
        stopFrames.forEach((f, i) => {
            const row = document.createElement('div');
            const sel = i === selectedFrame;
            row.className = 'sdbg-frame' + (sel ? ' sel' : '');
            const loc = (f.file ? f.file.split(/[\\/]/).pop() : '??') + (f.line ? ':' + f.line : '');
            row.innerHTML = `<span class="tick">${sel ? '✓' : ''}</span>`
                + `<span class="fn">${escapeHtml(f.func || '??')}</span> <span class="loc">${escapeHtml(loc)}</span>`;
            row.addEventListener('click', () => selectFrame(i));
            els.stack.appendChild(row);
        });
    }

    async function selectFrame(i) {
        if (i === selectedFrame) return;
        selectedFrame = i;
        renderStack();
        const r = await api().debugSelectFrame(i);
        if (r && r.ok) await refreshTrees(r.locals);
    }

    // ========================================================================
    // VARIABLE TREES (one mechanism: gdb variable objects)
    // ========================================================================
    async function refreshTrees(localsMaybe) {
        // free previous varobjs to avoid leaks
        for (const n of liveVarobjs) { try { await api().debugVarDelete(n); } catch (_) { } }
        liveVarobjs = [];

        let locals = localsMaybe;
        if (!locals) {
            try { const r = await api().debugSelectFrame(selectedFrame); locals = r && r.locals; } catch (_) { }
        }
        renderScope(els.locals, (locals || []).map(l => ({ label: l.name, expr: l.name, value: l.value })));
        renderScope(els.watch, watches.map(w => ({ label: w, expr: w, value: null, watch: true })));
    }

    function clearTrees() {
        if (els.locals) els.locals.innerHTML = '';
        if (els.watch) els.watch.innerHTML = '';
        if (els.stack) els.stack.innerHTML = '';
    }

    async function renderScope(container, entries) {
        container.innerHTML = '';
        if (!entries.length) { container.innerHTML = '<div class="sdbg-empty">—</div>'; return; }
        for (const e of entries) {
            const name = 'v' + (++varSeq);
            let created = null;
            try { const r = await api().debugVarCreate(name, e.expr); if (r && r.ok) created = r.var; }
            catch (_) { }
            if (!created) {
                // evaluate fallback (e.g. watch expr not addressable as a varobj)
                let val = e.value;
                if (val == null) { try { const ev = await api().debugEvaluate(e.expr); val = ev && ev.ok ? ev.value : '<error>'; } catch (_) { val = '<error>'; } }
                container.appendChild(makeRow(e.label, val, 0, false, e.watch));
                continue;
            }
            liveVarobjs.push(name);
            const numchild = parseInt(created.numchild || '0', 10);
            const row = makeRow(e.label, created.value, 0, numchild > 0, e.watch);
            container.appendChild(row);
            attachExpander(row, name, 1, numchild, container);
        }
    }

    function makeRow(label, value, depth, expandable, watch) {
        const row = document.createElement('div');
        row.className = 'sdbg-row';
        row.style.paddingLeft = (8 + depth * 14) + 'px';
        const tw = expandable ? '<span class="sdbg-tw">&#9654;</span>' : '<span class="sdbg-tw"></span>';
        row.innerHTML = `${tw}<span class="sdbg-name">${escapeHtml(label)}</span>`
            + `<span class="sdbg-eq">=</span><span class="sdbg-val">${escapeHtml(String(value))}</span>`;
        if (watch) {
            const del = document.createElement('span');
            del.textContent = ' ×';
            del.style.cssText = 'margin-left:auto;cursor:pointer;opacity:.5';
            del.title = 'Remove watch';
            del.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const idx = watches.indexOf(label);
                if (idx >= 0) { watches.splice(idx, 1); refreshTrees(); }
            });
            row.appendChild(del);
        }
        return row;
    }

    function attachExpander(row, varName, depth, numchild, container) {
        const tw = row.querySelector('.sdbg-tw');
        if (!tw || !numchild) return;
        let expanded = false;
        let childRows = [];
        tw.addEventListener('click', async () => {
            expanded = !expanded;
            tw.innerHTML = expanded ? '&#9660;' : '&#9654;';
            if (expanded) {
                const r = await api().debugVarChildren(varName, 0, Math.min(numchild, 200));
                const kids = (r && r.children) || [];
                let anchor = row;
                for (const c of kids) {
                    const cn = parseInt(c.numchild || '0', 10);
                    const cr = makeRow(c.exp || '?', c.value, depth, cn > 0, false);
                    row.parentNode.insertBefore(cr, anchor.nextSibling);
                    anchor = cr;
                    childRows.push(cr);
                    if (cn > 0 && c.name) attachExpander(cr, c.name, depth + 1, cn, container);
                }
                if (r && r.hasMore) {
                    const more = document.createElement('div');
                    more.className = 'sdbg-more';
                    more.textContent = '… more elements (showing first 200)';
                    row.parentNode.insertBefore(more, anchor.nextSibling);
                    childRows.push(more);
                }
            } else {
                childRows.forEach(n => n.remove());
                childRows = [];
            }
        });
    }

    // ========================================================================
    // HOVER EVALUATE
    // ========================================================================
    function wireHover() {
        const monaco = mon();
        if (!monaco || hoverProviderReg) return;
        hoverProviderReg = monaco.languages.registerHoverProvider('cpp', {
            provideHover: async (model, position) => {
                if (state !== 'stopped') return null;
                let expr = null;
                const sel = mainEditor() && mainEditor().getSelection();
                if (sel && !sel.isEmpty() && sel.containsPosition(position)) {
                    expr = model.getValueInRange(sel);
                } else {
                    const w = model.getWordAtPosition(position);
                    if (w) expr = w.word;
                }
                if (!expr) return null;
                try {
                    const r = await api().debugEvaluate(expr);
                    if (r && r.ok && r.value != null) {
                        return { contents: [{ value: '**' + expr + '** = `' + r.value + '`' }] };
                    }
                } catch (_) { }
                return null;
            },
        });
    }

    // ---- util --------------------------------------------------------------
    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }

    // ---- public api --------------------------------------------------------
    const Debugger = {
        init,
        start,
        continue: continueExec,
        stepOver, stepInto, stepOut,
        stop,
        onFileShown,
        isActive: () => isSessionLive(),
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = Debugger;
    if (typeof window !== 'undefined') window.Debugger = Debugger;
})();
