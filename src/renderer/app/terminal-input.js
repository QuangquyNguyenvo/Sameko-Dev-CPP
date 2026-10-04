/**
 * Sameko Dev C++ IDE - renderer: Terminal input box, xterm setup, Ctrl+Shift+F11.
 *
 * One of the files that used to be the single renderer/app.js. They are plain
 * <script> files sharing one global scope and are loaded by index.html in a
 * fixed order (see CODEBASE.md); nothing here may run at load time that needs
 * a function from a later file.
 */

// ============================================================================
// AUTO UPDATE - Check for new versions
// ============================================================================
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'F11') {
        e.preventDefault();
        runAllTests();
    }
});

// ============================================================================
// TERMINAL UX ENHANCEMENTS & LOGIC
// ============================================================================
let termHistory = [];
let termHistoryIndex = -1;
let termCurrentDraft = '';

// Read terminal colors from the active theme's CSS variables and push them to
// xterm so it matches the app theme. Called on init and whenever the theme
// changes.
function syncTerminalTheme() {
    if (!window.TerminalManager) return;
    const cs = getComputedStyle(document.documentElement);
    const bg = (cs.getPropertyValue('--terminal-bg') || '#1e2933').trim();
    // --terminal-text, not --text-primary: a light theme with a dark terminal (sakura) has
    // dark UI text, which made program output unreadable.
    const fg = (cs.getPropertyValue('--terminal-text') || cs.getPropertyValue('--text-primary') || '#e0f0ff').trim();
    TerminalManager.applyTheme({
        background: bg || '#1e2933',
        foreground: fg || '#e0f0ff',
        cursor: bg || '#1e2933'
    });
}

// Initialize the xterm.js terminal once, sized to the current panel font size
// and themed to match the active app theme. Re-fits on container resize.
function initXtermTerminal() {
    if (!window.TerminalManager) return;
    const fontSize = App.settings?.execution?.panelFontSize || 13;
    TerminalManager.initTerminal('terminal', { fontSize });
    syncTerminalTheme();

    // Re-fit whenever the terminal container changes size (resizer drag, dock
    // toggle, window resize, panel show/hide). ResizeObserver coalesces these.
    const termEl = document.getElementById('terminal');
    if (termEl && typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => {
            requestAnimationFrame(() => TerminalManager.fit());
        });
        ro.observe(termEl);
    }
}

function initTerminalUX() {
    const termInput = document.getElementById('terminal-in');

    // Mount the xterm.js terminal into the #terminal element (output display only).
    initXtermTerminal();

    if (termInput) {

        // Auto-grow with the content so a pasted multi-line test case is fully
        // visible instead of being clipped to one row. The ceiling is dynamic:
        // never taller than TERM_INPUT_MAX_PX, and always leaving
        // TERM_OUTPUT_RESERVE_PX of the panel for the output above — otherwise a
        // short (or docked) panel would be swallowed whole by the input.
        // CSS keeps a static max-height as the fallback before this ever runs.
        const TERM_INPUT_MAX_PX = 220;
        const TERM_INPUT_MIN_PX = 88;
        const TERM_OUTPUT_RESERVE_PX = 120; // panel head + a few lines of output

        const handleResize = function () {
            if (this.value === '') {
                this.style.height = '';
                this.style.maxHeight = '';
                this.scrollTop = 0;
                return;
            }
            const panel = this.closest('.terminal-section, .problems-panel');
            const panelH = panel ? panel.clientHeight : 0;
            const cap = panelH
                ? Math.min(TERM_INPUT_MAX_PX, Math.max(TERM_INPUT_MIN_PX, panelH - TERM_OUTPUT_RESERVE_PX))
                : TERM_INPUT_MAX_PX;

            this.style.maxHeight = cap + 'px';
            this.style.height = 'auto'; // collapse first so scrollHeight is the real content height
            this.style.height = Math.min(this.scrollHeight, cap) + 'px';
            if (this.selectionStart === this.value.length) {
                this.scrollTop = this.scrollHeight;
            }
        };
        termInput.addEventListener('input', handleResize);
        termInput.addEventListener('paste', function () {
            setTimeout(() => handleResize.call(this), 10);
        });


        termInput.addEventListener('keydown', (e) => {

            if (e.ctrlKey && e.key === 'c') {
                if (termInput.selectionStart === termInput.selectionEnd) {
                    e.preventDefault();
                    if (App.isRunning) {
                        stop();
                        log('^C', 'system');
                    }
                }
                return;
            }


            if (e.key === 'ArrowUp') {
                if (termHistory.length > 0) {
                    e.preventDefault();
                    if (termHistoryIndex === -1) {
                        termCurrentDraft = termInput.value;
                        termHistoryIndex = termHistory.length - 1;
                    } else if (termHistoryIndex > 0) {
                        termHistoryIndex--;
                    }
                    termInput.value = termHistory[termHistoryIndex];
                    handleResize.call(termInput);
                }
            } else if (e.key === 'ArrowDown') {
                if (termHistoryIndex !== -1) {
                    e.preventDefault();
                    if (termHistoryIndex < termHistory.length - 1) {
                        termHistoryIndex++;
                        termInput.value = termHistory[termHistoryIndex];
                    } else {
                        termHistoryIndex = -1;
                        termInput.value = termCurrentDraft;
                    }
                    handleResize.call(termInput);
                }
            }


            if (e.key === 'Enter') {
                if (e.shiftKey) {
                    // Newline
                } else {
                    e.preventDefault();
                    const val = termInput.value.trim();
                    if (val) {

                        if (termHistory.length === 0 || termHistory[termHistory.length - 1] !== val) {
                            termHistory.push(val);
                        }
                        termHistoryIndex = -1;
                        termCurrentDraft = '';
                    }
                    sendInput();
                }
            }
        });


        // Right-click anywhere in the terminal — output area OR the input row —
        // pastes into the input, like a real console.
        // Bound on `document` (not #terminal-section) on purpose: docking moves
        // #terminal and .terminal-input into #problems-panel, which would put
        // them outside a section-scoped listener. Also note xterm.js parks its
        // hidden helper <textarea> under the mouse on right-click, so the event
        // target inside the output area is often a TEXTAREA — we must not skip it.
        if (!document.body.dataset.termContextMenuInitialized) {
            document.body.dataset.termContextMenuInitialized = 'true';

            document.addEventListener('contextmenu', async (e) => {
                const target = e.target;
                if (!target || typeof target.closest !== 'function') return;
                // Only the terminal output body and the terminal input row.
                const inTerminal = target.closest('#terminal') ||
                    target.closest('.terminal-input')?.contains(termInput);
                if (!inTerminal) return;
                if (target.closest('button')) return;

                e.preventDefault();
                try {
                    const text = await navigator.clipboard.readText();
                    if (text && !termInput.disabled) {
                        const startPos = termInput.selectionStart;
                        const endPos = termInput.selectionEnd;
                        const currentValue = termInput.value;

                        termInput.value = currentValue.substring(0, startPos) + text + currentValue.substring(endPos);

                        termInput.focus();

                        const newPos = startPos + text.length;
                        termInput.setSelectionRange(newPos, newPos);

                        // after setSelectionRange, so the auto-grow can scroll to the caret
                        termInput.dispatchEvent(new Event('input'));
                    }
                } catch (err) {
                    console.warn('Paste failed:', err);
                }
            });
        }
    }
}


if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTerminalUX);
} else {
    initTerminalUX();
}
