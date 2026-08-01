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
    const realPathByKey = new Map();    // normPath -> original-case path (survives tab close)
    let bpDecoIds = [];
    let curLineDecoIds = [];
    let hoverDecoIds = [];              // faint "ghost" glyph shown under the cursor in the gutter
    let hoverLine = 0;                  // last gutter line hovered (0 = none)
    let dbgStoppedCtx = null;           // Monaco context key: true only while stopped
    let hoverProviderReg = null;
    let varSeq = 0;
    // Registry of live GDB variable objects, keyed by varobj name. Each record
    // maps a varobj to its DOM value cell so `-var-update` can patch the exact
    // node in place (and flag it 'changed') instead of tearing the whole tree
    // down every stop. See applyVarUpdate().
    //   node = { row, name, exp, valEl, numchild, depth, expanded,
    //            childRows:[DOM], childNodes:[record], kind:'local'|'watch'|'child' }
    const varNodes = new Map();
    // Watch/expr rows with no backing varobj (not addressable). Re-evaluated on
    // every stop so they stay fresh — they just never get the yellow highlight.
    const evalNodes = [];               // [{ valEl, expr }]
    let lastFrameKey = null;            // identity of the frame the trees reflect
    let lastLocalNames = null;          // signature of the local name set
    const watches = [];                 // array of expression strings
    let stopFrames = [];
    let selectedFrame = 0;
    let lastRawEndedNL = true;           // did the last program-output chunk end with '\n'?

    // Bold, thick-stroke toolbar icons (matches the app's filled/thick icon style
    // rather than thin unicode glyphs). All 24×24, currentColor, sized via CSS.
    const SW = 'fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"';
    const DOT = '<circle cx="12" cy="18.6" r="1.8" fill="currentColor" stroke="none"/>';
    const ICONS = {
        play: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M8 5.4v13.2l10.6-6.6z"/></svg>',
        pause: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M7 5h3.2v14H7zm6.8 0H17v14h-3.2z"/></svg>',
        stop: '<svg viewBox="0 0 24 24"><rect x="6.5" y="6.5" width="11" height="11" rx="2.2" fill="currentColor"/></svg>',
        stepOver: `<svg viewBox="0 0 24 24" ${SW}><path d="M6 13.5a6 6 0 1 1 12 0"/><path d="M15.3 10.8 18 13.5l2.7-2.7"/>${DOT}</svg>`,
        stepInto: `<svg viewBox="0 0 24 24" ${SW}><path d="M12 4v9"/><path d="M8.2 9.3 12 13l3.8-3.7"/>${DOT}</svg>`,
        stepOut: `<svg viewBox="0 0 24 24" ${SW}><path d="M12 13V4"/><path d="M8.2 7.7 12 4l3.8 3.7"/>${DOT}</svg>`,
        close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
        help: `<svg viewBox="0 0 24 24" ${SW}><circle cx="12" cy="12" r="9"/><path d="M9.4 9.2a2.7 2.7 0 1 1 3.4 2.6c-.6.2-.8.7-.8 1.3v.4"/><circle cx="12" cy="17" r="1.2" fill="currentColor" stroke="none"/></svg>`,
        // Auto dry run: three "code lines" with an arrow walking down them.
        auto: `<svg viewBox="0 0 24 24" ${SW}><path d="M10.5 5.5H21M10.5 12H21M10.5 18.5H21"/><path d="M4.5 4.5v12.5"/><path d="M1.9 14.4 4.5 17l2.6-2.6"/></svg>`,
        // Back = the mirror of stepOver, so "hop back one line" reads as the
        // opposite of "hop forward one line" at a glance.
        back: `<svg viewBox="0 0 24 24" ${SW}><path d="M18 13.5a6 6 0 1 0-12 0"/><path d="M8.7 10.8 6 13.5l-2.7-2.7"/>${DOT}</svg>`,
        restart: `<svg viewBox="0 0 24 24" ${SW}><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20.3 3.6v4.6h-4.6"/></svg>`,
        bug: `<svg viewBox="0 0 24 24" ${SW}><rect x="8" y="7" width="8" height="12" rx="4"/><path d="M8 11H4m16 0h-4M8 16H4.6m15.4 0h-3.4M9.2 7.4 7.6 4.6m7.2 2.8 1.6-2.8"/></svg>`,
    };

    // Gutter marks, as data-URIs so the SAME image can be drawn in Monaco's glyph
    // margin AND in the legend inside the help popover — the legend can never
    // drift from what the editor actually shows.
    //   bp   solid red dot      = execution will pause here
    //   hit  red dot + arrow    = paused ON a breakpoint (line has NOT run yet)
    //   cur  yellow arrow       = paused here, no breakpoint
    const SVG = (body) => "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%3E" + body + '%3C/svg%3E';
    const GLYPH = {
        bp: SVG("%3Ccircle%20cx='12'%20cy='12'%20r='6.5'%20fill='%23e51400'/%3E"),
        cond: SVG("%3Ccircle%20cx='12'%20cy='12'%20r='6.5'%20fill='%23ff9e2c'/%3E"),
        pending: SVG("%3Ccircle%20cx='12'%20cy='12'%20r='6.5'%20fill='none'%20stroke='%238aa0b0'%20stroke-width='2.6'/%3E"),
        off: SVG("%3Ccircle%20cx='12'%20cy='12'%20r='6.5'%20fill='none'%20stroke='%237990a0'%20stroke-width='2.4'/%3E"),
        cur: SVG("%3Cpath%20d='M7%204.6v14.8L18.4%2012z'%20fill='%23ffcf5e'/%3E"),
        hit: SVG("%3Ccircle%20cx='12'%20cy='12'%20r='8.6'%20fill='%23e51400'/%3E%3Cpath%20d='M9.5%207.6v8.8L16.2%2012z'%20fill='%23ffcf5e'/%3E"),
        // Hollow arrow = a recorded step being replayed; the program is NOT here.
        hist: SVG("%3Cpath%20d='M8%205.6v12.8L17.2%2012z'%20fill='none'%20stroke='%23ffcf5e'%20stroke-width='2.1'%20stroke-linejoin='round'/%3E"),
    };

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
        /* One outline for the whole panel; everything inside is separated by
           hairlines and whitespace instead of nested boxes. */
        #sameko-debug-panel{position:fixed;top:66px;right:12px;bottom:12px;width:344px;
          background:var(--bg-glass-heavy,rgba(26,37,48,.97));color:var(--text-primary,#e0f0ff);
          border:1.5px solid var(--border-strong,var(--accent,#88c9ea));border-radius:var(--radius,20px);
          z-index:1400;display:none;flex-direction:column;font-family:'Nunito','Segoe UI',sans-serif;
          font-size:12.5px;box-shadow:var(--shadow-soft,0 12px 44px rgba(0,0,0,.4));overflow:hidden}
        #sameko-debug-panel.open{display:flex}
        /* Row 1: what the session is doing + the two window-ish buttons. */
        .sdbg-head-bar{display:flex;align-items:center;gap:6px;padding:7px 9px 4px;flex:0 0 auto}
        .sdbg-title{font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.09em;
          color:var(--text-muted,#7990a0);flex:0 0 auto}
        /* Row 2: transport. Every button is flex:1 over a shared row, so the set
           always spans the panel exactly — it can never wrap or overflow, at any
           panel width, and each target stays finger-sized. */
        .sdbg-toolbar{display:flex;flex-wrap:nowrap;gap:4px;padding:0 9px 8px;align-items:stretch;flex:0 0 auto;
          border-bottom:1px solid var(--border,#3a6075)}
        .sdbg-btn{background:var(--bg-button,rgba(136,201,234,.10));border:none;color:var(--text-secondary,#a9c2d4);
          border-radius:9px;flex:1 1 0;min-width:0;height:34px;cursor:pointer;font-size:12px;line-height:1;
          display:inline-flex;align-items:center;justify-content:center;padding:0;
          transition:background-color .12s,color .12s,opacity .12s}
        .sdbg-btn svg{width:18px;height:18px;display:block;pointer-events:none}
        /* The header-row buttons stay small and chromeless. */
        .sdbg-btn.sm{flex:0 0 auto;width:24px;height:24px;background:transparent;border-radius:7px}
        .sdbg-btn.sm svg{width:14px;height:14px}
        .sdbg-btn:hover:not(:disabled){background:var(--bg-button,rgba(136,201,234,.16));
          color:var(--accent,#88c9ea)}
        .sdbg-btn:disabled{opacity:.28;cursor:default}
        /* The primary Run/Continue/Pause button is filled with the accent so it
           reads as THE run button (no need to hunt for F5). */
        .sdbg-btn.primary{background:var(--accent,#88c9ea);color:#11212e;font-weight:800;margin-right:2px}
        .sdbg-btn.primary:hover:not(:disabled){background:var(--accent-hover,var(--accent,#88c9ea));
          color:#11212e;filter:brightness(1.06)}
        .sdbg-btn.primary:disabled{opacity:.45}
        .sdbg-btn.stop:hover:not(:disabled){background:rgba(255,107,129,.18);color:var(--error,#ff6b81)}
        /* A toggle that is currently ON (Auto dry run) stays filled. */
        .sdbg-btn.active,.sdbg-btn.active:hover:not(:disabled){background:var(--accent,#88c9ea);color:#11212e}
        /* Auto dry run strip — only visible while auto-stepping. */
        .sdbg-auto{display:none;align-items:center;gap:9px;padding:7px 11px;flex:0 0 auto;
          border-bottom:1px solid var(--border,#3a6075);background:var(--bg-button,rgba(136,201,234,.09))}
        .sdbg-auto.on{display:flex}
        .sdbg-auto .lbl{font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;
          color:var(--accent,#88c9ea);flex:0 0 auto}
        .sdbg-auto input[type=range]{flex:1 1 auto;min-width:0;height:3px;cursor:pointer;
          accent-color:var(--accent,#88c9ea)}
        .sdbg-auto .spd{flex:0 0 auto;font-family:${MONO};font-size:10px;
          color:var(--text-secondary,#a9c2d4);min-width:62px;text-align:right}
        /* A pause target inside the strip: while lines are flying past, the last
           thing a user should have to do is re-find a 34px icon in the toolbar. */
        .sdbg-auto-stop{flex:0 0 auto;border:none;cursor:pointer;border-radius:8px;
          background:var(--accent,#88c9ea);color:#11212e;font-weight:800;font-size:10px;
          text-transform:uppercase;letter-spacing:.05em;padding:5px 11px;
          font-family:'Nunito','Segoe UI',sans-serif}
        .sdbg-auto-stop:hover{filter:brightness(1.08)}
        /* Time-travel strip: shown only while browsing recorded history. */
        .sdbg-hist{display:none;align-items:center;gap:9px;padding:7px 11px;flex:0 0 auto;
          border-bottom:1px solid var(--border,#3a6075);background:rgba(255,207,94,.10)}
        .sdbg-hist.on{display:flex}
        .sdbg-hist .lbl{font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;
          color:#ffcf5e;flex:0 0 auto}
        .sdbg-hist-pos{flex:1 1 auto;min-width:0;font-family:${MONO};font-size:10.5px;
          color:var(--text-secondary,#a9c2d4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .sdbg-hist-live{flex:0 0 auto;border:none;cursor:pointer;border-radius:8px;background:#ffcf5e;
          color:#241300;font-weight:800;font-size:10px;padding:5px 11px;
          font-family:'Nunito','Segoe UI',sans-serif}
        .sdbg-hist-live:hover{filter:brightness(1.08)}
        /* Rows shown from a recording are not live values — say so quietly. */
        .sdbg-body.replay .sdbg-val{color:var(--text-secondary,#a9c2d4)}
        .sdbg-close:hover:not(:disabled){background:rgba(255,107,129,.18);color:var(--error,#ff6b81)}
        /* Status as a coloured dot + word: readable at a glance, no pill chrome. */
        .sdbg-status{margin-left:auto;flex:0 1 auto;min-width:0;display:flex;align-items:center;gap:6px;
          font-weight:800;font-size:9.5px;color:var(--text-muted,#7990a0);
          text-transform:uppercase;letter-spacing:.07em;padding:0 7px 0 4px;
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .sdbg-dot{width:7px;height:7px;border-radius:50%;flex:0 0 7px;background:var(--text-muted,#7990a0)}
        .sdbg-status[data-s="starting"]{color:var(--accent,#88c9ea)}
        .sdbg-status[data-s="starting"] .sdbg-dot{background:var(--accent,#88c9ea);animation:sdbg-pulse 1s ease-in-out infinite}
        .sdbg-status[data-s="running"]{color:#7fe0a8}
        .sdbg-status[data-s="running"] .sdbg-dot{background:#7fe0a8;animation:sdbg-pulse 1.1s ease-in-out infinite}
        .sdbg-status[data-s="stopped"]{color:#ffcf5e}
        .sdbg-status[data-s="stopped"] .sdbg-dot{background:#ffcf5e}
        @keyframes sdbg-pulse{0%,100%{opacity:1}50%{opacity:.3}}
        /* The body is a flex column of sections. Each open section scrolls on its
           own, so Watch and Call Stack stay reachable no matter how many locals
           there are (the old single-scroll body pushed them off-screen). */
        .sdbg-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow:hidden}
        /* Before the first stop there is no data at all — show ONE centred hint
           instead of three sections each saying "—". */
        .sdbg-body.empty>.sdbg-sec{display:none}
        .sdbg-body:not(.empty)>.sdbg-idle{display:none}
        .sdbg-idle{margin:auto;padding:20px 24px;text-align:center;color:var(--text-muted,#7990a0);
          font-size:12px;line-height:1.65}
        .sdbg-idle svg{width:30px;height:30px;opacity:.3;margin-bottom:11px}
        .sdbg-idle b{display:block;color:var(--text-secondary,#a9c2d4);font-weight:800;
          font-size:12.5px;margin-bottom:4px}
        /* The "how to start" hint is noise while a run is already in flight. */
        .sdbg-idle.busy>span{display:none}
        .sdbg-sec{display:flex;flex-direction:column;min-height:0;flex:0 0 auto;
          border-top:1px solid var(--border,#3a6075)}
        .sdbg-sec:first-of-type{border-top:none}
        /* Open sections size to their content and stack from the top, so slack
           collects in ONE place at the bottom instead of three gaps. When the
           content does overflow they shrink proportionally (Variables, being the
           tallest, keeps the largest share) and each scrolls on its own. */
        .sdbg-sec.open{flex:0 1 auto;min-height:66px}
        .sdbg-head{display:flex;align-items:center;gap:7px;padding:8px 11px;flex:0 0 auto;
          cursor:pointer;user-select:none;
          font-weight:800;text-transform:uppercase;letter-spacing:.08em;font-size:10px;
          color:var(--text-muted,#7990a0);transition:color .12s}
        .sdbg-head:hover{color:var(--accent,#88c9ea)}
        .sdbg-sec.open>.sdbg-head{color:var(--accent,#88c9ea)}
        .sdbg-caret{width:8px;height:8px;flex:0 0 8px;transition:transform .15s;
          border-left:4.5px solid currentColor;border-top:3.5px solid transparent;
          border-bottom:3.5px solid transparent;opacity:.85}
        .sdbg-sec.open>.sdbg-head .sdbg-caret{transform:rotate(90deg)}
        .sdbg-count{margin-left:auto;font-size:9.5px;font-weight:800;letter-spacing:.02em;
          color:var(--text-secondary,#a9c2d4);background:var(--bg-button,rgba(136,201,234,.16));
          border-radius:9px;padding:1px 7px;min-width:17px;text-align:center}
        .sdbg-count:empty{display:none}
        .sdbg-secbody{overflow:auto;min-height:0;flex:1 1 auto;padding-bottom:5px}
        .sdbg-sec:not(.open)>.sdbg-secbody,.sdbg-sec:not(.open)>.sdbg-watchin{display:none}
        .sdbg-row{display:flex;align-items:flex-start;padding:2px 10px;
          font-family:${MONO};cursor:default;line-height:1.55;border-radius:7px;margin:0 6px}
        .sdbg-row:hover{background:var(--bg-button,rgba(136,201,234,.14))}
        .sdbg-tw{width:15px;flex:0 0 15px;text-align:center;cursor:pointer;user-select:none;
          color:var(--text-muted,#7990a0)}
        .sdbg-name{color:var(--accent,#88c9ea);font-weight:700}
        .sdbg-eq{color:var(--text-muted,#7990a0);padding:0 5px;opacity:.65}
        .sdbg-val{color:var(--text-primary,#e0f0ff);white-space:pre-wrap;word-break:break-word}
        .sdbg-val.changed{color:#ffcf5e;font-weight:700}
        .sdbg-frame{display:flex;align-items:center;gap:6px;padding:3.5px 11px;cursor:pointer;
          border-left:3px solid transparent;margin:0 6px;border-radius:7px}
        .sdbg-frame:hover{background:var(--bg-button,rgba(136,201,234,.14))}
        .sdbg-frame.sel{border-left-color:var(--accent,#88c9ea);background:var(--bg-button,rgba(136,201,234,.22));font-weight:800}
        .sdbg-frame .tick{width:12px;flex:0 0 12px;color:var(--accent,#88c9ea);font-weight:900;font-size:12px}
        .sdbg-frame .fn{color:#7fe0a8;font-family:${MONO}}
        .sdbg-frame .loc{color:var(--text-muted,#7990a0);font-size:11px;margin-left:auto}
        /* Watch input: a quiet line that only lights up on focus. */
        .sdbg-watchin{width:calc(100% - 22px);margin:0 11px 5px;background:var(--bg-input,rgba(26,42,58,.55));
          border:1px solid transparent;color:var(--text-primary,#e0f0ff);border-radius:8px;
          padding:5px 9px;font-family:${MONO};font-size:11.5px;outline:none;flex:0 0 auto}
        .sdbg-watchin::placeholder{color:var(--text-muted,#7990a0);opacity:.75}
        .sdbg-watchin:focus{border-color:var(--accent,#88c9ea);background:var(--bg-input,#1a2a3a)}
        .sdbg-more{padding:3px 12px 5px 28px;color:var(--accent,#88c9ea);cursor:pointer;font-size:11px;font-weight:700}
        .sdbg-empty{color:var(--text-muted,#7990a0);padding:4px 17px;font-style:italic;font-size:11.5px}
        /* Remove-watch ×: dim until the row is hovered, red on target. */
        .sdbg-del{margin-left:auto;padding:0 3px;cursor:pointer;opacity:.3;font-weight:800;
          color:var(--text-muted,#7990a0);transition:opacity .12s,color .12s}
        .sdbg-row:hover .sdbg-del{opacity:.7}
        .sdbg-del:hover{opacity:1;color:var(--error,#ff6b81)}
        /* Shortcuts moved out of the footer into a popover on the ? button, so
           the panel spends its height on data instead of a static cheat sheet. */
        .sdbg-pop{position:absolute;top:42px;right:9px;left:9px;z-index:6;display:none;
          background:var(--bg-glass-heavy,rgba(26,37,48,.99));border:1.5px solid var(--border,#3a6075);
          border-radius:var(--radius-sm,12px);box-shadow:var(--shadow-soft,0 14px 36px rgba(0,0,0,.45));
          padding:11px 13px;color:var(--text-secondary,#a9c2d4);font-size:11px;line-height:1.6}
        .sdbg-pop.open{display:block}
        .sdbg-pop b{color:var(--text-primary,#e0f0ff);font-weight:700}
        .sdbg-pop-h{font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;
          color:var(--accent,#88c9ea);margin:0 0 6px}
        .sdbg-pop-h+*{margin-bottom:11px}
        .sdbg-pop-h:not(:first-child){padding-top:9px;border-top:1px solid var(--border,#3a6075)}
        /* Legend rows reuse the very images Monaco draws in the gutter. */
        .sdbg-legend>div{display:flex;align-items:flex-start;gap:8px;margin-bottom:4px}
        .sdbg-lg{width:15px;height:15px;flex:0 0 15px;margin-top:1px;background:center/14px no-repeat}
        .sdbg-lg.bp{background-image:url("${GLYPH.bp}")}
        .sdbg-lg.hit{background-image:url("${GLYPH.hit}")}
        .sdbg-lg.cur{background-image:url("${GLYPH.cur}")}
        .sdbg-lg.cond{background-image:url("${GLYPH.cond}")}
        .sdbg-lg.off{background-image:url("${GLYPH.off}")}
        .sdbg-lg.hist{background-image:url("${GLYPH.hist}")}
        .sdbg-keys{display:grid;grid-template-columns:1fr 1fr;gap:5px 12px}
        .sdbg-keys>div{display:flex;align-items:center;gap:5px}
        .sdbg-keys span{color:var(--text-secondary,#a9c2d4)}
        .sdbg-tips{margin:0;padding-left:15px}
        .sdbg-tips li{margin-bottom:3px}
        .sdbg-pop kbd,.sdbg-idle kbd{background:var(--btn-bg,var(--bg-button,#2a4050));
          border:1px solid var(--border,#3a6075);border-bottom-width:2px;
          border-radius:6px;padding:1px 6px;font-family:${MONO};font-size:10px;font-weight:700;
          color:var(--text-primary,#e0f0ff);min-width:16px;text-align:center;line-height:1.5}
        /* ---- gutter marks (see GLYPH above for what each one means) --------- */
        /* The line number itself becomes a solid badge so a breakpoint stays
           obvious even when the line-highlight sits on top of the gutter dot. */
        .sameko-bp-linenum{color:#fff!important;font-weight:800!important;background:#e51400;border-radius:5px}
        .sameko-bp-linenum-cond{color:#241300!important;font-weight:800!important;background:#ff9e2c;border-radius:5px}
        .sameko-bp-glyph{cursor:pointer;background:center/13px no-repeat url("${GLYPH.bp}")!important}
        .sameko-bp-cond{cursor:pointer;background:center/13px no-repeat url("${GLYPH.cond}")!important}
        /* Red-tinted whole line for an armed breakpoint (Dev-C++ feel). */
        .sameko-bp-line{background:rgba(229,20,0,.13)}
        /* Unresolved / pending breakpoint: a hollow, dim gray ring. */
        .sameko-bp-pending{cursor:pointer;opacity:.6;background:center/13px no-repeat url("${GLYPH.pending}")!important}
        .sameko-bp-linenum-pending{color:#11212e!important;font-weight:800!important;background:#8aa0b0;border-radius:5px}
        /* Disabled breakpoint: kept in place but off — hollow gray ring. */
        .sameko-bp-disabled{cursor:pointer;opacity:.5;background:center/13px no-repeat url("${GLYPH.off}")!important}
        .sameko-bp-linenum-disabled{color:#cfe0ea!important;font-weight:700!important;background:#5a6b78;border-radius:5px;opacity:.75}
        /* Hover affordance: a faint red dot under the cursor telling you "click
           here to set a breakpoint". Only on lines without a bp. */
        .sameko-bp-hover{cursor:pointer;opacity:.3;background:center/13px no-repeat url("${GLYPH.bp}")!important}
        .sameko-curline{background:rgba(255,207,94,.28)}
        /* Where execution is paused. On a plain line it's a yellow arrow; ON a
           breakpoint the arrow sits INSIDE the red dot, so "the program stopped
           here" is never confused with "a breakpoint lives here". */
        .sameko-arrow{background:center/15px no-repeat url("${GLYPH.cur}")!important}
        .sameko-arrow-bp{background:center/17px no-repeat url("${GLYPH.hit}")!important}
        /* The paused line's number turns yellow — the same "you are here" colour
           as the arrow and the line highlight. */
        .sameko-curline-num{color:#241300!important;font-weight:800!important;background:#ffcf5e;border-radius:5px}
        /* Replaying a recorded step: same colour family, hollow instead of solid,
           because the program is not actually sitting on this line. */
        .sameko-histline{background:rgba(255,207,94,.12);box-shadow:inset 2px 0 0 rgba(255,207,94,.55)}
        .sameko-hist-arrow{background:center/15px no-repeat url("${GLYPH.hist}")!important}
        /* First-run coach marks */
        #sameko-debug-guide{position:fixed;inset:0;z-index:1600;display:flex;align-items:flex-start;
          justify-content:center;padding-top:96px;background:rgba(6,12,18,.45);
          font-family:'Nunito','Segoe UI',sans-serif}
        .sdbg-guide-card{background:var(--bg-glass-heavy,rgba(26,37,48,.98));color:var(--text-primary,#e0f0ff);
          border:2.5px solid var(--accent,#88c9ea);border-radius:18px;padding:18px 20px;max-width:440px;
          box-shadow:0 18px 60px rgba(0,0,0,.5)}
        .sdbg-guide-h{color:var(--accent,#88c9ea);font-weight:900;text-transform:uppercase;letter-spacing:.06em;
          font-size:12px;margin-bottom:12px}
        .sdbg-guide-step{display:flex;gap:10px;align-items:flex-start;margin-bottom:9px;font-size:12.5px;line-height:1.5}
        .sdbg-guide-step b:first-child{flex:0 0 20px;height:20px;border-radius:50%;background:var(--accent,#88c9ea);
          color:#11212e;display:inline-flex;align-items:center;justify-content:center;font-weight:900;font-size:11px}
        .sdbg-guide-dot{color:#ff5964;font-size:11px}
        .sdbg-guide-step kbd{background:var(--bg-button,#2a4050);border:1px solid var(--border,#3a6075);
          border-radius:5px;padding:0 5px;font-family:${MONO};font-size:10px}
        .sdbg-guide-ok{margin-top:8px;background:var(--accent,#88c9ea);color:#11212e;border:none;
          border-radius:10px;padding:8px 18px;font-weight:800;cursor:pointer;font-size:12px}
        .sdbg-guide-ok:hover{filter:brightness(1.08)}
        /* Text prompt (Electron has no window.prompt) — used for conditional
           breakpoints. Same card language as the coach-mark guide. */
        #sameko-debug-prompt{position:fixed;inset:0;z-index:1700;display:flex;align-items:flex-start;
          justify-content:center;padding-top:120px;background:rgba(6,12,18,.5);
          font-family:'Nunito','Segoe UI',sans-serif}
        .sdbg-prompt-card{background:var(--bg-glass-heavy,rgba(26,37,48,.98));color:var(--text-primary,#e0f0ff);
          border:2px solid var(--accent,#88c9ea);border-radius:var(--radius-sm,14px);padding:16px 18px;
          width:min(420px,90vw);box-shadow:var(--shadow-soft,0 18px 60px rgba(0,0,0,.5))}
        .sdbg-prompt-h{color:var(--accent,#88c9ea);font-weight:800;font-size:12px;text-transform:uppercase;
          letter-spacing:.05em;margin-bottom:10px}
        .sdbg-prompt-in{width:100%;background:var(--bg-input,#1a2a3a);color:var(--text-primary,#e0f0ff);
          border:1.5px solid var(--border,#3a6075);border-radius:10px;padding:8px 11px;
          font-family:${MONO};font-size:13px;outline:none}
        .sdbg-prompt-in:focus{border-color:var(--accent,#88c9ea)}
        .sdbg-prompt-row{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
        .sdbg-prompt-row button{border:none;border-radius:9px;padding:7px 16px;font-weight:800;
          font-size:12px;cursor:pointer;font-family:'Nunito','Segoe UI',sans-serif}
        .sdbg-prompt-cancel{background:var(--btn-bg,#2a4050);color:var(--text-primary,#e0f0ff)}
        .sdbg-prompt-ok{background:var(--accent,#88c9ea);color:#11212e}
        .sdbg-prompt-ok:hover,.sdbg-prompt-cancel:hover{filter:brightness(1.08)}`;
        const style = document.createElement('style');
        style.id = 'sameko-debug-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }

    let els = {};

    // ---- section (accordion) state -----------------------------------------
    // Which sections are expanded, persisted so the panel returns the way it was
    // left. Call Stack starts collapsed: with a single frame it is pure noise.
    const SEC_KEY = 'sameko-debug-sections';
    const secOpen = { locals: true, watch: true, stack: false };
    const secTouched = new Set();      // sections the user opened/closed by hand
    try {
        const saved = JSON.parse(localStorage.getItem(SEC_KEY) || 'null');
        if (saved) for (const k of Object.keys(secOpen)) if (typeof saved[k] === 'boolean') secOpen[k] = saved[k];
    } catch (_) { }

    /** One collapsible section: clickable header + count badge + scrolling body. */
    function sectionHtml(id, label, extra) {
        return `
            <div class="sdbg-sec${secOpen[id] ? ' open' : ''}" data-sec="${id}">
              <div class="sdbg-head"><span class="sdbg-caret"></span>${label}<span class="sdbg-count" id="sdbg-n-${id}"></span></div>
              ${extra || ''}
              <div class="sdbg-secbody" id="sdbg-${id}"></div>
            </div>`;
    }

    /** Expand/collapse a section; `auto` = a suggestion the user's choice overrides. */
    function setSection(id, open, auto) {
        if (auto && secTouched.has(id)) return;
        const sec = els.panel && els.panel.querySelector(`.sdbg-sec[data-sec="${id}"]`);
        if (!sec) return;
        secOpen[id] = open;
        sec.classList.toggle('open', open);
        if (!auto) { try { localStorage.setItem(SEC_KEY, JSON.stringify(secOpen)); } catch (_) { } }
    }

    /** Count badge next to a section title (blank when 0 — an empty badge hides). */
    function setCount(id, n) {
        const el = els.panel && els.panel.querySelector('#sdbg-n-' + id);
        if (el) el.textContent = n ? String(n) : '';
    }

    // ---- auto dry run ------------------------------------------------------
    // A "dry run" the way it is taught on paper: the debugger walks the program
    // one line at a time on a timer while the Variables tree updates, so a
    // learner can WATCH values change instead of pressing F10 a hundred times.
    const AUTO_TITLE = 'Auto dry run — walk through the program line by line, hands off';
    const AUTO_KEY = 'sameko-debug-auto-delay';
    let autoRunning = false;
    let autoTimer = null;
    let autoSteps = 0;
    // Default deliberately unhurried: at 0.6s a short program was over before a
    // user could read a line, let alone reach for the stop button.
    let autoDelay = 1000;                    // ms between lines
    try {
        const v = parseInt(localStorage.getItem(AUTO_KEY), 10);
        if (v >= 150 && v <= 3000) autoDelay = v;
    } catch (_) { }

    // 1000 -> "1s / line", 600 -> "0.6s / line" (no trailing ".0" or ".50").
    function autoLabel() { return (autoDelay / 1000).toFixed(2).replace(/\.?0+$/, '') + 's / line'; }

    function updateAutoUI() {
        if (!els.panel) return;
        const strip = els.panel.querySelector('.sdbg-auto');
        if (strip) strip.classList.toggle('on', autoRunning);
        const btn = els.panel.querySelector('[data-act="auto"]');
        if (btn) {
            btn.classList.toggle('active', autoRunning);
            btn.title = autoRunning ? 'Stop auto dry run' : AUTO_TITLE;
        }
        if (els.autoSpd) els.autoSpd.textContent = autoLabel();
    }

    async function toggleAuto() {
        if (autoRunning) { stopAuto('Auto dry run stopped after ' + autoSteps + ' line(s).'); return; }
        if (state === 'running' || state === 'starting') return;
        autoRunning = true;
        autoSteps = 0;
        updateAutoUI();
        if (state === 'stopped') { scheduleAutoStep(); return; }
        // Nothing running yet — start a session that pauses on main(), so the dry
        // run has a first line even when no breakpoint is set.
        sys('Auto dry run: starting at main(), one line every ' + autoLabel().replace(' / line', '') + '.', 'system');
        await start({ breakAtMain: true });
        if (state === 'idle') stopAuto(null);   // start() bailed out (no file / build failed)
    }

    function stopAuto(msg) {
        if (!autoRunning) return;
        autoRunning = false;
        if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
        updateAutoUI();
        if (msg) sys(msg, 'system');
    }

    /**
     * Queue the next line. Re-armed from onStopped, so one step = one stop.
     *
     * Uses Step INTO, not Step Over: a dry run is supposed to walk every line the
     * program executes, including the bodies of the user's own functions (Step
     * Over would skip `solve()` entirely and the run would be over in five
     * lines). The gdbinit skip rules keep this out of libstdc++.
     */
    function scheduleAutoStep() {
        if (autoTimer) clearTimeout(autoTimer);
        autoTimer = setTimeout(() => {
            autoTimer = null;
            if (!autoRunning || state !== 'stopped') return;
            autoSteps++;
            stepInto();
        }, autoDelay);
    }

    // ---- recorded history ("Back") -----------------------------------------
    // GDB on Windows/MinGW cannot execute backwards (reverse execution needs
    // Linux process-record), so Back replays a RECORDING instead: every stop
    // appends a snapshot of where the program was and what the locals held.
    // Browsing it is a read-only view — the program itself never moves.
    const HIST_MAX = 800;
    const history = [];
    let histIndex = -1;                 // -1 = live, otherwise an index into history
    let histDecoIds = [];

    function recordStep(d) {
        history.push({
            file: stopFile,
            line: stopLine,
            func: (stopFrames[0] && stopFrames[0].func) || (d.frame && d.frame.func) || '',
            locals: (d.locals || []).map(l => ({ name: l.name, value: l.value })),
        });
        if (history.length > HIST_MAX) history.shift();
    }

    function isReplaying() { return histIndex >= 0; }

    /** Show recorded step `i` (editor line + the locals as they were then). */
    function showHistory(i) {
        const h = history[i];
        if (!h) return;
        histIndex = i;
        if (els.body) els.body.classList.add('replay');
        const strip = els.panel && els.panel.querySelector('.sdbg-hist');
        if (strip) strip.classList.add('on');
        if (els.histPos) {
            const where = [h.func ? h.func + '()' : '', h.line ? 'line ' + h.line : '']
                .filter(Boolean).join(' ');
            els.histPos.textContent = 'step ' + (i + 1) + ' / ' + history.length
                + (where ? ' · ' + where : '');
        }
        setCount('locals', h.locals.length);
        els.locals.innerHTML = '';
        if (!h.locals.length) els.locals.innerHTML = '<div class="sdbg-empty">no locals recorded here</div>';
        else for (const l of h.locals) els.locals.appendChild(makeRow(l.name, l.value, 0, false, false));
        showTrees();
        renderHistoryLine(h);
        setStatus(state);               // re-applies the transport rules for replay
    }

    /** Highlight the recorded line in the editor (distinct from the live arrow). */
    function renderHistoryLine(h) {
        const ed = mainEditor();
        const monaco = mon();
        if (!ed || !monaco) return;
        let decos = [];
        if (h && h.line && norm(h.file) === norm(activePath())) {
            decos = [{
                range: new monaco.Range(h.line, 1, h.line, 1),
                options: {
                    isWholeLine: true,
                    className: 'sameko-histline',
                    glyphMarginClassName: 'sameko-hist-arrow',
                    glyphMarginHoverMessage: { value: 'Recorded step — the program is not here right now' },
                },
            }];
            ed.revealLineInCenterIfOutsideViewport(h.line);
        }
        histDecoIds = ed.deltaDecorations(histDecoIds, decos);
    }

    /** One step back through the recording. */
    function stepBack() {
        stopAuto(null);
        if (!history.length) { sys('Nothing recorded yet — run the program first.', 'system'); return; }
        const cur = isReplaying() ? histIndex : history.length - 1;
        if (cur <= 0) { sys('Already at the first recorded line.', 'system'); return; }
        showHistory(cur - 1);
    }

    /**
     * The middle button does double duty: while replaying it walks FORWARD
     * through the recording (and hands control back at the end); live, it is the
     * normal one-line step.
     */
    function forwardOrStep() {
        if (isReplaying()) {
            if (histIndex >= history.length - 1) { backToLive(); return; }
            showHistory(histIndex + 1);
            return;
        }
        stopAuto(null);
        stepOver();
    }

    /** Leave the recording and show the program where it actually is. */
    async function backToLive() {
        if (!isReplaying()) return;
        histIndex = -1;
        if (els.body) els.body.classList.remove('replay');
        const strip = els.panel && els.panel.querySelector('.sdbg-hist');
        if (strip) strip.classList.remove('on');
        renderHistoryLine(null);
        if (state === 'stopped') await refreshTrees();
        else setTreesPlaceholder('Session ended · F5 to run again.');
        setStatus(state);
    }

    /** Stop whatever is running and start the whole program over. */
    async function restart() {
        stopAuto(null);
        await backToLive();
        sys('Restarting…', 'system');
        if (isSessionLive()) {
            try { await api().debugStop(); } catch (_) { }
            endSession('Restarting…');
            // Give gdb a moment to release the .exe before the rebuild relinks it.
            await new Promise((r) => setTimeout(r, 350));
        }
        await start();
    }

    function buildPanel() {
        if (document.getElementById('sameko-debug-panel')) return;
        const p = document.createElement('div');
        p.id = 'sameko-debug-panel';
        p.innerHTML = `
          <div class="sdbg-head-bar">
            <span class="sdbg-title">Debugger</span>
            <span class="sdbg-status" data-s="idle"><span class="sdbg-dot"></span><span class="sdbg-status-t">idle</span></span>
            <button class="sdbg-btn sm sdbg-help-btn" data-act="help" title="Shortcuts &amp; tips">${ICONS.help}</button>
            <button class="sdbg-btn sm sdbg-close" data-act="close" title="Close this panel">${ICONS.close}</button>
          </div>
          <div class="sdbg-toolbar">
            <button class="sdbg-btn primary" data-act="primary" title="Run (F5)">${ICONS.play}</button>
            <button class="sdbg-btn" data-act="back" title="Back — replay the previous step from the recorded history">${ICONS.back}</button>
            <button class="sdbg-btn" data-act="stepOver" title="Next line (F10) — run this line without going inside calls">${ICONS.stepOver}</button>
            <button class="sdbg-btn" data-act="stepInto" title="Step Into (F11) — go inside the function on this line">${ICONS.stepInto}</button>
            <button class="sdbg-btn" data-act="stepOut" title="Step Out (Shift+F11) — finish this function and return">${ICONS.stepOut}</button>
            <button class="sdbg-btn" data-act="auto" title="${AUTO_TITLE}">${ICONS.auto}</button>
            <button class="sdbg-btn" data-act="restart" title="Restart — build and run the program again from the top">${ICONS.restart}</button>
            <button class="sdbg-btn stop" data-act="stop" title="Stop (Shift+F5) — end the debug session">${ICONS.stop}</button>
          </div>
          <div class="sdbg-hist">
            <span class="lbl">History</span>
            <span class="sdbg-hist-pos"></span>
            <button class="sdbg-hist-live">Back to live</button>
          </div>
          <div class="sdbg-pop">
            <div class="sdbg-pop-h">Marks in the gutter</div>
            <div class="sdbg-legend">
              <div><span class="sdbg-lg bp"></span><span><b>Breakpoint</b> — the program pauses here</span></div>
              <div><span class="sdbg-lg cur"></span><span><b>Paused here.</b> This line has <b>not run yet</b> — it runs on your next step</span></div>
              <div><span class="sdbg-lg hit"></span><span>Paused <b>on</b> a breakpoint (both of the above)</span></div>
              <div><span class="sdbg-lg cond"></span><span><b>Conditional</b> — pauses only when your condition is true</span></div>
              <div><span class="sdbg-lg off"></span><span><b>Disabled</b> — kept, but ignored this run</span></div>
              <div><span class="sdbg-lg hist"></span><span><b>Replay</b> — a recorded step you are looking back at; the program is not here</span></div>
            </div>
            <div class="sdbg-pop-h">Keys</div>
            <div class="sdbg-keys">
              <div><kbd>F5</kbd><span>Run / Continue</span></div>
              <div><kbd>F10</kbd><span>Step over</span></div>
              <div><kbd>F11</kbd><span>Step into</span></div>
              <div><kbd>Shift</kbd><kbd>F11</kbd><span>Step out</span></div>
              <div><kbd>Shift</kbd><kbd>F5</kbd><span>Stop</span></div>
            </div>
            <div class="sdbg-pop-h">Mouse</div>
            <ul class="sdbg-tips">
              <li>Click the gutter to add a breakpoint — <b>Alt</b>+click for conditional, <b>Ctrl</b>+click to turn one off</li>
              <li>Right-click a line → <b>Run to Cursor</b></li>
              <li>Double-click a value → hexadecimal / decimal</li>
            </ul>
            <div class="sdbg-pop-h">Auto dry run</div>
            <ul class="sdbg-tips">
              <li>Walks your program <b>one line at a time by itself</b> while the values update — no breakpoint needed, it begins at <b>main()</b></li>
              <li>Drag the speed slider at any moment; <b>Pause</b>, <kbd>Esc</kbd>, or any step of your own stops it</li>
            </ul>
            <div class="sdbg-pop-h">Back &amp; Restart</div>
            <ul class="sdbg-tips">
              <li><b>Back</b> looks at a <b>recording</b> of the steps you have already taken — the program itself cannot run backwards, so this is a read-only replay. <kbd>Esc</kbd> or <b>Back to live</b> returns you to the present</li>
              <li><b>Restart</b> stops the session and runs the whole program again from the top</li>
            </ul>
          </div>
          <div class="sdbg-auto">
            <span class="lbl">Auto</span>
            <input type="range" class="sdbg-speed" min="150" max="3000" step="50" />
            <span class="spd"></span>
            <button class="sdbg-auto-stop">Pause</button>
          </div>
          <div class="sdbg-body empty">
            <div class="sdbg-idle">
              ${ICONS.bug}
              <b class="sdbg-idle-t">Set a breakpoint, then F5.</b>
              <span>Click the left gutter to add one · <kbd>F5</kbd> runs</span>
            </div>
            ${sectionHtml('locals', 'Variables')}
            ${sectionHtml('watch', 'Watch', '<input class="sdbg-watchin" id="sdbg-watchin" placeholder="+ expression, Enter…" />')}
            ${sectionHtml('stack', 'Call Stack')}
          </div>`;
        document.body.appendChild(p);
        els = {
            panel: p,
            status: p.querySelector('.sdbg-status'),
            statusText: p.querySelector('.sdbg-status-t'),
            body: p.querySelector('.sdbg-body'),
            idleText: p.querySelector('.sdbg-idle-t'),
            pop: p.querySelector('.sdbg-pop'),
            autoSpd: p.querySelector('.sdbg-auto .spd'),
            autoSpeed: p.querySelector('.sdbg-speed'),
            histPos: p.querySelector('.sdbg-hist-pos'),
            stack: p.querySelector('#sdbg-stack'),
            locals: p.querySelector('#sdbg-locals'),
            watch: p.querySelector('#sdbg-watch'),
            watchIn: p.querySelector('#sdbg-watchin'),
        };
        p.querySelectorAll('.sdbg-btn').forEach(b => {
            b.addEventListener('click', () => {
                const a = b.dataset.act;
                // Any manual transport command takes the wheel back from auto.
                if (a === 'primary') { stopAuto(null); primaryAction(); }
                else if (a === 'close') { showPanel(false); if (isSessionLive()) stop(); }
                else if (a === 'back') stepBack();
                else if (a === 'stepOver') forwardOrStep();
                else if (a === 'stepInto') { stopAuto(null); stepInto(); }
                else if (a === 'stepOut') { stopAuto(null); stepOut(); }
                else if (a === 'restart') restart();
                else if (a === 'stop') stop();
                else if (a === 'auto') toggleAuto();
                else if (a === 'help') showPop(!els.pop.classList.contains('open'));
            });
        });
        // Section headers toggle their body. A manual toggle wins over the
        // automatic open/close rules for the rest of the session.
        p.querySelectorAll('.sdbg-sec').forEach(sec => {
            const id = sec.dataset.sec;
            sec.querySelector('.sdbg-head').addEventListener('click', () => {
                secTouched.add(id);
                setSection(id, !sec.classList.contains('open'), false);
            });
        });
        // Dismiss the shortcuts popover on any click outside it (except the ?
        // button itself, which toggles) and on Escape.
        p.addEventListener('mousedown', (e) => {
            if (!els.pop.classList.contains('open')) return;
            if (els.pop.contains(e.target) || e.target.closest('.sdbg-help-btn')) return;
            showPop(false);
        }, true);
        p.addEventListener('keydown', (e) => { if (e.key === 'Escape') showPop(false); });
        // Big, unmissable pause target while lines are flying past.
        const autoStopBtn = p.querySelector('.sdbg-auto-stop');
        if (autoStopBtn) autoStopBtn.addEventListener('click', () => stopAuto('Auto dry run paused after ' + autoSteps + ' line(s).'));
        const liveBtn = p.querySelector('.sdbg-hist-live');
        if (liveBtn) liveBtn.addEventListener('click', () => backToLive());
        // Escape is the universal "make it stop". Bound on the document because
        // the panel never holds focus; the conditions are narrow enough that it
        // cannot swallow anyone else's Escape.
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (!els.panel || !els.panel.classList.contains('open')) return;
            if (autoRunning) { e.preventDefault(); stopAuto('Auto dry run paused after ' + autoSteps + ' line(s).'); }
            else if (isReplaying()) { e.preventDefault(); backToLive(); }
        });
        // Speed slider — takes effect on the very next line, mid-run.
        els.autoSpeed.value = String(autoDelay);
        els.autoSpeed.addEventListener('input', () => {
            autoDelay = parseInt(els.autoSpeed.value, 10) || 600;
            try { localStorage.setItem(AUTO_KEY, String(autoDelay)); } catch (_) { }
            updateAutoUI();
        });
        updateAutoUI();
        els.watchIn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && els.watchIn.value.trim()) {
                watches.push(els.watchIn.value.trim());
                els.watchIn.value = '';
                setCount('watch', watches.length);
                if (state === 'stopped') refreshTrees();
            }
        });
        // Friendly empty state before the first run (panel opened via the bug icon).
        setTreesPlaceholder('Set a breakpoint, then F5.');
        // Reflect the idle state immediately so Step/Stop aren't shown as clickable
        // before a session exists.
        setStatus('idle');
    }

    function wireToolbar() {
        const btn = document.getElementById('btn-debug');
        // The toolbar bug icon just SHOWS/HIDES the debug sidebar — it does not
        // start a run. Runs begin with F5 or the ▶| button inside the panel.
        if (btn) btn.addEventListener('click', () => togglePanel());
    }

    function togglePanel() {
        const open = els.panel && els.panel.classList.contains('open');
        if (open) { showPanel(false); return; }
        showPanel(true);
        maybeShowGuide();
    }

    function showPanel(show) {
        els.panel && els.panel.classList.toggle('open', show);
        if (!show) showPop(false);
    }
    /** Show/hide the shortcuts popover. */
    function showPop(show) { els.pop && els.pop.classList.toggle('open', !!show); }
    function setStatus(s) {
        state = s;
        if (els.statusText) els.statusText.textContent = s;
        if (els.status) els.status.dataset.s = s;
        if (dbgStoppedCtx) { try { dbgStoppedCtx.set(s === 'stopped'); } catch (_) { } }
        const live = (s === 'running' || s === 'stopped' || s === 'starting');
        // The primary button morphs with the run lifecycle (Run ▶ / Continue ▶ / Pause ‖).
        const prim = els.panel && els.panel.querySelector('[data-act="primary"]');
        if (prim) {
            if (s === 'running') { prim.innerHTML = ICONS.pause; prim.title = 'Pause — interrupt to inspect'; prim.disabled = false; }
            else if (s === 'stopped') { prim.innerHTML = ICONS.play; prim.title = 'Continue (F5)'; prim.disabled = false; }
            else if (s === 'starting') { prim.innerHTML = ICONS.play; prim.title = 'Starting…'; prim.disabled = true; }
            else { prim.innerHTML = ICONS.play; prim.title = 'Run (F5)'; prim.disabled = false; }
        }
        // While auto-stepping, the session flickers stopped→running→stopped many
        // times a second. Treating those blips as "paused" keeps the buttons from
        // strobing — and keeps a click from landing in a disabled millisecond.
        const eff = (autoRunning && s === 'running') ? 'stopped' : s;
        els.panel && els.panel.querySelectorAll('[data-act]').forEach(b => {
            const act = b.dataset.act;
            if (act === 'primary') return;                             // handled above
            if (act === 'close' || act === 'help') { b.disabled = false; return; }  // always available
            if (act === 'stop') { b.disabled = !live; return; }        // stop only when a session exists
            // Auto dry run can START from idle (it launches its own session) or
            // from a pause, and must stay clickable while running so it can be
            // switched off mid-flight.
            if (act === 'auto') { b.disabled = autoRunning ? false : (s === 'running' || s === 'starting'); return; }
            // Back reads the recording, so it works even after the program ended.
            if (act === 'back') { b.disabled = history.length === 0 || histIndex === 0; return; }
            if (act === 'restart') { b.disabled = (eff === 'running' || eff === 'starting'); return; }
            b.disabled = (eff !== 'stopped');                          // steps only while paused
        });
        // While browsing the recording nothing may move the program forward —
        // only Back / Forward / Back-to-live / Stop stay usable.
        if (els.panel && isReplaying()) {
            for (const a of ['primary', 'stepInto', 'stepOut', 'auto', 'restart']) {
                const b = els.panel.querySelector(`[data-act="${a}"]`);
                if (b) b.disabled = true;
            }
            const nx = els.panel.querySelector('[data-act="stepOver"]');
            if (nx) nx.disabled = false;      // forward through history
        }
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
            const ev = e.event;
            // Left button only — right/middle click in the gutter must not drop a
            // breakpoint (it opens the context menu / does nothing).
            if (ev && ev.leftButton === false) return;
            const line = e.target.position && e.target.position.lineNumber;
            if (!line) return;
            if (ev && ev.altKey) addConditionalBreakpoint(line);
            else if (ev && (ev.ctrlKey || ev.metaKey)) toggleEnableBreakpoint(line);
            else toggleBreakpoint(line);
        });

        // Hover affordance: show a faint breakpoint under the cursor while it is
        // over the gutter so it's obvious where to click.
        ed.onMouseMove((e) => {
            const t = e.target && e.target.type;
            const line = (GUTTER.has(t) && e.target.position) ? e.target.position.lineNumber : 0;
            if (line === hoverLine) return;
            hoverLine = line;
            renderHoverGlyph();
        });
        ed.onMouseLeave(() => { if (hoverLine) { hoverLine = 0; renderHoverGlyph(); } });

        // Run to Cursor — context-menu action, visible only while stopped (via a
        // context key) instead of always showing and no-oping.
        try {
            if (ed.createContextKey) dbgStoppedCtx = ed.createContextKey('samekoDebugStopped', false);
            ed.addAction({
                id: 'sameko-run-to-cursor',
                label: 'Debug: Run to Cursor',
                contextMenuGroupId: 'debug',
                contextMenuOrder: 1.5,
                precondition: dbgStoppedCtx ? 'samekoDebugStopped' : undefined,
                run: (edi) => {
                    if (state !== 'stopped') return;
                    const path = activePath();
                    const pos = edi.getPosition && edi.getPosition();
                    if (path && pos) { try { api().debugRunToLine(path, pos.lineNumber); } catch (_) { } }
                },
            });
        } catch (_) { /* older Monaco without addAction — skip */ }
    }

    /** Draw/clear the faint hover breakpoint (skipped on lines that already have one). */
    function renderHoverGlyph() {
        const ed = mainEditor();
        const monaco = mon();
        if (!ed || !monaco) return;
        let decos = [];
        const m = bpByFile.get(norm(activePath()));
        if (hoverLine && !(m && m.has(hoverLine))) {
            decos = [{
                range: new monaco.Range(hoverLine, 1, hoverLine, 1),
                options: { glyphMarginClassName: 'sameko-bp-hover' },
            }];
        }
        hoverDecoIds = ed.deltaDecorations(hoverDecoIds, decos);
    }

    /** Ctrl/Cmd+click a breakpoint to toggle enabled/disabled (keeps the entry). */
    async function toggleEnableBreakpoint(line) {
        const path = activePath();
        if (!path) return;
        const m = bpByFile.get(norm(path));
        const bp = m && m.get(line);
        if (!bp) { toggleBreakpoint(line); return; }   // nothing there → fall back to add
        bp.enabled = bp.enabled === false;             // flip (undefined/true -> false, false -> true)
        renderBreakpoints();
        if (bp.id != null && isSessionLive()) {
            try {
                if (bp.enabled) await api().debugEnableBreakpoint(bp.id);
                else await api().debugDisableBreakpoint(bp.id);
            } catch (_) { }
        }
    }

    function fileMap(path) {
        const k = norm(path);
        if (path) realPathByKey.set(k, path);   // remember original-case path
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
            const bp = { condition: null, id: null, enabled: true };
            m.set(line, bp);
            renderBreakpoints();            // instant visual feedback, before the gdb round-trip
            // Only insert immediately when stopped. In all-stop mode gdb may not
            // accept -break-insert while the inferior is running, so defer to the
            // next stop (syncPendingBreakpoints picks up id==null entries).
            if (state === 'stopped') {
                const r = await api().debugSetBreakpoint({ file: path, line });
                if (r && r.ok) {
                    bp.id = r.id;
                    if (r.line && r.line !== line) { m.delete(line); m.set(r.line, bp); renderBreakpoints(); }
                }
            } else if (state === 'running' || state === 'starting') {
                sys('Breakpoint will apply on next pause.', 'system');
            }
        }
    }

    // Promise-based text prompt. Electron does NOT implement window.prompt(), so
    // we roll our own modal (styled like the rest of the debugger). Resolves to
    // the entered string, or null if cancelled.
    function promptText({ title, placeholder, initial }) {
        return new Promise((resolve) => {
            const ov = document.createElement('div');
            ov.id = 'sameko-debug-prompt';
            ov.innerHTML = `
              <div class="sdbg-prompt-card">
                <div class="sdbg-prompt-h">${escapeHtml(title || 'Input')}</div>
                <input class="sdbg-prompt-in" type="text" placeholder="${escapeHtml(placeholder || '')}" />
                <div class="sdbg-prompt-row">
                  <button class="sdbg-prompt-cancel">Cancel</button>
                  <button class="sdbg-prompt-ok">OK</button>
                </div>
              </div>`;
            document.body.appendChild(ov);
            const input = ov.querySelector('.sdbg-prompt-in');
            input.value = initial || '';
            let done = false;
            const finish = (val) => { if (done) return; done = true; try { ov.remove(); } catch (_) { } resolve(val); };
            ov.querySelector('.sdbg-prompt-ok').addEventListener('click', () => finish(input.value));
            ov.querySelector('.sdbg-prompt-cancel').addEventListener('click', () => finish(null));
            ov.addEventListener('click', (e) => { if (e.target === ov) finish(null); });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); finish(input.value); }
                else if (e.key === 'Escape') { e.preventDefault(); finish(null); }
            });
            setTimeout(() => { try { input.focus(); input.select(); } catch (_) { } }, 30);
        });
    }

    async function addConditionalBreakpoint(line) {
        const path = activePath();
        if (!path) { sys('Save the file before setting breakpoints.', 'warning'); return; }
        const m = fileMap(path);
        const existing = m.get(line);
        const cond = await promptText({
            title: 'Conditional breakpoint',
            placeholder: 'e.g. i == n-1   (blank = always break)',
            initial: (existing && existing.condition) || '',
        });
        if (cond === null) return;   // cancelled
        const bp = existing || { condition: null, id: null, enabled: true };
        bp.condition = cond.trim() || null;
        m.set(line, bp);
        if (state === 'stopped') {
            if (bp.id != null) { try { await api().debugRemoveBreakpoint(bp.id); } catch (_) { } bp.id = null; }
            const r = await api().debugSetBreakpoint({ file: path, line, condition: bp.condition });
            if (r && r.ok) {
                bp.id = r.id;
                if (r.line && r.line !== line) { m.delete(line); m.set(r.line, bp); }
            }
        } else if (state === 'running' || state === 'starting') {
            sys('Breakpoint will apply on next pause.', 'system');
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
            // Line the program is paused on, if it is in this file. Its glyph is
            // drawn by renderCurrentLine() as a red dot WITH the arrow inside, so
            // the breakpoint here must not paint a plain dot over the top of it.
            const pausedHere = (state === 'stopped' && stopLine && norm(stopFile) === norm(path)) ? stopLine : 0;
            for (const [line, bp] of m.entries()) {
                const disabled = bp.enabled === false;
                // Tint the whole line red only for an armed (enabled, resolved)
                // breakpoint — disabled/pending ones just get the gutter ring.
                const armed = !disabled && !bp.pending;
                const isPaused = line === pausedHere;
                decos.push({
                    range: new monaco.Range(line, 1, line, 1),
                    options: {
                        isWholeLine: armed ? true : undefined,
                        className: armed ? 'sameko-bp-line' : undefined,
                        lineNumberClassName: isPaused ? 'sameko-curline-num'
                            : disabled ? 'sameko-bp-linenum-disabled'
                                : bp.pending ? 'sameko-bp-linenum-pending'
                                    : bp.condition ? 'sameko-bp-linenum-cond' : 'sameko-bp-linenum',
                        glyphMarginClassName: isPaused ? undefined
                            : disabled ? 'sameko-bp-disabled'
                                : bp.pending ? 'sameko-bp-pending'
                                    : bp.condition ? 'sameko-bp-cond' : 'sameko-bp-glyph',
                        glyphMarginHoverMessage: {
                            value: isPaused ? 'Paused on this breakpoint — this line has not run yet'
                                : disabled ? 'Breakpoint (disabled — Ctrl+click to enable)'
                                    : bp.pending ? 'Unresolved breakpoint'
                                        : bp.condition ? 'Breakpoint if `' + bp.condition + '`' : 'Breakpoint',
                        },
                        stickiness: 1, // NeverGrowsWhenTypingAtEdges
                    },
                });
            }
        }
        bpDecoIds = ed.deltaDecorations(bpDecoIds, decos);
        renderHoverGlyph();   // keep the hover ghost consistent with real breakpoints
        // Adding/removing a breakpoint ON the paused line flips its mark between
        // the plain arrow and the dot+arrow, so the paused mark is redrawn too.
        renderCurrentLine(false);
    }

    /** Re-render decorations when the visible file changes (tabs share one model). */
    function onFileShown() {
        renderBreakpoints();
        renderCurrentLine(true);
    }

    // ========================================================================
    // CURRENT LINE MARKER
    // ========================================================================
    let stopFile = null, stopLine = null;
    /**
     * @param {boolean} [reveal] Scroll to and select the paused line. Only true
     *   when the pause itself moved (a stop / a file switch) — redrawing marks
     *   after a gutter click must NOT yank the caret away from the user.
     */
    function renderCurrentLine(reveal) {
        const ed = mainEditor();
        const monaco = mon();
        if (!ed || !monaco) return;
        let decos = [];
        if (state === 'stopped' && stopLine && norm(stopFile) === norm(activePath())) {
            // On a breakpoint the mark becomes the red dot with the arrow inside,
            // so "paused here" and "breakpoint here" stay tellable apart.
            const m = bpByFile.get(norm(stopFile));
            const bp = m && m.get(stopLine);
            const onBp = !!(bp && bp.enabled !== false && !bp.pending);
            decos = [{
                range: new monaco.Range(stopLine, 1, stopLine, 1),
                options: {
                    isWholeLine: true,
                    className: 'sameko-curline',
                    glyphMarginClassName: onBp ? 'sameko-arrow-bp' : 'sameko-arrow',
                    glyphMarginHoverMessage: {
                        value: onBp
                            ? 'Paused on this breakpoint — this line has not run yet'
                            : 'Paused here — this line has not run yet',
                    },
                    lineNumberClassName: onBp ? undefined : 'sameko-curline-num',
                },
            }];
            if (reveal) {
                ed.revealLineInCenterIfOutsideViewport(stopLine);
                ed.setPosition({ lineNumber: stopLine, column: 1 });
            }
        }
        curLineDecoIds = ed.deltaDecorations(curLineDecoIds, decos);
    }

    // ========================================================================
    // SESSION CONTROL
    // ========================================================================
    function isSessionLive() { return state === 'running' || state === 'stopped' || state === 'starting'; }

    async function start(opts) {
        // `breakAtMain` makes the run pause on the program's first line even with
        // no breakpoints set — Auto dry run needs somewhere to begin.
        const breakAtMain = !!(opts && opts.breakAtMain === true);
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
        maybeShowGuide();
        // A fresh run means a fresh recording.
        history.length = 0;
        histIndex = -1;
        setStatus('starting');
        setTreesPlaceholder('Compiling…');
        lastRawEndedNL = true;
        // Beginner safety net: a debug run with no breakpoints just runs to the
        // end and exits, which looks like "nothing happened". Nudge, don't block.
        if (!hasAnyBreakpoint() && !breakAtMain) {
            sys('No breakpoints — the program won’t pause. Click the gutter to add one.', 'warning');
        }
        sys('Compiling with -g …', 'info');

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
            setStatus('idle');
            setTreesPlaceholder('Build failed — see terminal.');
            return;
        }

        const stdin = (document.getElementById('input-area') || {}).value || '';
        const bps = collectBreakpoints();
        const dir = tab.path.replace(/[\\/][^\\/]*$/, '');
        const res = await api().debugStart({ exePath: r.outputPath, cwd: dir, breakpoints: bps, stdin, breakAtMain });
        if (!res || !res.ok) {
            sys('Debugger failed to start: ' + ((res && res.error) || 'unknown'), 'error');
            setStatus('idle');
            setTreesPlaceholder('Couldn’t start — see terminal.');
            return;
        }
        // adopt gdb-assigned breakpoint ids, relocating the glyph when gdb moved
        // the breakpoint to the next executable line.
        if (res.breakpoints) {
            for (const b of res.breakpoints) {
                const m = bpByFile.get(norm(b.file));
                if (!m || !m.has(b.line)) continue;
                const bp = m.get(b.line);
                bp.id = b.id;
                if (b.resolvedLine && b.resolvedLine !== b.line) {
                    m.delete(b.line);
                    m.set(b.resolvedLine, bp);
                }
                // Breakpoints toggled off before the session started: insert then
                // disable so gdb won't stop on them.
                if (bp.enabled === false) { try { await api().debugDisableBreakpoint(bp.id); } catch (_) { } }
            }
            renderBreakpoints();
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
        // Prefer a live tab; fall back to the original-case path we recorded when
        // the breakpoint was created (so a closed tab's bp still resolves in gdb).
        return (t && t.path) || realPathByKey.get(normKey) || null;
    }

    // Insert any breakpoints that were added/edited while the program was running
    // (they were deferred with id==null). Called on each stop. Already-inserted
    // breakpoints (id != null) are skipped.
    async function syncPendingBreakpoints() {
        let moved = false;
        for (const [key, m] of bpByFile.entries()) {
            const realPath = resolveRealPath(key) || key;
            for (const [line, bp] of Array.from(m.entries())) {
                if (bp.id != null) continue;
                try {
                    const r = await api().debugSetBreakpoint({ file: realPath, line, condition: bp.condition });
                    if (r && r.ok) {
                        bp.id = r.id;
                        if (r.line && r.line !== line) { m.delete(line); m.set(r.line, bp); moved = true; }
                        if (bp.enabled === false) { try { await api().debugDisableBreakpoint(bp.id); } catch (_) { } }
                    }
                } catch (_) { }
            }
        }
        if (moved) renderBreakpoints();
    }

    // Keep the trees (and their varobjs) intact across a continue so the next
    // stop can diff incrementally via -var-update. The values simply show the
    // last-known state while the program runs.
    // One primary button drives the whole run lifecycle, like a media play/pause:
    //   idle/ended → start a fresh run   ·   stopped → continue   ·   running → pause
    // so the user never needs to reach for F5.
    function primaryAction() {
        if (state === 'running') return pauseExec();
        if (state === 'stopped') return continueExec();
        return start();
    }
    async function continueExec() { if (state === 'stopped') { await api().debugContinue(); } }
    // Interrupt a running inferior (-exec-interrupt) so the user can inspect
    // state mid-run. gdb replies with a *stopped(reason="signal-received").
    async function pauseExec() { if (state === 'running') { try { await api().debugInterrupt(); } catch (_) { } } }
    async function stepOver() { if (state === 'stopped') { await api().debugStepOver(); } }
    async function stepInto() { if (state === 'stopped') { await api().debugStepInto(); } }
    async function stepOut() { if (state === 'stopped') { await api().debugStepOut(); } }

    async function stop() {
        try { await api().debugStop(); } catch (_) { }
        endSession(undefined, true);
    }

    /**
     * @param {string} [reason] Message left in the panel's idle state.
     * @param {boolean} [force] Allow ending a session that is still starting.
     *   Only an explicit Stop passes this: a late `terminated`/`exited` event
     *   from the PREVIOUS gdb can land after the next session has begun starting
     *   (Stop then immediately Run again), and it must not tear the new one down
     *   — that race was silently cancelling Auto dry run.
     */
    function endSession(reason, force) {
        if (state === 'idle') return;    // idempotent — programExited + terminated may both fire
        if (state === 'starting' && !force) return;
        stopAuto(autoRunning ? 'Auto dry run finished after ' + autoSteps + ' line(s).' : null);
        setStatus('idle');
        stopFile = stopLine = null;
        renderCurrentLine();
        // gdb is gone — the varobjs died with it; just drop our registry.
        varNodes.clear();
        evalNodes.length = 0;
        lastFrameKey = lastLocalNames = null;
        // Keep the panel OPEN with an idle message. Yanking it away the instant a
        // program finishes looked like a crash — the user closes it via ✕.
        setTreesPlaceholder(reason || 'Set a breakpoint, then F5.');
        // keep breakpoints, but their gdb ids + pending flags are now stale.
        for (const m of bpByFile.values()) for (const bp of m.values()) { bp.id = null; bp.pending = false; }
        renderBreakpoints();
    }

    // ========================================================================
    // EVENTS FROM MAIN
    // ========================================================================
    function wireEvents() {
        const a = api();
        a.onDebugRunning(() => {
            setStatus('running');
            stopFile = stopLine = null;
            renderCurrentLine();
            // Never hit a breakpoint yet: say what is happening instead of
            // leaving "Compiling…" on screen for the whole run.
            if (els.body && els.body.classList.contains('empty')) setTreesPlaceholder('Running…');
        });
        a.onDebugStopped((d) => onStopped(d));
        a.onDebugOutput((d) => { if (d && d.text) toTerminalRaw(d.text); });
        a.onDebugConsole((d) => { /* gdb chatter: keep quiet unless it's an error */ });
        a.onDebugProgramExited((d) => {
            freshLine();
            const code = d && d.code != null ? d.code : '?';
            sys('Program exited (code ' + code + ').', 'system');
            endSession('Finished (exit ' + code + ') · F5 to run again.');
        });
        a.onDebugTerminated(() => { freshLine(); endSession('Session ended · F5 to run again.'); });
        a.onDebugError((d) => { if (d && d.message) sys('[gdb] ' + d.message, 'error'); });
        a.onDebugNotify((n) => onNotify(n));
    }

    /** Locate a tracked breakpoint by its gdb-assigned id. */
    function findBpById(id) {
        for (const [key, m] of bpByFile.entries())
            for (const [line, bp] of m.entries())
                if (bp.id === id) return { key, line, bp, map: m };
        return null;
    }

    // React to gdb breakpoint lifecycle events. gdb relocates a breakpoint to
    // the next executable line when you drop it on a blank/comment line, and
    // reports pending/unresolved ones — keep the glyph in sync with reality.
    function onNotify(n) {
        if (!n || !/^breakpoint-/.test(n.class || '')) return;
        const bkpt = n.results && n.results.bkpt;
        if (!bkpt || bkpt.number == null) return;
        const id = parseInt(bkpt.number, 10);

        if (n.class === 'breakpoint-deleted') {
            const hit = findBpById(id);
            if (hit) { hit.map.delete(hit.line); renderBreakpoints(); }
            return;
        }

        const hit = findBpById(id);
        if (!hit) return;                          // a breakpoint we don't own (race or gdb-internal)

        const newLine = bkpt.line ? parseInt(bkpt.line, 10) : hit.line;
        // Pending/unresolved: gdb reports a `pending` field and addr="<PENDING>".
        // (addr="<MULTIPLE>" is resolved — several locations — so not pending.)
        const wasPending = !!hit.bp.pending;
        hit.bp.pending = bkpt.pending != null || !bkpt.addr || /pending/i.test(String(bkpt.addr));

        if (newLine && newLine !== hit.line) {
            hit.map.delete(hit.line);
            hit.map.set(newLine, hit.bp);
            sys(`Breakpoint moved to line ${newLine}.`, 'system');
        }
        if (hit.bp.pending && !wasPending) sys('Unresolved breakpoint (pending).', 'warning');
        renderBreakpoints();
    }

    /** Frame identity used to decide "same place" (incremental) vs "rebuild". */
    function frameKey(f) { return f ? ((f.func || '') + '@' + (f.file || '')) : ''; }
    function localNamesSig(locals) { return (locals || []).map(l => l.name).sort().join(','); }

    let stopToken = 0;
    async function onStopped(d) {
        const myToken = ++stopToken;   // supersede any older stop still mid-refresh
        // The program just moved, so a recording view is no longer what's on
        // screen — drop back to live before rendering the new state.
        if (isReplaying()) {
            histIndex = -1;
            if (els.body) els.body.classList.remove('replay');
            const strip = els.panel && els.panel.querySelector('.sdbg-hist');
            if (strip) strip.classList.remove('on');
            renderHistoryLine(null);
        }
        stopFrames = d.frames || [];
        selectedFrame = 0;
        // Prefer the innermost frame that actually has a source file for the
        // arrow marker. gdb usually stops user code at frame 0, but a stop with
        // no source there (rare) shouldn't leave the marker nowhere.
        const srcFrame = (d.frame && d.frame.file) ? d.frame : (stopFrames.find(f => f && f.file) || d.frame || null);
        stopFile = srcFrame ? srcFrame.file : null;
        stopLine = srcFrame ? srcFrame.line : null;
        setStatus('stopped');
        // A pause (interrupt) surfaces as a signal stop — note it, don't alarm.
        if (d.reason && /signal/.test(d.reason)) sys('Paused.', 'system');
        // Bring the stopped file into view (open it or switch tabs) so the arrow
        // is actually visible for multi-file programs.
        await revealFile(stopFile);
        if (myToken !== stopToken) return;   // a newer stop took over
        renderCurrentLine(true);
        // Breakpoint glyphs depend on where we are paused (the paused line shows
        // the combined dot+arrow mark), so they have to be redrawn on every stop.
        renderBreakpoints();
        renderStack();
        recordStep(d);
        // The single most common beginner misreading, answered once per session:
        // a breakpoint looks like "where the program starts" because everything
        // before it ran in microseconds with nothing to see.
        if (history.length === 1 && stopLine) {
            sys('Paused at line ' + stopLine + '. Everything above it has already run — '
                + 'a breakpoint stops the program there, it does not start it.', 'system');
        }
        // Apply any breakpoints that were deferred while the program was running.
        await syncPendingBreakpoints();
        if (myToken !== stopToken) return;

        // Incremental refresh when we are still in the same frame (same function
        // + same set of locals) as the trees currently show. Otherwise the whole
        // scope changed, so rebuild. This preserves expanded subtrees and lets
        // -var-update highlight only the values that actually changed.
        const frame0 = stopFrames[0] || d.frame || null;
        const key = frameKey(frame0);
        const names = localNamesSig(d.locals);
        if (varNodes.size === 0 || key !== lastFrameKey || names !== lastLocalNames) {
            lastFrameKey = key;
            lastLocalNames = names;
            await refreshTrees(d.locals);
        } else {
            await applyVarUpdate();
        }

        // Auto dry run: the trees now show this line's state — queue the next one.
        // Re-arming here (rather than on a fixed interval) keeps exactly one step
        // in flight, so a slow stop can never stack up steps behind it.
        if (autoRunning && myToken === stopToken) scheduleAutoStep();
    }

    /** Open/switch to a file so its current-line arrow and breakpoints are visible. */
    async function revealFile(path) {
        if (!path) return;
        // Map gdb's path to an already-open tab (case/slash-insensitive) so we
        // switch to it rather than opening a duplicate tab.
        const tabs = (window.App && window.App.tabs) || [];
        const existing = tabs.find(t => t.path && norm(t.path) === norm(path));
        const target = existing ? existing.path : path;
        if (norm(target) === norm(activePath())) return;
        const fn = (typeof openFileFromPath === 'function') ? openFileFromPath
            : (typeof window.openFileFromPath === 'function' ? window.openFileFromPath : null);
        if (fn) { try { await fn(target); } catch (_) { } }
    }

    function renderStack() {
        showTrees();
        setCount('stack', stopFrames.length);
        // One frame is just `main` — not worth the vertical space. Expand the
        // section by itself once execution is actually nested in calls (unless
        // the user has taken manual control of this section).
        setSection('stack', stopFrames.length > 1, true);
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
        if (r && r.ok) {
            // Trees now reflect this frame; record its identity so the next stop
            // (which resets to frame 0) sees a mismatch and rebuilds correctly.
            lastFrameKey = frameKey(stopFrames[i]);
            lastLocalNames = localNamesSig(r.locals);
            await refreshTrees(r.locals);
        }
    }

    // ========================================================================
    // VARIABLE TREES (one mechanism: gdb variable objects)
    // ========================================================================
    async function refreshTrees(localsMaybe) {
        // Full rebuild: drop every existing varobj, then recreate from scratch.
        // Used on the first stop, on a frame change, and on watch add/remove —
        // cases where the whole variable set changed.
        await deleteAllVarobjs();

        let locals = localsMaybe;
        if (!locals) {
            try { const r = await api().debugSelectFrame(selectedFrame); locals = r && r.locals; } catch (_) { }
        }
        await renderScope(els.locals, (locals || []).map(l => ({ label: l.name, expr: l.name, value: l.value })), 'local');
        await renderScope(els.watch, watches.map(w => ({ label: w, expr: w, value: null, watch: true })), 'watch');
    }

    /** Delete every tracked varobj in gdb and empty the registry. */
    async function deleteAllVarobjs() {
        const names = Array.from(varNodes.keys());
        varNodes.clear();
        evalNodes.length = 0;
        for (const n of names) { try { await api().debugVarDelete(n); } catch (_) { } }
    }

    /** Beginner-friendly empty state while there's nothing to show yet.
     *  With no session there is no data in ANY section, so hide all three and
     *  show a single centred message instead of three rows of dashes. */
    function setTreesPlaceholder(msg) {
        if (els.idleText) els.idleText.textContent = msg;
        if (els.body) els.body.classList.add('empty');
        // Hide the "set a breakpoint" hint while compiling/running — it only
        // applies when the user is the one who has to act next.
        const idle = els.panel && els.panel.querySelector('.sdbg-idle');
        if (idle) idle.classList.toggle('busy', state === 'starting' || state === 'running');
        if (els.stack) els.stack.innerHTML = '';
        if (els.locals) els.locals.innerHTML = '';
        if (els.watch) els.watch.innerHTML = '';
        setCount('locals', 0);
        setCount('stack', 0);
        setCount('watch', watches.length);
    }

    /** Live data arrived — swap the idle message back out for the sections. */
    function showTrees() { if (els.body) els.body.classList.remove('empty'); }

    function hasAnyBreakpoint() {
        for (const m of bpByFile.values()) if (m.size) return true;
        return false;
    }

    // First-run coach marks: a small 3-step guide over the editor, shown once.
    // Dismissed permanently via localStorage so it never nags returning users.
    function maybeShowGuide() {
        try { if (localStorage.getItem('sameko-debug-guide-seen')) return; } catch (_) { }
        if (document.getElementById('sameko-debug-guide')) return;
        const g = document.createElement('div');
        g.id = 'sameko-debug-guide';
        g.innerHTML = `
          <div class="sdbg-guide-card">
            <div class="sdbg-guide-h">Debugging in 3 steps</div>
            <div class="sdbg-guide-step"><b>1</b><span>Click the <b>left gutter</b> (next to a line number) to drop a red breakpoint <span class="sdbg-guide-dot">●</span></span></div>
            <div class="sdbg-guide-step"><b>2</b><span>Press <kbd>F5</kbd> — your program runs and <b>pauses</b> at the breakpoint</span></div>
            <div class="sdbg-guide-step"><b>3</b><span><kbd>F10</kbd> step over · <kbd>F11</kbd> step into · <kbd>F5</kbd> continue · hover a variable to see its value</span></div>
            <button class="sdbg-guide-ok" data-close>Got it</button>
          </div>`;
        document.body.appendChild(g);
        const close = () => { try { g.remove(); } catch (_) { } try { localStorage.setItem('sameko-debug-guide-seen', '1'); } catch (_) { } };
        const btn = g.querySelector('[data-close]');
        if (btn) btn.addEventListener('click', close);
        g.addEventListener('click', (e) => { if (e.target === g) close(); });
    }

    async function renderScope(container, entries, kind) {
        container.innerHTML = '';
        setCount(kind === 'watch' ? 'watch' : 'locals', entries.length);
        if (!entries.length) {
            container.innerHTML = '<div class="sdbg-empty">'
                + (kind === 'watch' ? 'nothing watched yet' : 'no locals in this frame') + '</div>';
            return;
        }
        for (const e of entries) {
            const name = 'v' + (++varSeq);
            let created = null;
            try { const r = await api().debugVarCreate(name, e.expr); if (r && r.ok) created = r.var; }
            catch (_) { }
            if (!created) {
                // evaluate fallback (e.g. watch expr not addressable as a varobj)
                let val = e.value;
                if (val == null) { try { const ev = await api().debugEvaluate(e.expr); val = ev && ev.ok ? ev.value : '<error>'; } catch (_) { val = '<error>'; } }
                const row = makeRow(e.label, val, 0, false, e.watch);
                container.appendChild(row);
                // Track eval-only rows so they can be re-evaluated on each stop.
                if (e.watch) evalNodes.push({ valEl: row.querySelector('.sdbg-val'), expr: e.expr });
                continue;
            }
            const numchild = parseInt(created.numchild || '0', 10);
            const expandable = isExpandable(created);
            const row = makeRow(e.label, created.value, 0, expandable, e.watch);
            container.appendChild(row);
            const node = {
                row, name, exp: e.expr, valEl: row.querySelector('.sdbg-val'),
                numchild, expandable, depth: 0, expanded: false, childRows: [], childNodes: [], kind,
            };
            varNodes.set(name, node);
            attachFormatToggle(node);
            if (expandable) attachExpander(node);
        }
    }

    // A varobj is expandable if it has children directly, OR it is a dynamic
    // (pretty-printed) container — those report numchild="0" with dynamic="1"/
    // has_more="1" and only materialize children via -var-list-children.
    function isExpandable(rec) {
        if (!rec) return false;
        return parseInt(rec.numchild || '0', 10) > 0 || rec.has_more === '1' || rec.dynamic === '1';
    }

    // ---- incremental value refresh (-var-update) ---------------------------
    // On a stop in the same frame, diff instead of rebuild: ask gdb which
    // varobjs changed, patch only those value cells, and paint them yellow.
    async function applyVarUpdate() {
        let changed = [];
        try { const r = await api().debugVarUpdate(); changed = (r && r.changed) || []; } catch (_) { }
        // reset last step's highlights
        for (const n of varNodes.values()) { if (n.valEl) n.valEl.classList.remove('changed'); }

        for (const c of changed) {
            const node = varNodes.get(c.name);
            if (!node) continue;                       // not currently rendered (e.g. collapsed subtree)
            const scope = c.in_scope;
            if (scope === 'invalid' || c.type_changed === 'true' || c.type_changed === true) {
                // Type changed or the object is gone. Leave it; the next frame
                // change rebuilds cleanly. Keep this minimal by design.
                continue;
            }
            if (scope === 'false' || scope === false) {
                if (node.valEl) node.valEl.textContent = '<out of scope>';
                continue;
            }
            if (c.value !== undefined && node.valEl) {
                node.valEl.textContent = c.value;
                node.valEl.classList.add('changed');
            }
            const ncc = c.new_num_children != null ? parseInt(c.new_num_children, 10) : null;
            if (ncc != null) node.numchild = ncc;
            // Only re-list children when the child COUNT actually changed (a
            // dynamic container grew/shrank). Same-size content changes surface
            // as individual child entries in the changelist and are patched
            // above, so re-listing then would needlessly collapse subtrees.
            if (ncc != null && node.expanded) {
                await reloadChildren(node);
            }
        }

        // Watches without a varobj don't appear in the changelist — refresh them.
        for (const en of evalNodes) {
            if (!en.valEl) continue;
            try {
                const ev = await api().debugEvaluate(en.expr);
                const val = ev && ev.ok ? String(ev.value) : '<error>';
                const changedVal = en.valEl.textContent !== val;
                en.valEl.textContent = val;
                en.valEl.classList.toggle('changed', changedVal);
            } catch (_) { }
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
            del.className = 'sdbg-del';
            del.textContent = '×';
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

    /** Double-click a value to toggle hexadecimal / decimal display (gdb -var-set-format). */
    function attachFormatToggle(node) {
        if (!node.valEl) return;
        node.valEl.title = 'Double-click: toggle hex / dec';
        node.valEl.addEventListener('dblclick', async (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            if (state !== 'stopped') return;
            const next = node.fmt === 'hex' ? 'decimal' : 'hexadecimal';
            try {
                const r = await api().debugVarSetFormat(node.name, next);
                if (r && r.ok && r.value != null) {
                    node.valEl.textContent = r.value;
                    node.fmt = (next === 'hexadecimal') ? 'hex' : 'dec';
                }
            } catch (_) { }
        });
    }

    function attachExpander(node) {
        const tw = node.row.querySelector('.sdbg-tw');
        if (!tw || !node.expandable) return;
        tw.addEventListener('click', async () => {
            if (node.expanded) { collapseChildren(node); tw.innerHTML = '&#9654;'; }
            else { tw.innerHTML = '&#9660;'; node.expanded = true; await loadChildren(node); }
        });
    }

    /** Fetch and render a node's children, registering each child varobj. */
    async function loadChildren(node) {
        // Dynamic containers report numchild=0; request a full window regardless.
        const to = node.numchild > 0 ? Math.min(node.numchild, 200) : 200;
        const r = await api().debugVarChildren(node.name, 0, to);
        const kids = (r && r.children) || [];
        let anchor = node.row;
        for (const c of kids) {
            const cn = parseInt(c.numchild || '0', 10);
            const cExpandable = isExpandable(c);
            const cr = makeRow(c.exp || '?', c.value, node.depth + 1, cExpandable, false);
            node.row.parentNode.insertBefore(cr, anchor.nextSibling);
            anchor = cr;
            node.childRows.push(cr);
            if (c.name) {
                const child = {
                    row: cr, name: c.name, exp: c.exp, valEl: cr.querySelector('.sdbg-val'),
                    numchild: cn, expandable: cExpandable, depth: node.depth + 1, expanded: false,
                    childRows: [], childNodes: [], kind: 'child',
                };
                varNodes.set(c.name, child);
                node.childNodes.push(child);
                attachFormatToggle(child);
                if (cExpandable) attachExpander(child);
            }
        }
        if (r && r.hasMore) {
            const more = document.createElement('div');
            more.className = 'sdbg-more';
            more.textContent = '… more elements (showing first 200)';
            node.row.parentNode.insertBefore(more, anchor.nextSibling);
            node.childRows.push(more);
        }
    }

    /** Collapse a node: remove its child DOM rows and unregister the subtree. */
    function collapseChildren(node) {
        for (const child of node.childNodes) removeNode(child);
        node.childNodes = [];
        for (const cr of node.childRows) cr.remove();
        node.childRows = [];
        node.expanded = false;
    }

    /** Recursively drop a node's descendants from the DOM and the registry. */
    function removeNode(node) {
        for (const child of node.childNodes) removeNode(child);
        node.childNodes = [];
        for (const cr of node.childRows) cr.remove();
        node.childRows = [];
        if (node.name) varNodes.delete(node.name);
    }

    /** Re-list children in place (keeps the node expanded) after a size change. */
    async function reloadChildren(node) {
        collapseChildren(node);
        node.expanded = true;
        await loadChildren(node);
    }

    // ========================================================================
    // HOVER EVALUATE
    // ========================================================================
    async function provideHover(model, position) {
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
    }

    function wireHover() {
        const monaco = mon();
        if (!monaco || hoverProviderReg) return;
        // Register for both C++ and C so hover-to-evaluate works on .c files too.
        for (const lang of ['cpp', 'c']) {
            monaco.languages.registerHoverProvider(lang, { provideHover });
        }
        hoverProviderReg = true;
    }

    // ---- util --------------------------------------------------------------
    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }

    // ---- public api --------------------------------------------------------
    // Keyboard shortcuts land here. A manual command means the user has taken
    // over, so it cancels Auto dry run just like clicking the toolbar does.
    const Debugger = {
        init,
        start: () => start(),                       // never forward an event object as opts
        continue: () => { stopAuto(null); return continueExec(); },
        stepOver: () => { stopAuto(null); return stepOver(); },
        stepInto: () => { stopAuto(null); return stepInto(); },
        stepOut: () => { stopAuto(null); return stepOut(); },
        stop: () => { stopAuto(null); return stop(); },
        toggleAutoDryRun: toggleAuto,
        onFileShown,
        isActive: () => isSessionLive(),
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = Debugger;
    if (typeof window !== 'undefined') window.Debugger = Debugger;
})();
