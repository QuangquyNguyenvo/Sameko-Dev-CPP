/**
 * Sameko Dev C++ IDE - test cases as files.
 *
 * Import: pairs the inputs and answers of a folder (01.in/01.out, BAI1.INP/BAI1.OUT,
 * Test01/bai.inp + Test01/bai.out, input/1.txt + output/1.txt, input00.txt/output00.txt, 01/01.a).
 * Small files come in as text; a large one stays on disk and the test keeps its path, so it never
 * travels through the session file or the renderer.
 * @module app/services/competitive/test-files
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { appTempDir, ensurePrivateDir } = require('../../shared/platform');

const INPUT_EXTS = new Set(['in', 'inp', 'input']);
const OUTPUT_EXTS = new Set(['out', 'ans', 'ok', 'output', 'a', 'sol']);
const INPUT_DIRS = new Set(['in', 'input', 'inputs']);
const OUTPUT_DIRS = new Set(['out', 'output', 'outputs', 'ans', 'answer', 'answers']);
const INLINE_BYTES = 256 * 1024;
const MAX_FILES = 4000;
const MAX_TESTS = 500;
const MAX_DEPTH = 3;
const SAFE_NAME = /^[A-Za-z0-9_][\w.+-]{0,63}$/;

/** What a file is in a test folder: its role and the key its partner shares. */
function classify(rel) {
    const parts = rel.split(/[/\\]/);
    const file = parts.pop();
    const dot = file.lastIndexOf('.');
    const ext = dot > 0 ? file.slice(dot + 1).toLowerCase() : '';
    let stem = (dot > 0 ? file.slice(0, dot) : file).toLowerCase();
    let role = INPUT_EXTS.has(ext) ? 'in' : OUTPUT_EXTS.has(ext) ? 'out' : '';

    const dirs = parts.map((part) => {
        const name = part.toLowerCase();
        if (INPUT_DIRS.has(name)) { role = role || 'in'; return '*'; }
        if (OUTPUT_DIRS.has(name)) { role = role || 'out'; return '*'; }
        return name;
    });
    // input00.txt / output00.txt
    const named = /^(input|output)[-_.]?(\d.*)$/.exec(stem);
    if (named && (ext === 'txt' || ext === '')) {
        role = role || (named[1] === 'input' ? 'in' : 'out');
        stem = named[2];
    }
    if (!role && ext === '') role = 'bare';   // 01 next to 01.a (Polygon)
    return role ? { role, key: [...dirs, stem].join('/') } : null;
}

/**
 * @param {string[]} files - paths relative to the folder
 * @returns {Array<{input: string, output: string}>} natural order; output '' when it has none
 */
function pairTestFiles(files) {
    const groups = new Map();
    for (const rel of files) {
        const kind = classify(rel);
        if (!kind) continue;
        const group = groups.get(kind.key) || {};
        if (!group[kind.role]) group[kind.role] = rel;
        groups.set(kind.key, group);
    }
    const pairs = [];
    for (const [key, group] of groups) {
        const input = group.in || (group.out ? group.bare : '');
        if (input) pairs.push({ key, input, output: group.out || '' });
    }
    pairs.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true, sensitivity: 'base' }));
    return pairs.map(({ input, output }) => ({ input, output }));
}

async function listFolder(folder) {
    const found = [];
    const walk = async (rel, depth) => {
        const entries = await fs.promises.readdir(path.join(folder, rel), { withFileTypes: true });
        for (const entry of entries) {
            if (found.length >= MAX_FILES || entry.name.startsWith('.')) continue;
            const child = rel ? path.join(rel, entry.name) : entry.name;
            if (entry.isDirectory()) {
                if (depth < MAX_DEPTH) await walk(child, depth + 1);
            } else if (entry.isFile()) found.push(child);
        }
    };
    await walk('', 0);
    return found;
}

/** A file as text when small; { path } when it should stay on disk. */
async function loadSide(folder, rel) {
    if (!rel) return { text: '', path: '' };
    const full = path.join(folder, rel);
    const { size } = await fs.promises.stat(full);
    if (size > INLINE_BYTES) return { text: '', path: full };
    return { text: await fs.promises.readFile(full, 'utf8'), path: '' };
}

/**
 * @param {string} folder
 * @returns {Promise<{success: boolean, tests?: object[], capped?: boolean, error?: string}>}
 */
async function importTests(folder) {
    if (typeof folder !== 'string' || !path.isAbsolute(folder)) return { success: false, error: 'Invalid folder' };
    try {
        const pairs = pairTestFiles(await listFolder(folder));
        const tests = [];
        for (const pair of pairs.slice(0, MAX_TESTS)) {
            const input = await loadSide(folder, pair.input);
            const output = await loadSide(folder, pair.output);
            const test = { input: input.text, output: output.text, source: pair.input };
            if (input.path) test.inputPath = input.path;
            if (output.path) test.outputPath = output.path;
            tests.push(test);
        }
        return { success: true, tests, capped: pairs.length > MAX_TESTS };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * Writes test01.in / test01.out... into a folder. Nothing is written when a name is taken.
 * @param {{folder: string, tests: Array<{input?: string, output?: string, inputPath?: string, outputPath?: string}>}} options
 */
async function exportTests({ folder, tests }) {
    if (typeof folder !== 'string' || !path.isAbsolute(folder) || !Array.isArray(tests)) {
        return { success: false, error: 'Invalid folder' };
    }
    const width = Math.max(2, String(tests.length).length);
    const named = tests.map((test, i) => ({ test, base: `test${String(i + 1).padStart(width, '0')}` }));
    try {
        for (const { base } of named) {
            for (const ext of ['.in', '.out']) {
                if (fs.existsSync(path.join(folder, base + ext))) return { success: false, exists: base + ext };
            }
        }
        for (const { test, base } of named) {
            for (const [ext, text, source] of [['.in', test.input, test.inputPath], ['.out', test.output, test.outputPath]]) {
                const target = path.join(folder, base + ext);
                if (source) await fs.promises.copyFile(source, target, fs.constants.COPYFILE_EXCL);
                else await fs.promises.writeFile(target, text || '', { flag: 'wx' });
            }
        }
        return { success: true, count: named.length };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/** A file name from the renderer, or '' when it is not a plain name. */
function safeFileName(name) {
    return typeof name === 'string' && SAFE_NAME.test(name) ? name : '';
}

/** Input and output file names of a file-based problem, or null. */
function normalizeFileIO(fileIO) {
    if (!fileIO) return null;
    const input = safeFileName(fileIO.input);
    const output = safeFileName(fileIO.output);
    return input || output ? { input, output } : null;
}

/** The folder a debug session of a file-based test runs in, holding that test's input file. */
async function prepareDebugDir({ fileIO, input, inputPath }) {
    const io = normalizeFileIO(fileIO);
    if (!io) return { success: false };
    const root = appTempDir('cpp-ide-fileio');
    ensurePrivateDir(root);
    const dir = path.join(root, 'debug');
    await fs.promises.rm(dir, { recursive: true, force: true });
    ensurePrivateDir(dir);
    if (io.input) {
        const target = path.join(dir, io.input);
        if (inputPath) await fs.promises.copyFile(inputPath, target);
        else await fs.promises.writeFile(target, input || '');
    }
    return { success: true, dir };
}

module.exports = { pairTestFiles, importTests, exportTests, normalizeFileIO, prepareDebugDir };
