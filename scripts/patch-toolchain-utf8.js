'use strict';
/**
 * Lets the bundled MinGW toolchain build in folders whose names are outside the Windows ANSI
 * code page. A Windows user named "Nguyễn" has C:\Users\Nguyễn\... as %TEMP% (where every build
 * goes) and as the default per-user install folder (where the toolchain itself lives).
 *
 * GCC's own programs (g++, cc1plus) carry a manifest that makes their ANSI code page UTF-8;
 * binutils and two GCC helpers do not. They see "Nguy?n" and every build fails:
 *   ld.exe: cannot open output file C:/Users/Nguy?n/.../a.exe: Invalid argument
 *   Fatal error: can't create C:\Users\Nguy?n\...\cc0tYJLk.o: Invalid argument   (as)
 * Embedding the same manifest (activeCodePage UTF-8, honoured by Windows 10 1903 and later)
 * into them fixes every step: toolchain, sources, %TEMP% and output in such folders.
 *
 * gdb is deliberately NOT patched: with a UTF-8 code page its charset conversion fails and
 * every string prints as "<error reading variable: Converting character sets: Invalid argument.>".
 *
 *   node scripts/patch-toolchain-utf8.js [toolchainDir]            patch what is missing
 *   node scripts/patch-toolchain-utf8.js [toolchainDir] --check    report only; exit 1 if missing
 *   node scripts/patch-toolchain-utf8.js [toolchainDir] --backup <dir>   copy originals first (and
 *                                                     take a lost symbol table back from them)
 *
 * Default dir: Sameko-GCC. Patching uses mt.exe from the Windows SDK (or MT_EXE=<path>).
 * Run it again after replacing the toolchain; check-toolchain-deps.js fails until it is done.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const MANIFEST = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1">
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <activeCodePage xmlns="http://schemas.microsoft.com/SMI/2019/WindowsSettings">UTF-8</activeCodePage>
    </windowsSettings>
  </application>
</assembly>
`;

/** Programs a build runs that lack the manifest in WinLibs GCC 16 (g++/cc1plus/lto1 have it). */
const BINUTILS = ['as.exe', 'ld.exe', 'ld.bfd.exe'];
const GCC_HELPERS = ['collect2.exe', 'lto-wrapper.exe', 'lto1.exe'];

function targets(root) {
    const found = [];
    const add = (file) => { if (fs.existsSync(file)) found.push(file); };
    for (const name of BINUTILS) add(path.join(root, 'bin', name));
    // <triplet>/bin/{as,ld}.exe: the copies the GCC driver actually runs.
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name === 'bin') continue;
        const bin = path.join(root, entry.name, 'bin');
        if (fs.existsSync(path.join(bin, 'ld.exe'))) for (const name of BINUTILS) add(path.join(bin, name));
    }
    // libexec/gcc/<triplet>/<version>/
    const libexec = path.join(root, 'libexec', 'gcc');
    if (fs.existsSync(libexec)) {
        for (const triplet of fs.readdirSync(libexec)) {
            const tdir = path.join(libexec, triplet);
            if (!fs.statSync(tdir).isDirectory()) continue;
            for (const version of fs.readdirSync(tdir)) {
                for (const name of GCC_HELPERS) add(path.join(tdir, version, name));
            }
        }
    }
    return found;
}

/** A manifest resource is plain UTF-8 XML inside the file. */
function manifestState(file) {
    const text = fs.readFileSync(file).toString('latin1');
    if (/<activeCodePage[^>]*>\s*UTF-8\s*<\/activeCodePage>/i.test(text)) return 'utf8';
    return text.includes('urn:schemas-microsoft-com:asm.v1') ? 'other' : 'none';
}

/*
 * binutils-built files end with a COFF symbol block after the last section: no symbols, and a
 * string table holding the section names longer than 8 characters (".eh_frame" appears as "/4").
 * mt.exe rewrites the sections to add the manifest and drops that block, leaving the header's
 * PointerToSymbolTable inside the new data. Windows ignores it for an .exe, but objdump (and so
 * check-toolchain-deps.js) reads "bad string table size" and gives up on the file. The block is
 * therefore read before patching and appended again afterwards.
 */
function readCoff(fd) {
    const head = Buffer.alloc(4096);
    fs.readSync(fd, head, 0, head.length, 0);
    const pe = head.readUInt32LE(0x3c);
    if (head.toString('latin1', pe, pe + 4) !== 'PE\0\0') return null;
    const coff = pe + 4;
    const sections = head.readUInt16LE(coff + 2);
    const optSize = head.readUInt16LE(coff + 16);
    const table = coff + 20 + optSize;
    let longNames = false;   // a section named "/N" keeps its name in the string table
    for (let i = 0; i < sections; i++) if (head[table + i * 40] === 0x2f) longNames = true;
    return { coff, symPtr: head.readUInt32LE(coff + 8), symCount: head.readUInt32LE(coff + 12), longNames, size: fs.fstatSync(fd).size };
}

/** The symbols + string table the header points at, or null when absent or not well formed. */
function symbolBlock(file) {
    const fd = fs.openSync(file, 'r');
    try {
        const h = readCoff(fd);
        if (!h || !h.symPtr) return null;
        const strtab = h.symPtr + h.symCount * 18;
        if (strtab + 4 > h.size) return null;
        const len = Buffer.alloc(4);
        fs.readSync(fd, len, 0, 4, strtab);
        const strLen = len.readUInt32LE(0);
        if (strLen < 4 || strtab + strLen > h.size) return null;
        const block = Buffer.alloc(strtab + strLen - h.symPtr);
        fs.readSync(fd, block, 0, block.length, h.symPtr);
        return block;
    } finally { fs.closeSync(fd); }
}

/** True when the header points at a symbol block that is no longer there. */
function staleSymbolTable(file) {
    const fd = fs.openSync(file, 'r');
    let h;
    try { h = readCoff(fd); } finally { fs.closeSync(fd); }
    return !!(h && h.symPtr) && !symbolBlock(file);
}

/** Appends a symbol block at the end of the file and points the header at it. */
function appendSymbolBlock(file, block) {
    const fd = fs.openSync(file, 'r+');
    try {
        const h = readCoff(fd);
        fs.writeSync(fd, block, 0, block.length, h.size);
        const ptr = Buffer.alloc(4);
        ptr.writeUInt32LE(h.size, 0);
        fs.writeSync(fd, ptr, 0, 4, h.coff + 8);
    } finally { fs.closeSync(fd); }
}

/** Repairs a file patched without keeping its symbol block (the first version of this script). */
function repairSymbolTable(file, original) {
    const block = original && fs.existsSync(original) ? symbolBlock(original) : null;
    if (block) { appendSymbolBlock(file, block); return true; }
    const fd = fs.openSync(file, 'r+');
    try {
        const h = readCoff(fd);
        if (!h || h.symCount !== 0 || h.longNames) return false;   // names would dangle: need the original
        fs.writeSync(fd, Buffer.alloc(8), 0, 8, h.coff + 8);       // no symbol table at all
        return true;
    } finally { fs.closeSync(fd); }
}

/** What is left to do for each build program: no UTF-8 manifest, or a stale header after patching. */
function problems(root) {
    return targets(root).flatMap((file) => {
        if (manifestState(file) !== 'utf8') return [{ file, problem: 'no UTF-8 code page' }];
        if (staleSymbolTable(file)) return [{ file, problem: 'stale symbol table pointer' }];
        return [];
    });
}

function findMt() {
    if (process.env.MT_EXE && fs.existsSync(process.env.MT_EXE)) return process.env.MT_EXE;
    const kits = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin');
    if (!fs.existsSync(kits)) return null;
    const versions = fs.readdirSync(kits).filter((v) => /^\d+\.\d+\.\d+\.\d+$/.test(v))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const v of versions) {
        const mt = path.join(kits, v, 'x64', 'mt.exe');
        if (fs.existsSync(mt)) return mt;
    }
    return null;
}

function main() {
    const args = process.argv.slice(2);
    const check = args.includes('--check');
    const backupAt = args.indexOf('--backup');
    const backupDir = backupAt >= 0 ? path.resolve(args[backupAt + 1] || '') : null;
    const positional = args.filter((a, i) => !a.startsWith('--') && !(backupAt >= 0 && i === backupAt + 1));
    const root = path.resolve(positional[0] || path.join(__dirname, '..', 'Sameko-GCC'));

    if (process.platform !== 'win32') { console.log('Windows only; nothing to do.'); return 0; }
    if (!fs.existsSync(root)) { console.error(`Toolchain not found: ${root}`); return 2; }

    const files = targets(root);
    const rel = (f) => path.relative(root, f);
    const todo = problems(root);
    if (check || !todo.length) {
        const noUtf8 = todo.filter((t) => t.problem === 'no UTF-8 code page').length;
        console.log(`UTF-8 code page: ${files.length - noUtf8}/${files.length} build programs under ${root}`);
        if (todo.length) console.log(`To fix (run node scripts/patch-toolchain-utf8.js):\n  ${todo.map((t) => `${rel(t.file)}: ${t.problem}`).join('\n  ')}`);
        return todo.length ? 1 : 0;
    }

    const missing = todo.filter((t) => t.problem === 'no UTF-8 code page').map((t) => t.file);
    if (missing.length) {
        const mt = findMt();
        if (!mt) {
            console.error('mt.exe not found: install the Windows 10/11 SDK or set MT_EXE.');
            return 2;
        }
        const manifestFile = path.join(os.tmpdir(), `sameko-utf8-${process.pid}.manifest`);
        fs.writeFileSync(manifestFile, MANIFEST, 'utf8');
        try {
            for (const file of missing) {
                if (backupDir) {
                    const dest = path.join(backupDir, rel(file));
                    fs.mkdirSync(path.dirname(dest), { recursive: true });
                    if (!fs.existsSync(dest)) fs.copyFileSync(file, dest);
                }
                // -updateresource merges into a manifest the file already has; -outputresource adds one.
                const mode = manifestState(file) === 'other' ? '-updateresource' : '-outputresource';
                const block = symbolBlock(file);   // mt.exe drops it; put it back afterwards
                try {
                    execFileSync(mt, ['-nologo', '-manifest', manifestFile, `${mode}:${file};#1`], { stdio: 'pipe' });
                    if (block && staleSymbolTable(file)) appendSymbolBlock(file, block);
                    console.log(`patched ${rel(file)}`);
                } catch (err) {
                    console.error(`FAILED ${rel(file)}: ${String(err.stderr || err.message).trim()}`);
                }
            }
        } finally {
            try { fs.unlinkSync(manifestFile); } catch (_) { }
        }
    }
    // Files patched by the first version of this script lost their symbol block: restore it from
    // the originals (--backup <dir> is where they were copied), or drop a pointer nothing needs.
    for (const file of files) {
        if (!staleSymbolTable(file)) continue;
        const original = backupDir ? path.join(backupDir, rel(file)) : null;
        console.log(`${repairSymbolTable(file, original) ? 'repaired' : 'could not repair (pass --backup <originals>)'} the symbol table of ${rel(file)}`);
    }
    const left = problems(root);
    for (const t of left) console.error(`NOT fixed ${rel(t.file)}: ${t.problem}`);
    return left.length ? 1 : 0;
}

if (require.main === module) process.exit(main());
module.exports = { targets, manifestState, problems };
