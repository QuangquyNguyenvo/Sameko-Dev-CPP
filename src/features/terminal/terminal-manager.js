/**
 * Sameko Dev C++ IDE - Terminal Manager
 * Xterm.js terminal integration (output display only; input stays in the
 * dedicated textarea below the terminal).
 *
 * @module src/features/terminal/terminal-manager
 */

// ============================================================================
// TERMINAL STATE
// ============================================================================

let terminal = null;
let fitAddon = null;
let isProcessRunning = false;

// Plain-text line buffer mirroring what was written, used by compareOutput()
// (the xterm canvas isn't DOM-queryable). Program output is reconstructed into
// complete logical lines (split on real newlines) with a trailing partial held
// in `pending`; IDE status messages are pushed as discrete lines. Capped to
// avoid unbounded growth under infinite output loops.
const MAX_BUFFER_LINES = 5000;
let lineBuffer = []; // Array<{ text: string, type: string }>
let pending = null;  // { text, type } partial program line not yet \n-terminated

const ANSI_RE = /\x1b\[[0-9;]*m/g;

// ============================================================================
// TERMINAL FUNCTIONS
// ============================================================================

/**
 * Initialize terminal
 * @param {HTMLElement|string} container
 * @param {Object} [opts]
 * @param {number} [opts.fontSize]
 * @param {Object} [opts.theme] - xterm theme overrides
 */
function initTerminal(container, opts = {}) {
    const containerEl = typeof container === 'string'
        ? document.getElementById(container)
        : container;

    if (!containerEl || !window.Terminal) {
        console.warn('[Terminal] Xterm.js not available');
        return null;
    }

    // Re-init safe: dispose any previous instance.
    if (terminal) {
        try { terminal.dispose(); } catch (e) { }
        terminal = null;
    }

    terminal = new window.Terminal({
        cursorBlink: false,
        disableStdin: true,            // display-only; input handled by textarea
        fontSize: opts.fontSize || 13,
        fontFamily: "'JetBrains Mono', Consolas, monospace",
        theme: Object.assign({
            background: '#1e2933',
            foreground: '#e0f0ff',
            cursor: '#1e2933'          // hide cursor (no stdin)
        }, opts.theme || {}),
        scrollback: 5000,
        convertEol: true,              // lone \n -> \r\n
        fastScrollModifier: 'shift'
    });

    // Fit addon for auto-resize
    if (window.FitAddon) {
        fitAddon = new window.FitAddon.FitAddon();
        terminal.loadAddon(fitAddon);
    }

    terminal.open(containerEl);
    fit();

    console.log('[Terminal] Initialized (xterm.js)');
    return terminal;
}

/**
 * Convert "#rrggbb" -> "r;g;b" for ANSI truecolor, or null if unparseable.
 * @param {string} hex
 * @returns {string|null}
 */
function hexToRgbParts(hex) {
    if (!hex || hex[0] !== '#' || hex.length < 7) return null;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return `${r};${g};${b}`;
}

// --- line buffer helpers ----------------------------------------------------

function capBuffer() {
    if (lineBuffer.length > MAX_BUFFER_LINES) {
        lineBuffer.splice(0, lineBuffer.length - MAX_BUFFER_LINES);
    }
}

function finalizePending() {
    if (pending !== null) {
        lineBuffer.push(pending);
        capBuffer();
        pending = null;
    }
}

// Append raw program output, reconstructing complete lines on real newlines.
function bufferAppendProgram(rawText, type) {
    const clean = String(rawText).replace(ANSI_RE, '').replace(/\r/g, '');
    const parts = clean.split('\n');
    if (pending === null) pending = { text: '', type: type || '' };
    pending.text += parts[0];
    pending.type = type || '';
    for (let i = 1; i < parts.length; i++) {
        lineBuffer.push(pending);
        capBuffer();
        pending = { text: parts[i], type: type || '' };
    }
}

// Push a discrete IDE message as its own line (closing any open program line).
function bufferPushLine(text, type) {
    finalizePending();
    lineBuffer.push({ text: String(text).replace(ANSI_RE, ''), type: type || '' });
    capBuffer();
}

// --- write paths ------------------------------------------------------------

/**
 * Write raw program output (stdout/stderr) verbatim — the program controls its
 * own newlines, so nothing is appended. Optionally tints the whole chunk (used
 * for stderr) unless the chunk carries its own ANSI. Safe across flush splits.
 *
 * @param {string} rawData
 * @param {string|null} hexColor  tint color, or null for untinted stdout
 * @param {boolean} colorEnabled
 * @param {string} type           buffer line type ('' or 'error')
 */
function writeProgram(rawData, hexColor, colorEnabled, type) {
    if (!terminal) return;
    let text = String(rawData);
    const hasOwnAnsi = colorEnabled && text.includes('\x1b[');

    if (!colorEnabled) {
        text = text.replace(ANSI_RE, '');
    } else if (hexColor && !hasOwnAnsi) {
        const rgb = hexToRgbParts(hexColor);
        if (rgb) text = `\x1b[38;2;${rgb}m${text}\x1b[0m`;
    }

    terminal.write(text); // verbatim, no synthetic newline
    bufferAppendProgram(rawData, type);
}

/**
 * Write a discrete IDE status message as its own colored line.
 *
 * @param {string} msg
 * @param {string|null} hexColor
 * @param {boolean} colorEnabled
 * @param {string} type
 */
function writeMessage(msg, hexColor, colorEnabled, type) {
    if (!terminal) return;
    let text = String(msg);
    const hasOwnAnsi = colorEnabled && text.includes('\x1b[');

    if (!colorEnabled) {
        text = text.replace(ANSI_RE, '');
    } else if (hexColor && !hasOwnAnsi) {
        const rgb = hexToRgbParts(hexColor);
        if (rgb) text = `\x1b[38;2;${rgb}m${text}\x1b[0m`;
    }

    terminal.write(text + '\r\n');
    bufferPushLine(msg, type);
}

/**
 * @returns {Array<{text:string,type:string}>} buffer snapshot incl. partial line
 */
function getLines() {
    return pending !== null ? lineBuffer.concat([pending]) : lineBuffer;
}

function resetBuffer() {
    lineBuffer = [];
    pending = null;
}

/**
 * Write to terminal (raw passthrough)
 * @param {string} data
 */
function write(data) {
    if (terminal) terminal.write(data);
}

/**
 * Write line to terminal
 * @param {string} line
 */
function writeLine(line) {
    if (terminal) terminal.writeln(line);
}

/**
 * Clear terminal + line buffer
 */
function clear() {
    if (terminal) terminal.clear();
    resetBuffer();
}

/**
 * Fit terminal to container
 */
function fit() {
    if (fitAddon) {
        try { fitAddon.fit(); } catch (e) { }
    }
}

/**
 * Apply a theme (background/foreground/etc.) to the live terminal.
 * @param {Object} theme - xterm ITheme partial
 */
function applyTheme(theme) {
    if (terminal && theme) {
        try { terminal.options.theme = Object.assign({}, terminal.options.theme, theme); } catch (e) { }
    }
}

/**
 * Update font size on the live terminal.
 * @param {number} size
 */
function setFontSize(size) {
    if (terminal && size) {
        try { terminal.options.fontSize = size; fit(); } catch (e) { }
    }
}

/**
 * Dispose terminal
 */
function dispose() {
    if (terminal) {
        terminal.dispose();
        terminal = null;
    }
}

/**
 * Set process running state
 * @param {boolean} running
 */
function setProcessRunning(running) {
    isProcessRunning = running;
}

/**
 * Check if process is running
 * @returns {boolean}
 */
function isRunning() {
    return isProcessRunning;
}

// ============================================================================
// EXPORTS
// ============================================================================

const api = {
    initTerminal, write, writeLine, writeProgram, writeMessage, getLines, resetBuffer,
    clear, fit, applyTheme, setFontSize, dispose, setProcessRunning, isRunning
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
}

if (typeof window !== 'undefined') {
    window.TerminalManager = api;
}
