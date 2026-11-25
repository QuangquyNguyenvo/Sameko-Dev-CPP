/**
 * Sameko Dev C++ IDE - Function prototypes (issue #78)
 * Finds the free functions defined below main() that have no declaration above it and
 * builds their prototypes, types only: `float loadArray(float inputArray[], int N) {`
 * gives `float loadArray(float[], int);`. Text in, text out, so it runs in Node tests.
 *
 * Only top-level functions count. Functions inside a namespace or class, templates,
 * `auto` without a trailing return type and functions with default arguments are left
 * out and reported as skipped: their prototype needs more than a copy of the header.
 */
const FunctionPrototypes = (() => {
    const NOT_NAMES = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'sizeof', 'decltype',
        'alignof', 'static_assert', 'operator', 'new', 'delete', 'do', 'else']);
    const TYPE_WORDS = new Set(['int', 'long', 'short', 'char', 'unsigned', 'signed', 'double', 'float',
        'bool', 'void', 'auto', 'const', 'volatile', 'wchar_t', 'char8_t', 'char16_t', 'char32_t',
        'struct', 'class', 'enum', 'typename', 'register']);

    /**
     * Same length as `text`, with comments, string/char literals and preprocessor lines
     * turned into spaces (newlines kept), so offsets and line numbers still match.
     */
    function blank(text) {
        const out = text.split('');
        const wipe = (from, to) => { for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '; };
        let i = 0;
        let lineStart = true;
        while (i < text.length) {
            const c = text[i];
            if (c === '\n') { lineStart = true; i++; continue; }
            if (lineStart && c === '#') {
                let j = i;
                while (j < text.length && text[j] !== '\n') j += text[j] === '\\' && text[j + 1] === '\n' ? 2 : 1;
                wipe(i, j); i = j; continue;
            }
            if (c !== ' ' && c !== '\t' && c !== '\r') lineStart = false;
            if (c === '/' && text[i + 1] === '/') {
                let j = i;
                while (j < text.length && text[j] !== '\n') j += text[j] === '\\' && text[j + 1] === '\n' ? 2 : 1;
                wipe(i, j); i = j; continue;
            }
            if (c === '/' && text[i + 1] === '*') {
                const end = text.indexOf('*/', i + 2);
                const j = end < 0 ? text.length : end + 2;
                wipe(i, j); i = j; continue;
            }
            const raw = c === 'R' && text[i + 1] === '"' && !/\w/.test(text[i - 1] || '')
                ? /^R"([^()\\\s]{0,16})\(/.exec(text.slice(i, i + 20)) : null;
            if (raw) {
                const close = ')' + raw[1] + '"';
                const end = text.indexOf(close, i + raw[0].length);
                const j = end < 0 ? text.length : end + close.length;
                wipe(i, j); i = j; continue;
            }
            // A ' between digits is a C++14 digit separator (1'000'000), not a char literal.
            if (c === '"' || (c === "'" && !/[0-9a-fA-F]/.test(text[i - 1] || ''))) {
                let j = i + 1;
                while (j < text.length && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
                wipe(i, Math.min(j + 1, text.length)); i = j + 1; continue;
            }
            i++;
        }
        return out.join('');
    }

    /** Split at commas that are not inside (), [], {} or <>. */
    function splitTopLevel(text) {
        const parts = [];
        let depth = 0;
        let start = 0;
        for (let i = 0; i < text.length; i++) {
            const c = text[i];
            if ('([{<'.includes(c)) depth++;
            else if (')]}>'.includes(c)) depth = Math.max(0, depth - 1);
            else if (c === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
        }
        parts.push(text.slice(start));
        return parts.map((p) => p.trim()).filter((p, idx, all) => p || all.length > 1);
    }

    const squash = (s) => s.replace(/\s+/g, ' ').trim();
    /** Spacing-insensitive form used to compare two declarations. */
    const keyOf = (s) => squash(s).replace(/\s*([*&<>,\[\]():])\s*/g, '$1');

    /** `float inputArray[]` -> `float[]`; `const vector<int> &v` -> `const vector<int> &`. */
    function typeOnly(param) {
        const p = squash(param);
        if (!p || p === 'void' || p === '...' || p.includes('(')) return p;
        const m = /^(.*?)\s*((?:\[[^\]]*\]\s*)*)$/.exec(p);
        const body = m[1];
        const arrays = m[2].replace(/\s+/g, '');
        const name = /([A-Za-z_]\w*)$/.exec(body);
        if (!name) return p;
        const before = body.slice(0, name.index).trimEnd();
        // One word (`int`, `string`) or a type keyword at the end (`unsigned int`): no name.
        if (!before || /::$/.test(before) || TYPE_WORDS.has(name[1])) return p;
        if (!/[\w>*&]$/.test(before)) return p;
        return before + arrays;
    }

    function hasDefaultArgument(param) {
        let depth = 0;
        for (const c of param) {
            if ('([{<'.includes(c)) depth++;
            else if (')]}>'.includes(c)) depth = Math.max(0, depth - 1);
            else if (c === '=' && depth === 0) return true;
        }
        return false;
    }

    /**
     * Reads a top-level segment (the text between two `;`/`}`/`{` at depth 0) as a
     * function head. Returns null when it is something else.
     */
    function parseHead(seg) {
        const close = seg.lastIndexOf(')');
        if (close < 0) return null;
        const tail = seg.slice(close + 1);
        if (!/^\s*(?:const\s*)?(?:noexcept\s*(?:\([^()]*\))?\s*)?(?:->\s*[\w:<>,\s*&]+)?\s*(?:override|final)?\s*$/.test(tail)) return null;
        let depth = 0;
        let open = -1;
        for (let k = close; k >= 0; k--) {
            if (seg[k] === ')') depth++;
            else if (seg[k] === '(' && --depth === 0) { open = k; break; }
        }
        if (open < 0) return null;
        const before = seg.slice(0, open);
        const nameMatch = /([A-Za-z_]\w*)\s*$/.exec(before);
        if (!nameMatch) return null;
        const name = nameMatch[1];
        const ret = before.slice(0, nameMatch.index);
        if (NOT_NAMES.has(name) || !ret.trim() || /[=(){}]/.test(ret)) return null;
        if (/::\s*$/.test(ret) || /\boperator\b/.test(ret)) return { member: true };
        if (/^\s*(?:return|else|case|goto|throw|using|typedef|delete)\b/.test(ret)) return null;
        return {
            name,
            ret,
            params: seg.slice(open + 1, close),
            tail,
            template: /\btemplate\s*</.test(ret),
            // `auto f()` has no type until its body is seen; a prototype of it is an error.
            deduced: /(^|\s)auto\s*$/.test(ret.replace(/\b(static|inline|constexpr|extern)\b/g, ' ')) && !/->/.test(tail),
        };
    }

    function signatureKey(head) {
        const types = splitTopLevel(head.params).map(typeOnly).filter((t) => t && t !== 'void');
        return head.name + '(' + types.map(keyOf).join(',') + ')';
    }

    /**
     * @param {string} text  the whole source file
     * @returns {{ main: boolean, insertLine: number, prototypes: string[], names: string[], skipped: string[] }}
     *   `insertLine` is the 1-based line the prototypes go above (main's first line).
     */
    function analyze(text) {
        const src = blank(text);
        const declared = new Set();
        const found = [];
        let main = null;
        let depth = 0;
        let segStart = 0;
        for (let i = 0; i < src.length; i++) {
            const c = src[i];
            if (c === '{') {
                if (depth === 0) {
                    const seg = src.slice(segStart, i);
                    const head = parseHead(seg);
                    if (head && head.name) {
                        const startOffset = segStart + (seg.length - seg.trimStart().length);
                        const entry = { head, startOffset, seg: text.slice(segStart, i) };
                        if (head.name === 'main' && !main) main = entry;
                        else found.push({ ...entry, afterMain: !!main });
                    }
                }
                depth++;
                segStart = i + 1;
            } else if (c === '}') {
                depth = Math.max(0, depth - 1);
                segStart = i + 1;
            } else if (c === ';') {
                // Only a declaration above main helps main; one below it changes nothing.
                if (depth === 0 && !main) {
                    const head = parseHead(src.slice(segStart, i));
                    if (head && head.name) declared.add(signatureKey(head));
                }
                segStart = i + 1;
            }
        }

        const result = { main: !!main, insertLine: 0, prototypes: [], names: [], skipped: [] };
        if (!main) return result;
        result.insertLine = text.slice(0, main.startOffset).split('\n').length;
        for (const f of found) if (!f.afterMain) declared.add(signatureKey(f.head));
        for (const f of found) {
            if (!f.afterMain) continue;
            const key = signatureKey(f.head);
            if (declared.has(key)) continue;
            const params = splitTopLevel(f.head.params);
            if (f.head.template || f.head.deduced || params.some(hasDefaultArgument)) {
                result.skipped.push(f.head.name);
                continue;
            }
            declared.add(key);
            const ret = squash(f.head.ret.replace(/\[\[[^\]]*\]\]/g, ' '));
            const tail = squash(f.head.tail.replace(/\b(override|final)\b/g, ''));
            const typeList = params.map(typeOnly).join(', ');
            result.prototypes.push(`${ret}${/[*&]$/.test(ret) ? '' : ' '}${f.head.name}(${typeList})${tail ? ' ' + tail : ''};`);
            result.names.push(f.head.name);
        }
        return result;
    }

    /** The text to insert above main, or '' when nothing is missing. */
    function insertionText(result, eol = '\n') {
        if (!result.prototypes.length) return '';
        return result.prototypes.join(eol) + eol + eol;
    }

    return { analyze, insertionText, typeOnly, blank };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = FunctionPrototypes;
else window.FunctionPrototypes = FunctionPrototypes;
