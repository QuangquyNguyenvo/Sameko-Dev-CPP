'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_RESULTS = 2000;
const MAX_QUERY_LENGTH = 512;
const EXCLUDED_DIRECTORIES = new Set([
    '.git', 'node_modules', 'build', 'builds', 'dist', 'out', 'bin', 'obj', 'release', 'debug',
    '.next', 'cmakefiles', 'samekodevcpp'
]);
const BINARY_EXTENSION = /\.(?:exe|dll|so|dylib|a|lib|o|obj|gch|pch|class|jar|zip|gz|7z|pdf|png|jpe?g|gif|webp|ico|mp[34]|woff2?)$/i;
const BINARY_CONTROL = /[\x00-\x08\x0b\x0e-\x1f]/;

async function readSearchText(file, decoder, buffer) {
    const handle = await fs.open(file, 'r');
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
        let size = 0;
        while (size < buffer.length) {
            const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size);
            if (!bytesRead) break;
            size += bytesRead;
        }
        if (size > MAX_FILE_BYTES) return null;
        const text = decoder.decode(buffer.subarray(0, size));
        return BINARY_CONTROL.test(text) ? null : text;
    } finally {
        await handle.close();
    }
}

async function scan({ folder, query, caseSensitive, regex }) {
    if (!path.isAbsolute(folder) || !query || query.length > MAX_QUERY_LENGTH) return { status: 'invalid-query' };
    let pattern;
    try {
        const source = regex ? query : query.replace(/[.*+?^{}$()|[\]\\]/g, '\\$&');
        pattern = new RegExp(source, caseSensitive ? 'u' : 'iu');
    } catch (_) {
        return { status: 'invalid-regex' };
    }

    const files = [];
    const folders = [folder];
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const buffer = Buffer.allocUnsafe(MAX_FILE_BYTES + 1);
    let count = 0;
    while (folders.length) {
        const dir = folders.pop();
        let entries;
        try {
            entries = await fs.opendir(dir);
        } catch (_) {
            if (dir === folder) return { status: 'unavailable' };
            continue;
        }
        for await (const entry of entries) {
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                const name = entry.name.toLowerCase();
                if (!EXCLUDED_DIRECTORIES.has(name) && !name.startsWith('cmake-build-')) folders.push(file);
            }
            if (!entry.isFile() || BINARY_EXTENSION.test(entry.name)) continue;
            const text = await readSearchText(file, decoder, buffer).catch(() => null);
            if (text === null) continue;

            const matches = [];
            const lines = text.split(/\r\n|\n|\r/);
            for (let index = 0; index < lines.length; index++) {
                const line = lines[index];
                const match = pattern.exec(line);
                if (!match) continue;
                const start = Math.max(0, match.index - 60);
                const end = start + 220;
                const preview = (start ? '…' : '') + line.slice(start, end) + (line.length > end ? '…' : '');
                matches.push({ line: index + 1, column: match.index + 1, preview });
                if (++count === MAX_RESULTS) break;
            }
            if (matches.length) files.push({ path: file, relativePath: path.relative(folder, file), matches });
            if (count === MAX_RESULTS) return { status: 'ok', count, files, capped: true };
        }
    }
    return { status: 'ok', count, files, capped: false };
}

async function searchInFiles(options) {
    if (typeof options?.folder !== 'string' || typeof options.query !== 'string') {
        return { status: 'invalid-query' };
    }
    // Main can read our bundled source from ASAR. Node workers can then start
    // without needing an unpacked copy of the module.
    const source = await fs.readFile(__filename, 'utf8');
    return new Promise(resolve => {
        // An expensive user regex must never block Electron's main process.
        const worker = new Worker(source, { eval: true, workerData: options });
        const finish = result => {
            clearTimeout(timer);
            resolve(result);
        };
        const timer = setTimeout(() => {
            void worker.terminate();
            finish({ status: 'timeout' });
        }, 10000);
        worker.once('message', finish);
        worker.once('error', () => finish({ status: 'unavailable' }));
        worker.once('exit', () => finish({ status: 'unavailable' }));
    });
}

if (isMainThread) {
    module.exports = { searchInFiles };
} else {
    scan(workerData).then(result => parentPort.postMessage(result));
}
