'use strict';

/**
 * Realtime output where the toolchain ships no sameko_unbuffer.o (Linux and macOS use the system g++).
 * A program's stdout is a pipe here, so without this a prompt printed before `cin` stays in its
 * buffer until the program ends. The object is built once per compiler and linked like the
 * bundled one; if it cannot be built, the program is simply linked without it.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { appTempDir, ensurePrivateDir } = require('../../../shared/platform');

const SOURCE = `#include <cstdio>
#include <iostream>
namespace {
struct SamekoUnbuffer {
    SamekoUnbuffer() {
        std::setvbuf(stdout, nullptr, _IONBF, 0);
        std::cout << std::unitbuf;
    }
} samekoUnbuffer;
}
`;

const building = new Map();

function objectPathFor(compiler, dir) {
    let stamp = '';
    try { stamp = String(fs.statSync(compiler).mtimeMs); } catch (_) { }
    const id = crypto.createHash('sha1').update(`${compiler}\0${stamp}\0${SOURCE}`).digest('hex').slice(0, 12);
    return path.join(dir, `sameko_unbuffer-${id}.o`);
}

function build(compiler, dir, output) {
    return new Promise((resolve) => {
        const source = `${output}.${process.pid}.cpp`;
        const temp = `${output}.${process.pid}.tmp.o`;
        const done = (result) => {
            for (const f of [source, temp]) { try { fs.unlinkSync(f); } catch (_) { } }
            resolve(result);
        };
        try {
            fs.writeFileSync(source, SOURCE);
        } catch (_) {
            done(null);
            return;
        }
        execFile(compiler, ['-std=c++11', '-O2', '-fPIC', '-w', '-c', source, '-o', temp], { cwd: dir, timeout: 30000 }, (err) => {
            if (err) { done(null); return; }
            try {
                fs.renameSync(temp, output);
                done(output);
            } catch (_) {
                done(null);
            }
        });
    });
}

/** @returns {Promise<string|null>} the object file to link, or null */
async function ensureUnbufferObject(compiler) {
    let dir;
    try {
        dir = appTempDir('sameko-unbuffer');
        ensurePrivateDir(dir);
    } catch (_) {
        return null;
    }
    const output = objectPathFor(compiler, dir);
    if (fs.existsSync(output)) return output;
    if (!building.has(output)) {
        building.set(output, build(compiler, dir, output).finally(() => building.delete(output)));
    }
    return building.get(output);
}

module.exports = { ensureUnbufferObject };
