/**
 * Sameko Dev C++ IDE - GDB/MI Output Parser
 *
 * Pure module: NO Electron / no fs / no side effects, so it is fully
 * unit-testable in isolation and cannot leak resources.
 *
 * Parses one line of `gdb --interpreter=mi3` output into a structured record.
 * The MI grammar we handle (GDB manual, "GDB/MI Output Syntax"):
 *
 *   result-record → [token] "^" result-class ( "," result )*
 *   async-record  → [token] ("*"|"+"|"=") async-class ( "," result )*
 *   stream-record → ("~"|"@"|"&") c-string
 *   result        → variable "=" value
 *   value         → c-string | tuple | list
 *   tuple         → "{}" | "{" result ("," result)* "}"
 *   list          → "[]" | "[" (value|result) ("," (value|result))* "]"
 *
 * ROBUSTNESS / SECURITY NOTE:
 * The inferior program shares GDB's stdout pipe on Windows, so a line of
 * *program output* can superficially look like an MI record. To avoid
 * misclassifying user output as protocol, every record class is checked
 * against a closed whitelist (result/exec/notify classes are a fixed, small
 * set in the MI spec). Anything that does not match is returned verbatim as
 * program output. This makes the boundary between protocol and program I/O
 * deterministic instead of best-effort.
 *
 * @module app/services/debugger/mi-parser
 */

'use strict';

// Closed sets from the MI spec — used to reject program output that happens
// to begin with an MI sigil character.
const RESULT_CLASSES = new Set(['done', 'running', 'connected', 'error', 'exit']);
const EXEC_CLASSES = new Set(['stopped', 'running']);
const NOTIFY_CLASSES = new Set([
    'thread-group-added', 'thread-group-removed', 'thread-group-started', 'thread-group-exited',
    'thread-created', 'thread-exited', 'thread-selected',
    'library-loaded', 'library-unloaded',
    'breakpoint-created', 'breakpoint-modified', 'breakpoint-deleted',
    'record-started', 'record-stopped', 'cmd-param-changed', 'param-changed',
    'memory-changed', 'tsv-created', 'tsv-deleted', 'tsv-modified',
]);

const IDENT_RE = /[A-Za-z0-9_-]/;

/**
 * Cursor-based recursive-descent parser for MI values.
 * Never throws past parseResults() — callers get a best-effort object.
 */
class Cursor {
    constructor(s) { this.s = s; this.i = 0; }
    eof() { return this.i >= this.s.length; }
    peek() { return this.s[this.i]; }

    parseIdent() {
        const start = this.i;
        while (!this.eof() && IDENT_RE.test(this.s[this.i])) this.i++;
        return this.s.slice(start, this.i);
    }

    parseResult() {
        const name = this.parseIdent();
        if (this.s[this.i] !== '=') {
            throw new Error(`MI: expected '=' after '${name}' at ${this.i}`);
        }
        this.i++; // '='
        const value = this.parseValue();
        return { name, value };
    }

    parseValue() {
        const c = this.peek();
        if (c === '"') return this.parseCString();
        if (c === '{') return this.parseTuple();
        if (c === '[') return this.parseList();
        // Bareword fallback (shouldn't normally happen in well-formed MI).
        const start = this.i;
        while (!this.eof() && ',}]'.indexOf(this.s[this.i]) === -1) this.i++;
        return this.s.slice(start, this.i);
    }

    parseCString() {
        this.i++; // opening quote
        let out = '';
        while (!this.eof()) {
            const ch = this.s[this.i++];
            if (ch === '\\') {
                const e = this.s[this.i++];
                switch (e) {
                    case 'n': out += '\n'; break;
                    case 't': out += '\t'; break;
                    case 'r': out += '\r'; break;
                    case '"': out += '"'; break;
                    case '\\': out += '\\'; break;
                    case 'a': out += '\x07'; break;
                    case 'b': out += '\b'; break;
                    case 'f': out += '\f'; break;
                    case 'v': out += '\v'; break;
                    case '0': out += '\0'; break;
                    default: out += (e === undefined ? '' : e); break;
                }
            } else if (ch === '"') {
                break;
            } else {
                out += ch;
            }
        }
        return out;
    }

    parseTuple() {
        this.i++; // '{'
        const obj = {};
        if (this.peek() === '}') { this.i++; return obj; }
        while (!this.eof()) {
            const { name, value } = this.parseResult();
            assign(obj, name, value);
            if (this.peek() === ',') { this.i++; continue; }
            break;
        }
        if (this.peek() === '}') this.i++;
        return obj;
    }

    parseList() {
        this.i++; // '['
        const arr = [];
        if (this.peek() === ']') { this.i++; return arr; }
        while (!this.eof()) {
            if (this.isResultAhead()) {
                // e.g. children=[child={...},child={...}] -> push the tuple values
                const { value } = this.parseResult();
                arr.push(value);
            } else {
                arr.push(this.parseValue());
            }
            if (this.peek() === ',') { this.i++; continue; }
            break;
        }
        if (this.peek() === ']') this.i++;
        return arr;
    }

    isResultAhead() {
        let j = this.i;
        while (j < this.s.length && IDENT_RE.test(this.s[j])) j++;
        return j > this.i && this.s[j] === '=';
    }
}

// Duplicate keys at the same level (rare) are collapsed into `<name>` = last
// value, plus `<name>List` = array of all values, so nothing is silently lost.
function assign(obj, name, value) {
    if (obj[name] === undefined) {
        obj[name] = value;
    } else {
        const listKey = name + 'List';
        if (!Array.isArray(obj[listKey])) obj[listKey] = [obj[name]];
        obj[listKey].push(value);
        obj[name] = value;
    }
}

/**
 * Parse a ",k=v,k2=v2" trailing results string into an object.
 * Best-effort: on malformed input returns what parsed so far.
 * @param {string} str
 * @returns {Object}
 */
function parseResults(str) {
    const c = new Cursor(str);
    const obj = {};
    while (!c.eof()) {
        if (c.peek() === ',') { c.i++; continue; }
        try {
            const { name, value } = c.parseResult();
            assign(obj, name, value);
        } catch (_) {
            break; // stop at first malformed token, keep what we have
        }
    }
    return obj;
}

/**
 * Parse a single line of MI output.
 * @param {string} line - one line, WITHOUT trailing newline/CR
 * @returns {{type:'result'|'exec'|'notify'|'status'|'stream'|'prompt'|'output', ...}}
 *   - result : { type, token, class, results }
 *   - exec   : { type:'exec', token, class:'stopped'|'running', results }
 *   - notify : { type:'notify', token, class, results }
 *   - stream : { type:'stream', stream:'console'|'target'|'log', text }
 *   - prompt : { type:'prompt' }
 *   - output : { type:'output', text }   (program stdout/stderr — NOT protocol)
 */
function parseLine(line) {
    if (line === '(gdb)' || line === '(gdb) ') return { type: 'prompt' };

    const m = line.match(/^(\d*)([\^*+=~@&])([\s\S]*)$/);
    if (!m) return { type: 'output', text: line };

    const token = m[1] ? parseInt(m[1], 10) : null;
    const kind = m[2];
    const rest = m[3];

    // Stream records: sigil immediately followed by a c-string.
    if (kind === '~' || kind === '@' || kind === '&') {
        if (rest[0] !== '"') return { type: 'output', text: line };
        let text;
        try { text = new Cursor(rest).parseCString(); }
        catch (_) { return { type: 'output', text: line }; }
        const stream = kind === '~' ? 'console' : (kind === '@' ? 'target' : 'log');
        return { type: 'stream', stream, text };
    }

    const clsMatch = rest.match(/^([a-zA-Z-]+)([\s\S]*)$/);
    if (!clsMatch) return { type: 'output', text: line };
    const klass = clsMatch[1];
    const resultsStr = clsMatch[2];

    if (kind === '^') {
        if (!RESULT_CLASSES.has(klass)) return { type: 'output', text: line };
        return { type: 'result', token, class: klass, results: parseResults(resultsStr) };
    }
    if (kind === '*') {
        if (!EXEC_CLASSES.has(klass)) return { type: 'output', text: line };
        return { type: 'exec', token, class: klass, results: parseResults(resultsStr) };
    }
    if (kind === '=') {
        if (!NOTIFY_CLASSES.has(klass)) return { type: 'output', text: line };
        return { type: 'notify', token, class: klass, results: parseResults(resultsStr) };
    }
    if (kind === '+') {
        // status-async (progress) — low value, only accept a couple of known classes
        return { type: 'status', token, class: klass, results: parseResults(resultsStr) };
    }
    return { type: 'output', text: line };
}

module.exports = { parseLine, parseResults, RESULT_CLASSES, EXEC_CLASSES, NOTIFY_CLASSES };
