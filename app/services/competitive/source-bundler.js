/**
 * Sameko Dev C++ IDE - one-file source for online judges
 *
 * A judge takes one file, so a solution that keeps its library next to it
 * (`#include "lib/dsu.hpp"`) fails to compile there. Before a C/C++ submit, every
 * `#include "…"` that names a file found relative to the including file is replaced by that
 * file's text, recursively, each file once. Nothing else changes: `#include <…>`, and a quoted
 * include that names no file there (testlib.h, a header the judge has), stay as written, so a
 * solution without local headers is submitted byte for byte as it is in the editor.
 * @module app/services/competitive/source-bundler
 */

'use strict';

const fs = require('fs');
const path = require('path');

const INCLUDE = /^[ \t]*#[ \t]*include[ \t]*"([^"\r\n]+)"[^\r\n]*$/gm;
const PRAGMA_ONCE = /^[ \t]*#[ \t]*pragma[ \t]+once[ \t]*(\/\/[^\r\n]*)?\r?\n?/gm;
const MAX_HEADER_BYTES = 512 * 1024;   // larger is not a personal library (a copied bits/stdc++.h, a PCH)

function sameFile(a, b) {
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * @param {string} source   the main file's text, as in the editor (may be unsaved)
 * @param {string} filePath the main file on disk; its folder is where relative includes start
 * @param {{ openFiles?: Object<string,string> }} [options] unsaved text of open files, by path
 * @returns {{ source: string, merged: string[] }} merged: the included files, relative to the main file's folder
 */
function bundleIncludes(source, filePath, options = {}) {
    const text = String(source ?? '');
    if (!filePath || !path.isAbsolute(filePath) || !text.includes('#')) return { source: text, merged: [] };
    const baseDir = path.dirname(filePath);
    const open = new Map();
    for (const [p, t] of Object.entries(options.openFiles || {})) {
        if (typeof t === 'string' && path.isAbsolute(p)) open.set(path.resolve(p).toLowerCase(), t);
    }
    const done = [path.resolve(filePath)];
    const merged = [];

    const readHeader = (full) => {
        const unsaved = open.get(full.toLowerCase());
        if (unsaved !== undefined) return unsaved;
        try {
            const st = fs.statSync(full);
            if (!st.isFile() || st.size > MAX_HEADER_BYTES) return null;
            return fs.readFileSync(full, 'utf8');
        } catch (_) {
            return null;
        }
    };

    const expand = (code, dir, depth) => code.replace(new RegExp(INCLUDE.source, 'gm'), (line, name) => {
        // bits/… is a copy of the compiler's own headers, never a library to paste in.
        if (depth > 32 || /(^|[\\/])bits[\\/]/.test(name)) return line;
        const full = path.resolve(dir, name);
        if (done.some((d) => sameFile(d, full))) return `// ${line.trim()} (merged above)`;
        const body = readHeader(full);
        if (body === null) return line;
        done.push(full);
        merged.push(path.relative(baseDir, full).replace(/\\/g, '/'));
        const inner = expand(body.replace(new RegExp(PRAGMA_ONCE.source, 'gm'), ''), path.dirname(full), depth + 1).replace(/\s+$/, '');
        const label = path.relative(baseDir, full).replace(/\\/g, '/');
        return `// ---- begin ${label} ----\n${inner}\n// ---- end ${label} ----`;
    });

    const out = expand(text, baseDir, 0);
    return merged.length ? { source: out, merged } : { source: text, merged: [] };
}

module.exports = { bundleIncludes };
