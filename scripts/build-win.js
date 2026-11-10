'use strict';
/**
 * npm run build:win: the NSIS installer with the toolchain as a separate archive
 * (scripts/toolchain-package.js), so updates that keep the same GCC leave it on disk instead of
 * rewriting ~700 MB; then the portable zip, packed from the same app folder with the toolchain
 * put back inside it.
 *
 *   node scripts/build-win.js [--no-zip] [electron-builder options...]
 *
 * Options after the script's own are passed to both electron-builder runs (e.g. --config <file>,
 * -c.directories.output=<dir>). win-unpacked keeps the toolchain afterwards, for
 * check-toolchain-deps.js, probe9.js and build-setup.js.
 *
 * The zip is packed from the NSIS run's folder (--prepackaged), not built in a run of its own:
 * electron-builder writes resources/app-update.yml, which tells the app where to look for
 * updates, only in a run that builds the installer, and without it the zip build never learned
 * of a new version. It also makes the zip the very same app as the installer.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { restore } = require('./toolchain-package');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'node_modules', 'electron-builder', 'cli.js');

const args = process.argv.slice(2);
const noZip = args.includes('--no-zip');
const passthrough = args.filter((a) => a !== '--no-zip');

function outputDir() {
    const flag = passthrough.find((a) => a.startsWith('-c.directories.output='));
    if (flag) return path.resolve(ROOT, flag.split('=').slice(1).join('='));
    const at = passthrough.indexOf('--config');
    const config = at >= 0 ? require(path.resolve(ROOT, passthrough[at + 1])) : require(path.join(ROOT, 'package.json')).build;
    return path.resolve(ROOT, (config.directories && config.directories.output) || 'dist');
}

function run(targets, env, extra = []) {
    const res = spawnSync(process.execPath, [CLI, '--win', ...targets, ...extra, ...passthrough],
        { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
    if (res.status !== 0) throw new Error(`electron-builder --win ${targets.join(' ')} failed (${res.status})`);
}

const appOutDir = path.join(outputDir(), 'win-unpacked');
let code = 0;
try {
    try {
        run(['nsis'], { SAMEKO_SPLIT_TOOLCHAIN: '1' });
    } finally {
        restore(appOutDir);
    }
    if (!fs.existsSync(path.join(appOutDir, 'resources', 'app-update.yml'))) {
        throw new Error(`build-win: ${appOutDir}\\resources\\app-update.yml was not written`);
    }
    if (!noZip) run(['zip'], { SAMEKO_SPLIT_TOOLCHAIN: '' }, ['--prepackaged', appOutDir]);
} catch (err) {
    console.error(err.message);
    code = 1;
}
if (!fs.existsSync(path.join(appOutDir, 'resources', 'Sameko-GCC'))) {
    console.error(`build-win: ${appOutDir}\\resources\\Sameko-GCC is missing after the build`);
    code = 1;
}
process.exit(code);
