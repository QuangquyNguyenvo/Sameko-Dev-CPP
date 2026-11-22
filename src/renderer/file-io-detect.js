/**
 * Which files a C/C++ solution reads and writes, for problems judged through files (BAI.INP,
 * BAI.OUT). Read from the source, so such a problem needs no setup. Understands the usual forms:
 *
 *   freopen("bai.inp", "r", stdin);          ifstream fin("bai.inp");
 *   #define NAME "bai"                       freopen(NAME".inp", "r", stdin);
 *   const string NAME = "bai";               freopen((NAME + ".inp").c_str(), "r", stdin);
 *
 * Only plain file names count: a path ("C:/x/a.inp") would not be the test's file on a judge.
 */
const FileIODetect = (() => {
    const SAFE_NAME = /^[A-Za-z0-9_][\w.+-]{0,63}$/;

    /** The source with comments blanked; string literals are kept as written. */
    function stripComments(source) {
        let out = '';
        for (let i = 0; i < source.length; i++) {
            const c = source[i];
            const next = source[i + 1];
            if (c === '"' || c === "'") {
                let j = i + 1;
                while (j < source.length && source[j] !== c && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1;
                out += source.slice(i, j + 1);
                i = j;
            } else if (c === '/' && next === '/') {
                while (i < source.length && source[i] !== '\n') i++;
                out += '\n';
            } else if (c === '/' && next === '*') {
                const end = source.indexOf('*/', i + 2);
                i = end === -1 ? source.length : end + 1;
                out += ' ';
            } else {
                out += c;
            }
        }
        return out;
    }

    /** NAME -> "bai" for #define and string constants. */
    function stringConstants(code) {
        const names = new Map();
        for (const m of code.matchAll(/^[ \t]*#[ \t]*define[ \t]+(\w+)[ \t]+"([^"\n]*)"/gm)) names.set(m[1], m[2]);
        const declared = /\b(?:std::)?string\s+(\w+)\s*(?:=\s*|\{\s*|\(\s*)"([^"\n]*)"|\bchar\s*(?:const\s*)?(?:\*\s*(?:const\s+)?(\w+)|(\w+)\s*\[\s*\w*\s*\])\s*=\s*"([^"\n]*)"/g;
        for (const m of code.matchAll(declared)) {
            if (m[1]) names.set(m[1], m[2]);
            else names.set(m[3] || m[4], m[5]);
        }
        return names;
    }

    /** `NAME ".inp"`, `(NAME + ".inp").c_str()`, `"a.inp"` -> the file name, or ''. */
    function evaluateName(expr, constants) {
        const text = expr.replace(/\.\s*c_str\s*\(\s*\)/g, ' ').replace(/\b(?:std::)?string\s*\(/g, '(');
        let result = '';
        for (const m of text.matchAll(/"([^"\n]*)"|([A-Za-z_]\w*)|([^\s+()])/g)) {
            if (m[1] !== undefined) result += m[1];
            else if (m[2] !== undefined) {
                if (!constants.has(m[2])) return '';
                result += constants.get(m[2]);
            } else return '';
        }
        return SAFE_NAME.test(result) ? result : '';
    }

    /** The first argument of a call, given the index just after its "(". */
    function firstArgument(code, start) {
        let depth = 0;
        for (let i = start; i < code.length; i++) {
            const c = code[i];
            if (c === '"') {
                i++;
                while (i < code.length && code[i] !== '"' && code[i] !== '\n') i += code[i] === '\\' ? 2 : 1;
            } else if (c === '(') depth++;
            else if (c === ')') {
                if (depth === 0) return { text: code.slice(start, i), end: i };
                depth--;
            } else if (c === ',' && depth === 0) return { text: code.slice(start, i), end: i };
            else if (c === ';' || c === '\n') return null;
        }
        return null;
    }

    function detect(source) {
        if (typeof source !== 'string' || !/freopen|fstream/.test(source)) return null;
        const code = stripComments(source);
        const constants = stringConstants(code);
        let input = '';
        let output = '';

        for (const m of code.matchAll(/\bfreopen\s*\(/g)) {
            const arg = firstArgument(code, m.index + m[0].length);
            if (!arg) continue;
            const rest = code.slice(arg.end, arg.end + 60);
            const stream = /^,\s*"([rwa])[^"]*"\s*,\s*(?:std::)?(stdin|stdout)\b/.exec(rest);
            if (!stream) continue;
            const name = evaluateName(arg.text, constants);
            if (stream[2] === 'stdin' && stream[1] === 'r') input = input || name;
            else if (stream[2] === 'stdout' && stream[1] !== 'r') output = output || name;
        }

        const streamVars = { ifstream: new Set(), ofstream: new Set() };
        for (const m of code.matchAll(/\b(ifstream|ofstream)\s+([^;]+);/g)) {
            for (const part of m[2].split(/,(?![^(]*\))/)) {
                const declared = /^\s*(\w+)\s*(?:[({]\s*([\s\S]*?)\s*[)}])?\s*$/.exec(part);
                if (!declared) continue;
                streamVars[m[1]].add(declared[1]);
                if (!declared[2]) continue;
                const name = evaluateName(declared[2].split(/,(?=\s*(?:std::)?ios)/)[0], constants);
                if (m[1] === 'ifstream') input = input || name;
                else output = output || name;
            }
        }
        for (const m of code.matchAll(/\b(\w+)\s*\.\s*open\s*\(/g)) {
            const kind = streamVars.ifstream.has(m[1]) ? 'in' : streamVars.ofstream.has(m[1]) ? 'out' : '';
            if (!kind) continue;
            const arg = firstArgument(code, m.index + m[0].length);
            const name = arg ? evaluateName(arg.text, constants) : '';
            if (kind === 'in') input = input || name;
            else output = output || name;
        }
        return input || output ? { input, output } : null;
    }

    return { detect, stripComments };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = FileIODetect;
else window.FileIODetect = FileIODetect;
