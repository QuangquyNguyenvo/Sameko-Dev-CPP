'use strict';

/**
 * Builds sameko-dev-cpp-<version>-installer.exe: the themed setup window (installer/setup/) with the NSIS
 * installer from electron-builder embedded in it. Windows only; uses the C# compiler that ships
 * with .NET Framework 4.8, so nothing has to be installed.
 *
 *   node scripts/build-setup.js [outputDir]            after `electron-builder --win nsis`
 *   node scripts/build-setup.js [outputDir] --preview  without an NSIS installer; run the result
 *                                                      with --demo
 *
 * outputDir defaults to package.json › build.directories.output. The NSIS installer and its
 * win-unpacked folder (for the size the progress bar counts towards) are read from there.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));
const SRC = path.join(ROOT, 'installer', 'setup');

const args = process.argv.slice(2);
const preview = args.includes('--preview');
const outDir = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(ROOT, pkg.build.directories.output));

if (process.platform !== 'win32') {
    console.log('build-setup: Windows only, skipped.');
    process.exit(0);
}

const fw = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319');
const csc = path.join(fw, 'csc.exe');
if (!fs.existsSync(csc)) {
    console.error(`build-setup: C# compiler not found at ${csc} (.NET Framework 4.8 is needed).`);
    process.exit(1);
}

function folderSize(dir) {
    let total = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        total += entry.isDirectory() ? folderSize(p) : fs.statSync(p).size;
    }
    return total;
}

const nsisName = pkg.build.nsis.artifactName.replace('${version}', pkg.version).replace('${ext}', 'exe');
const nsisPath = path.join(outDir, nsisName);
const unpacked = path.join(outDir, 'win-unpacked');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sameko-setup-build-'));
try {
    let payload = nsisPath;
    if (!fs.existsSync(nsisPath)) {
        if (!preview) {
            console.error(`build-setup: ${nsisPath} not found. Build the NSIS installer first, or pass --preview.`);
            process.exit(1);
        }
        payload = path.join(work, 'payload.exe');
        fs.writeFileSync(payload, '');
    }
    const size = fs.existsSync(unpacked) ? folderSize(unpacked) : 900 * 1024 * 1024;
    fs.writeFileSync(path.join(work, 'size.txt'), String(size));
    fs.writeFileSync(path.join(work, 'version.txt'), pkg.version);

    fs.mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, `sameko-dev-cpp-${pkg.version}-installer.exe`);
    const res = (file, name) => `/resource:${file},${name}`;
    execFileSync(csc, [
        '/nologo', '/target:winexe', '/optimize+', '/platform:anycpu',
        `/out:${out}`,
        `/win32icon:${path.join(ROOT, 'src', 'assets', 'icon.ico')}`,
        `/win32manifest:${path.join(SRC, 'app.manifest')}`,
        `/reference:${path.join(fw, 'WPF', 'PresentationFramework.dll')}`,
        `/reference:${path.join(fw, 'WPF', 'PresentationCore.dll')}`,
        `/reference:${path.join(fw, 'WPF', 'WindowsBase.dll')}`,
        `/reference:${path.join(fw, 'System.Xaml.dll')}`,
        res(path.join(SRC, 'Setup.xaml'), 'Setup.xaml'),
        res(path.join(ROOT, 'src', 'assets', 'icons', 'icon-256.png'), 'icon.png'),
        res(payload, 'payload.exe'),
        res(path.join(work, 'size.txt'), 'payload.size'),
        res(path.join(work, 'version.txt'), 'payload.version'),
        path.join(SRC, 'Setup.cs'),
    ], { stdio: 'inherit' });
    console.log(`build-setup: ${out} (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`);
} finally {
    fs.rmSync(work, { recursive: true, force: true });
}
