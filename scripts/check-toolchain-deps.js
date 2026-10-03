/**
 * Checks that every executable and DLL of a bundled toolchain can load: each DLL
 * it imports must sit next to it or be a Windows system DLL. Run it on a packaged
 * build after changing the `extraResources` filter in package.json or updating
 * Sameko-GCC, since that filter drops DLLs the IDE's tools do not import.
 *
 *   node scripts/check-toolchain-deps.js [toolchainDir]
 *
 * Default dir: samekodevcpp/win-unpacked/resources/Sameko-GCC. Exits 1 when
 * something is missing. Windows only (reads PE imports with the bundled objdump).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..', 'samekodevcpp', 'win-unpacked', 'resources', 'Sameko-GCC'));
const objdump = path.join(root, 'bin', 'objdump.exe');
const system32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
if (!fs.existsSync(objdump)) {
    console.error(`objdump not found: ${objdump}`);
    process.exit(2);
}

function* binaries(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            // Python's own extension modules are loaded by gdb's interpreter, not the OS loader.
            if (!/^python/i.test(entry.name)) yield* binaries(full);
        } else if (/\.(exe|dll)$/i.test(entry.name)) {
            yield full;
        }
    }
}

// The IDE puts <toolchain>/bin on PATH for every compiler, debugger and program
// it starts, so a DLL found there resolves too (e.g. ld's LTO plugin in lib/bfd-plugins).
const binDir = path.join(root, 'bin');
const missing = [];
let checked = 0;
for (const file of binaries(root)) {
    let out;
    try {
        out = execFileSync(objdump, ['-p', file], { encoding: 'latin1', maxBuffer: 64 << 20 });
    } catch (_) {
        continue; // not a PE image objdump understands
    }
    checked++;
    const dir = path.dirname(file);
    for (const [, dll] of out.matchAll(/DLL Name: (\S+)/g)) {
        if (/^(api|ext)-ms-/i.test(dll)) continue;
        if ([dir, binDir, system32].some((d) => fs.existsSync(path.join(d, dll)))) continue;
        missing.push(`${path.relative(root, file)} -> ${dll}`);
    }
}

console.log(`Checked ${checked} binaries under ${root}`);
if (missing.length) {
    console.log(`Missing DLLs (${missing.length}):\n  ${missing.join('\n  ')}`);
    process.exit(1);
}
console.log('All imports resolve.');
