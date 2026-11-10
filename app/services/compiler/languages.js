/**
 * Sameko Dev C++ IDE - languages other than C/C++
 *
 * Python, Java, Kotlin, Rust, Go, Pascal (Free Pascal) and JavaScript (Node.js) are built, run
 * and judged like C++: Build & Run, Run All Tests and the stress test. Their compilers and
 * interpreters are not bundled. The ones installed on the machine are used, looked up on PATH
 * (including the PATH saved in the registry, so a tool installed while the app runs is found)
 * and in their usual install folders, unless Settings › Compiler › Other Languages names one
 * (settings.languages.<id>.path). clangd, live check, AStyle and the debugger stay C/C++ only.
 *
 * A build leaves an artifact in <temp>/cpp-ide-builds/lang/<name>-<hash of the source path>/:
 *   Rust, Go, Pascal          the program itself (prog.exe)
 *   Python, JavaScript        run.json naming the interpreter and the source (after a syntax
 *                             check, so a syntax error is a compile error, not a crash per test)
 *   Java, Kotlin              run.json for `java -cp <dir> <class>` / `java -jar <jar>`
 * runCommand() turns an artifact into the command that starts it; the executor, the batch tester
 * and the external terminal all go through it. A JVM gets a small initial heap (its default
 * commits 1/64 of the RAM at start, which a 256 MB memory limit would refuse) and, under a
 * memory limit, that limit as -Xmx, as Codeforces runs Java.
 *
 * @module app/services/compiler/languages
 */

'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');
const { IS_WIN, EXE_SUFFIX, appTempDir, ensurePrivateDir, killProcessTree } = require('../../shared/platform');

/** id -> name, file extensions and the tools a build needs (the first one is the one Settings can set). */
const LANGUAGES = {
    python: { name: 'Python', exts: ['py'], tools: ['python'] },
    java: { name: 'Java', exts: ['java'], tools: ['javac', 'java'] },
    kotlin: { name: 'Kotlin', exts: ['kt'], tools: ['kotlinc', 'java'] },
    rust: { name: 'Rust', exts: ['rs'], tools: ['rustc'] },
    go: { name: 'Go', exts: ['go'], tools: ['go'] },
    pascal: { name: 'Pascal', exts: ['pas', 'pp'], tools: ['fpc'] },
    javascript: { name: 'JavaScript', exts: ['js', 'mjs', 'cjs'], tools: ['node'] },
};

const PF = process.env.ProgramFiles || 'C:/Program Files';
const HOME = process.env.USERPROFILE || process.env.HOME || '';
const LOCAL = process.env.LOCALAPPDATA || '';
const JDK_DIRS = [`${PF}/Java/*`, `${PF}/Eclipse Adoptium/*`, `${PF}/Microsoft/jdk-*`, `${PF}/Zulu/*`,
    `${PF}/Amazon Corretto/*`, `${PF}/BellSoft/*`, `${PF}/OpenJDK/*`, `${HOME}/.jdks/*`];

/**
 * How to find and identify each tool. `names` are looked up on PATH in order; `dirs` (Windows,
 * `*` matches one folder level, newest name first) are tried after PATH; `home` is an environment
 * variable whose bin folder holds the tool.
 */
const TOOLS = {
    python: {
        names: ['python', 'python3', 'py'], version: ['--version'], match: /Python (3\.[\w.]+)/,
        dirs: [`${LOCAL}/Programs/Python/Python3*/python.exe`, `${PF}/Python3*/python.exe`, 'C:/Python3*/python.exe'],
    },
    node: { names: ['node'], version: ['--version'], match: /v(\d[\w.]*)/, dirs: [`${PF}/nodejs/node.exe`] },
    javac: { names: ['javac'], version: ['-version'], match: /javac (\S+)/, home: 'JAVA_HOME', dirs: JDK_DIRS.map(d => `${d}/bin/javac.exe`) },
    java: { names: ['java'], version: ['-version'], match: /version "([^"]+)"/, home: 'JAVA_HOME', dirs: JDK_DIRS.map(d => `${d}/bin/java.exe`) },
    kotlinc: {
        names: ['kotlinc'], version: ['-version'], match: /kotlinc-jvm (\S+)/, home: 'KOTLIN_HOME', timeout: 30000,
        dirs: [`${PF}/kotlinc/bin/kotlinc.bat`, `${LOCAL}/Programs/kotlinc/bin/kotlinc.bat`, 'C:/kotlinc/bin/kotlinc.bat'],
    },
    rustc: { names: ['rustc'], version: ['-vV'], match: /rustc (\S+)/, dirs: [`${process.env.CARGO_HOME || `${HOME}/.cargo`}/bin/rustc.exe`] },
    go: { names: ['go'], version: ['version'], match: /go(\d[\w.]*)/, home: 'GOROOT', dirs: [`${PF}/Go/bin/go.exe`, 'C:/Go/bin/go.exe'] },
    fpc: {
        names: ['fpc'], version: ['-iV'], match: /^\s*(\d[\w.]*)/m,
        dirs: ['C:/FPC/*/bin/*/fpc.exe', 'C:/lazarus/fpc/*/bin/*/fpc.exe', `${PF}/Lazarus/fpc/*/bin/*/fpc.exe`, 'C:/Dev-Pas/bin/fpc.exe'],
    },
};

const RUN_FILE = 'run.json';
const MAX_LANG_BUILDS = 40;

// ---------------------------------------------------------------------------
// Which file is which language
// ---------------------------------------------------------------------------

/** @returns {string|null} the language id of a source file, null for C/C++ and anything else */
function languageOfFile(filePath) {
    const ext = path.extname(String(filePath || '')).slice(1).toLowerCase();
    if (!ext) return null;
    for (const [id, lang] of Object.entries(LANGUAGES)) {
        if (lang.exts.includes(ext)) return id;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Finding the tools
// ---------------------------------------------------------------------------

let registryPathCache = { at: 0, dirs: [] };

/** PATH as the registry has it now (Windows): a tool installed after the app started is on it. */
function registryPathDirs() {
    if (!IS_WIN) return [];
    if (Date.now() - registryPathCache.at < 30000) return registryPathCache.dirs;
    let text = '';
    try {
        // .NET reads both values and expands %VARS%; UTF-8 out, so a folder named Nguyễn survives.
        text = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
            "[Console]::OutputEncoding=[Text.Encoding]::UTF8;"
            + "[Environment]::GetEnvironmentVariable('Path','Machine')+';'+[Environment]::GetEnvironmentVariable('Path','User')"],
        { encoding: 'utf8', windowsHide: true, timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (_) { /* keep the process PATH only */ }
    registryPathCache = { at: Date.now(), dirs: splitPath(text) };
    return registryPathCache.dirs;
}

function splitPath(value) {
    return String(value || '').split(path.delimiter).map(d => d.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean);
}

function pathDirs(withRegistry) {
    const seen = new Set();
    const out = [];
    for (const dir of [...splitPath(process.env.PATH || process.env.Path), ...(withRegistry ? registryPathDirs() : [])]) {
        const key = IS_WIN ? dir.toLowerCase() : dir;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(dir);
    }
    return out;
}

function isFile(p) {
    try { return fs.statSync(p).isFile(); } catch (_) { return false; }
}

/** Every file a name resolves to on PATH, in PATH order. */
function onPath(name, dirs) {
    const exts = IS_WIN ? ['.exe', '.cmd', '.bat'] : [''];
    const found = [];
    for (const dir of dirs) {
        for (const ext of exts) {
            const candidate = path.join(dir, name + ext);
            if (isFile(candidate)) found.push(candidate);
        }
    }
    return found;
}

/** Expands a pattern whose segments may contain `*`, newest-looking names first. */
function expandPattern(pattern) {
    const parts = pattern.replace(/\\/g, '/').split('/');
    let current = [parts[0] === '' ? '/' : parts[0] + (IS_WIN && /^[A-Za-z]:$/.test(parts[0]) ? '/' : '')];
    for (const part of parts.slice(1)) {
        if (!part) continue;
        const next = [];
        for (const base of current) {
            if (!part.includes('*')) { next.push(path.join(base, part)); continue; }
            const re = new RegExp('^' + part.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
            let names = [];
            try { names = fs.readdirSync(base); } catch (_) { continue; }
            names.filter(n => re.test(n))
                .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
                .forEach(n => next.push(path.join(base, n)));
        }
        current = next;
    }
    return current.filter(isFile);
}

/** A copy of the Microsoft Store "python.exe" that only opens the Store is not Python. */
function isStorePythonStub(file) {
    return IS_WIN && /\\WindowsApps\\/i.test(file);
}

function runsAsPython3(file, prefix) {
    try {
        const out = execFileSync(file, [...prefix, '--version'], { encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] });
        return /Python 3\./.test(out);
    } catch (_) { return false; }
}

function settingsOverride(langId) {
    try {
        const { readSettings } = require('../../shared/settings-store');
        const p = readSettings()?.languages?.[langId]?.path;
        return typeof p === 'string' && p.trim() ? p.trim().replace(/^"(.*)"$/, '$1') : '';
    } catch (_) { return ''; }
}

/**
 * Where a tool is, or null. Settings first (for the language's first tool), then a tool next to
 * the one Settings names (java next to javac), PATH, the tool's home variable and its usual folders.
 * @returns {{file: string, prefix: string[]}|null} prefix: arguments that come first (`py -3`)
 */
function locateTool(name, { override = '', near = '' } = {}) {
    const spec = TOOLS[name];
    if (override) {
        if (isFile(override)) return { file: override, prefix: [] };
        if (isFile(path.join(override, name + EXE_SUFFIX))) return { file: path.join(override, name + EXE_SUFFIX), prefix: [] };
        if (IS_WIN && isFile(path.join(override, name + '.bat'))) return { file: path.join(override, name + '.bat'), prefix: [] };
        return null;   // the user's choice is wrong: say so instead of silently using another tool
    }
    const pick = (candidates) => {
        for (const file of candidates) {
            const prefix = name === 'python' && /^py(\.exe)?$/i.test(path.basename(file)) ? ['-3'] : [];
            if (name === 'python' && (isStorePythonStub(file) || prefix.length) && !runsAsPython3(file, prefix)) continue;
            return { file, prefix };
        }
        return null;
    };
    const candidates = [];
    if (near) candidates.push(...onPath(name, [path.dirname(near)]));
    if (spec.home && process.env[spec.home]) candidates.push(...onPath(name, [path.join(process.env[spec.home], 'bin')]));
    for (const n of spec.names) candidates.push(...onPath(n, pathDirs(false)));
    if (IS_WIN) for (const pattern of spec.dirs || []) candidates.push(...expandPattern(pattern));
    // The registry's PATH (a PowerShell call) only when the app's own PATH has no such tool.
    return pick(candidates) || (IS_WIN ? pick(spec.names.flatMap(n => onPath(n, pathDirs(true)))) : null);
}

const INSTALL_HINT = {
    python: 'Install Python 3 from python.org (tick "Add python.exe to PATH").',
    java: 'Install a JDK (for example Eclipse Temurin from adoptium.net).',
    kotlin: 'Install the Kotlin compiler (kotlinc) and a JDK.',
    rust: 'Install Rust with rustup (rustup.rs).',
    go: 'Install Go from go.dev.',
    pascal: 'Install Free Pascal from freepascal.org.',
    javascript: 'Install Node.js from nodejs.org.',
};

/**
 * The tools of a language, or an error that says what is missing.
 * @returns {{tools: Object<string, {file: string, prefix: string[]}>}|{error: string}}
 */
function toolsFor(langId, override = settingsOverride(langId)) {
    const lang = LANGUAGES[langId];
    const tools = {};
    for (const [i, name] of lang.tools.entries()) {
        const near = i > 0 ? tools[lang.tools[0]]?.file : '';
        const found = locateTool(name, i === 0 ? { override } : { near });
        if (!found) {
            const what = i === 0 && override ? `${override} (set in Settings › Compiler) is not ${name}` : `${name} was not found`;
            return { error: `${lang.name}: ${what}. ${INSTALL_HINT[langId]} Or set its path in Settings › Compiler › Other Languages.` };
        }
        tools[name] = found;
    }
    return { tools };
}

// ---------------------------------------------------------------------------
// Running tools
// ---------------------------------------------------------------------------

let activeBuild = null;

/** A .bat/.cmd (kotlinc) must go through cmd.exe; Node refuses to spawn one directly. */
function spawnTool(file, args, options) {
    if (IS_WIN && /\.(bat|cmd)$/i.test(file)) {
        const line = [file, ...args].map(a => `"${String(a).replace(/"/g, '')}"`).join(' ');
        return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/v:off', '/s', '/c', `"${line}"`],
            { ...options, windowsVerbatimArguments: true });
    }
    return spawn(file, args, options);
}

/** Run a build step to the end. @returns {Promise<{code: number|null, out: string}>} out: stdout + stderr */
function runTool(file, args, { cwd, env, timeout = 120000 } = {}) {
    return new Promise((resolve) => {
        let out = '';
        let child;
        try {
            child = spawnTool(file, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (err) {
            resolve({ code: null, out: `Could not start ${file}: ${err.message}` });
            return;
        }
        activeBuild = child;
        const add = (d) => { if (out.length < 1024 * 1024) out += d; };
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', add);
        child.stderr.on('data', add);
        const timer = setTimeout(() => { out += `\n${path.basename(file)} took longer than ${timeout / 1000} s and was stopped.`; killProcessTree(child); }, timeout);
        child.on('error', (err) => { clearTimeout(timer); if (activeBuild === child) activeBuild = null; resolve({ code: null, out: `${out}Could not start ${file}: ${err.message}` }); });
        child.on('close', (code) => { clearTimeout(timer); if (activeBuild === child) activeBuild = null; resolve({ code, out }); });
    });
}

/** Stop a build still running (a new compile replaces it). */
function cancelBuild() {
    if (activeBuild) { try { killProcessTree(activeBuild); } catch (_) { } activeBuild = null; }
}

function baseEnv() {
    try { return require('./detector').getCompilerEnv(); } catch (_) { return { ...process.env }; }
}

// ---------------------------------------------------------------------------
// Builds
// ---------------------------------------------------------------------------

function buildsRoot() {
    const dir = path.join(appTempDir('cpp-ide-builds'), 'lang');
    if (!fs.existsSync(dir)) ensurePrivateDir(dir);
    return dir;
}

/** Old build folders go once there are more than MAX_LANG_BUILDS (newest kept). */
function pruneBuilds(root) {
    try {
        const dirs = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory())
            .map(e => { const p = path.join(root, e.name); return { p, t: fs.statSync(p).mtimeMs }; })
            .sort((a, b) => b.t - a.t);
        for (const d of dirs.slice(MAX_LANG_BUILDS)) fs.rmSync(d.p, { recursive: true, force: true });
    } catch (_) { }
}

/** ASCII name for build outputs: Free Pascal and some linkers cannot open a path with ễ in it. */
function asciiStem(src) {
    return (path.basename(src, path.extname(src)).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 24)) || 'prog';
}

function outDirFor(src) {
    const root = buildsRoot();
    pruneBuilds(root);
    const key = IS_WIN ? path.resolve(src).toLowerCase() : path.resolve(src);
    const dir = path.join(root, `${asciiStem(src)}-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 10)}`);
    fs.mkdirSync(dir, { recursive: true });
    try { const now = new Date(); fs.utimesSync(dir, now, now); } catch (_) { }
    return dir;
}

/** Windows 8.3 path (ASCII) of an existing file or folder, for tools that use the ANSI file API. */
function shortPath(p) {
    if (!IS_WIN || /^[\x20-\x7e]*$/.test(p)) return p;
    try {
        // Verbatim: cmd.exe reads its own command line and does not understand \" escapes.
        const out = execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"for %I in ("${p}") do @echo %~sI"`],
            { encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], windowsVerbatimArguments: true });
        const s = out.trim().split(/\r?\n/).pop();
        return s && /^[\x20-\x7e]+$/.test(s) ? s : p;
    } catch (_) { return p; }
}

// Last good build per output folder: { key, artifact, stamp }. In memory, like the C++ cache.
const buildCache = new Map();

function stampOf(file) {
    try { const st = fs.statSync(file); return `${st.size}:${Math.round(st.mtimeMs)}`; } catch (_) { return null; }
}

function cacheKey(parts) {
    const h = crypto.createHash('sha1');
    for (const p of parts) h.update(String(p)).update('\0');
    return h.digest('hex');
}

function toolStamp(tool) {
    return `${tool.file}|${stampOf(tool.file)}`;
}

function writeRunFile(dir, tool, args) {
    const file = path.join(dir, RUN_FILE);
    fs.writeFileSync(file, JSON.stringify({ tool, args }), 'utf8');
    return file;
}

/** Problem entries for the renderer's Problems list, from one pattern over the compiler output. */
function collect(out, re, map) {
    const list = [];
    for (const line of String(out).split(/\r?\n/)) {
        const m = line.match(re);
        if (m) {
            const p = map(m);
            if (p) list.push(p);
        }
        if (list.length >= 200) break;
    }
    return list;
}

/** A path a compiler printed, made absolute, and the source itself when it names the source. */
function problemFile(file, src, cwd) {
    const f = String(file || '').trim();
    if (!f) return src;
    const abs = path.isAbsolute(f) ? f : path.resolve(cwd, f);
    const name = path.basename(abs).toLowerCase();
    if (name === path.basename(src).toLowerCase() || name === path.basename(shortPath(src)).toLowerCase()) return src;
    return abs;
}

const rustHosts = new Map();

/** The target rustc builds for by default (x86_64-pc-windows-msvc or -gnu), once per rustc. */
function rustHost(rustc) {
    const key = toolStamp(rustc);
    if (!rustHosts.has(key)) {
        let host = '';
        try { host = (execFileSync(rustc.file, ['-vV'], { encoding: 'utf8', windowsHide: true, timeout: 10000 }).match(/host: (\S+)/) || [])[1] || ''; } catch (_) { }
        rustHosts.set(key, host);
    }
    return rustHosts.get(key);
}

const BUILDERS = {
    async python({ src, content, tools, dir }) {
        const py = tools.python;
        const key = cacheKey(['python', toolStamp(py), content]);
        const check = "import sys;compile(open(sys.argv[1],'rb').read(),sys.argv[1],'exec')";
        return {
            key,
            async make() {
                const r = await runTool(py.file, [...py.prefix, '-c', check, src], { cwd: path.dirname(src), env: { ...baseEnv(), ...PY_ENV } });
                if (r.code !== 0) {
                    // Drop the lines about the checker itself ("Traceback", File "<string>").
                    const lines = r.out.split(/\r?\n/);
                    const at = lines.findIndex(l => /^\s*File "(?!<string>)/.test(l));
                    const error = (at >= 0 ? lines.slice(at).map((l, i) => (i === 0 ? l.trim() : l)) : lines).join('\n').trim();
                    const msg = (error.split('\n').filter(Boolean).pop() || 'SyntaxError').trim();
                    const problems = collect(error, /^File "(.+)", line (\d+)/, m => ({ file: problemFile(m[1], src, dir), line: +m[2], col: 1, type: 'error', message: msg }));
                    return { error: error || r.out, problems };
                }
                return { artifact: writeRunFile(dir, 'python', [src]) };
            },
        };
    },

    async javascript({ src, content, tools, dir }) {
        const node = tools.node;
        return {
            key: cacheKey(['node', toolStamp(node), content]),
            async make() {
                const r = await runTool(node.file, ['--check', src], { cwd: path.dirname(src), env: baseEnv() });
                if (r.code !== 0) {
                    const error = r.out.split(/\r?\n/).filter(l => !/^\s+at /.test(l)).join('\n').trim();
                    const msg = (error.split('\n').filter(l => /Error/.test(l)).pop() || 'SyntaxError').trim();
                    const problems = collect(error, /^(.+\.[cm]?js):(\d+)$/, m => ({ file: problemFile(m[1], src, dir), line: +m[2], col: 1, type: 'error', message: msg }));
                    return { error, problems };
                }
                return { artifact: writeRunFile(dir, 'node', [src]) };
            },
        };
    },

    async java({ src, content, tools, dir }) {
        const javac = tools.javac;
        return {
            key: cacheKey(['java', toolStamp(javac), content]),
            async make() {
                const classes = path.join(dir, 'classes');
                fs.rmSync(classes, { recursive: true, force: true });
                fs.mkdirSync(classes, { recursive: true });
                const r = await runTool(javac.file, ['-encoding', 'UTF-8', '-J-Duser.language=en', '-J-Dfile.encoding=UTF-8', '-d', classes, src],
                    { cwd: path.dirname(src), env: baseEnv() });
                const problems = collect(r.out, /^(.+\.java):(\d+): (error|warning): (.*)$/, m => ({ file: problemFile(m[1], src, dir), line: +m[2], col: 1, type: m[3], message: m[4] }));
                if (r.code !== 0) return { error: r.out.trim() || 'javac failed', problems };
                // The class to start: the public one (javac makes it match the file name), else the first.
                const pkg = (content.match(/^\s*package\s+([\w.]+)\s*;/m) || [])[1] || '';
                const names = [(content.match(/\bpublic\s+(?:final\s+|abstract\s+)*class\s+([A-Za-z_$][\w$]*)/) || [])[1],
                    path.basename(src, path.extname(src)), (content.match(/\bclass\s+([A-Za-z_$][\w$]*)/) || [])[1]].filter(Boolean);
                const main = names.find(n => isFile(path.join(classes, ...pkg.split('.').filter(Boolean), `${n}.class`)));
                if (!main) return { error: `javac built no class to start (looked for ${names.join(', ')}).`, problems };
                return { artifact: writeRunFile(dir, 'java', ['-cp', classes, pkg ? `${pkg}.${main}` : main]), warnings: r.out.trim(), problems };
            },
        };
    },

    async kotlin({ src, content, tools, dir }) {
        const kotlinc = tools.kotlinc;
        const javaHome = path.dirname(path.dirname(tools.java.file));
        return {
            key: cacheKey(['kotlin', toolStamp(kotlinc), content]),
            async make() {
                const jar = path.join(dir, `${asciiStem(src)}.jar`);
                fs.rmSync(jar, { force: true });
                const r = await runTool(kotlinc.file, [src, '-include-runtime', '-d', jar],
                    { cwd: path.dirname(src), env: { ...baseEnv(), JAVA_HOME: javaHome }, timeout: 300000 });
                const problems = collect(r.out, /^(.+\.kt):(\d+):(\d+): (error|warning): (.*)$/, m => ({ file: problemFile(m[1], src, dir), line: +m[2], col: +m[3], type: m[4], message: m[5] }));
                if (r.code !== 0 || !isFile(jar)) return { error: r.out.trim() || 'kotlinc failed', problems };
                return { artifact: writeRunFile(dir, 'java', ['-jar', jar]), warnings: r.out.trim(), problems };
            },
        };
    },

    async rust({ src, content, tools, dir }) {
        const rustc = tools.rustc;
        // Built as the judges do (-O); a 256 MB main-thread stack on Windows, as for C++.
        const host = rustHost(rustc);
        const stack = !IS_WIN ? [] : /msvc/.test(host) ? ['-C', 'link-arg=/STACK:268435456'] : /gnu/.test(host) ? ['-C', 'link-arg=-Wl,--stack,268435456'] : [];
        const args = ['--edition', '2021', '-O', '-C', 'debuginfo=0', ...stack];
        return {
            key: cacheKey(['rust', toolStamp(rustc), args.join(' '), content]),
            async make() {
                const exe = path.join(dir, `prog${EXE_SUFFIX}`);
                const r = await runTool(rustc.file, [...args, '-o', exe, src], { cwd: path.dirname(src), env: baseEnv() });
                const problems = [];
                let last = null;
                for (const line of r.out.split(/\r?\n/)) {
                    const head = line.match(/^(error|warning)(?:\[\w+\])?: (.*)$/);
                    if (head) { last = { type: head[1], message: head[2] }; continue; }
                    const at = line.match(/^\s*--> (.+):(\d+):(\d+)$/);
                    if (at && last) { problems.push({ file: problemFile(at[1], src, path.dirname(src)), line: +at[2], col: +at[3], ...last }); last = null; }
                }
                if (r.code !== 0 || !isFile(exe)) {
                    let error = r.out.trim() || 'rustc failed';
                    if (/linker `?link\.exe`? not found/i.test(error)) {
                        error += '\n\nRust on Windows links with the Visual Studio C++ Build Tools: install them ("Desktop development with C++"), or switch to the GNU toolchain with: rustup default stable-gnu';
                    }
                    return { error, problems };
                }
                return { artifact: exe, warnings: r.out.trim(), problems };
            },
        };
    },

    async go({ src, content, tools, dir }) {
        const go = tools.go;
        return {
            key: cacheKey(['go', toolStamp(go), content]),
            async make() {
                const exe = path.join(dir, `prog${EXE_SUFFIX}`);
                // GOTOOLCHAIN=local: never download another Go because a go.mod asks for one.
                const r = await runTool(go.file, ['build', '-o', exe, src],
                    { cwd: path.dirname(src), env: { ...baseEnv(), GOTOOLCHAIN: 'local', CGO_ENABLED: '0' }, timeout: 300000 });
                const problems = collect(r.out, /^(.+\.go):(\d+):(\d+): (.*)$/, m => ({ file: problemFile(m[1], src, path.dirname(src)), line: +m[2], col: +m[3], type: 'error', message: m[4] }));
                if (r.code !== 0 || !isFile(exe)) return { error: r.out.trim() || 'go build failed', problems };
                return { artifact: exe, warnings: r.out.trim(), problems };
            },
        };
    },

    async pascal({ src, content, tools, dir }) {
        const fpc = tools.fpc;
        // -O2 like Themis and most judges, a 256 MB stack, errors and warnings shown.
        const args = ['-O2', '-XS', '-Cs268435456', '-vew'];
        return {
            key: cacheKey(['pascal', toolStamp(fpc), args.join(' '), content]),
            async make() {
                const out = shortPath(dir);
                const exe = path.join(dir, `prog${EXE_SUFFIX}`);
                fs.rmSync(exe, { force: true });
                const r = await runTool(fpc.file, [...args, `-FE${out}`, `-FU${out}`, `-o${path.join(out, `prog${EXE_SUFFIX}`)}`, shortPath(src)],
                    { cwd: shortPath(path.dirname(src)), env: baseEnv() });
                const problems = collect(r.out, /^(.+)\((\d+),(\d+)\) (Error|Fatal|Warning|Note|Hint): (.*)$/i, m => ({
                    file: problemFile(m[1], src, path.dirname(src)), line: +m[2], col: +m[3],
                    type: /warn/i.test(m[4]) ? 'warning' : /note|hint/i.test(m[4]) ? 'info' : 'error', message: m[5],
                }));
                if (r.code !== 0 || !isFile(exe)) return { error: r.out.trim() || 'fpc failed', problems };
                // fpc.cfg usually asks for the logo and progress lines; a clean build shows only warnings.
                const warnings = r.out.split(/\r?\n/).filter(l => /\) (Warning|Note|Hint):/i.test(l)).join('\n');
                return { artifact: exe, warnings, problems };
            },
        };
    },
};

/**
 * Build a source file of a language other than C/C++. The caller (executor.compile) has
 * already written the editor's text to the file.
 * @returns {Promise<{success: boolean, outputPath: string|null, error?: string, warnings?: string,
 *   problems?: Array, cached?: boolean, time: number, language: string}>}
 */
async function build(langId, { src, content, startTime = Date.now() }) {
    const done = (r) => ({ language: langId, time: Date.now() - startTime, ...r });
    const found = toolsFor(langId);
    if (found.error) return done({ success: false, outputPath: null, error: found.error });
    let dir;
    try { dir = outDirFor(src); } catch (err) { return done({ success: false, outputPath: null, error: `Could not create the build folder: ${err.message}` }); }

    const plan = await BUILDERS[langId]({ src, content: String(content ?? ''), tools: found.tools, dir });
    const last = buildCache.get(dir);
    if (last && last.key === plan.key && stampOf(last.artifact) === last.stamp) {
        return done({ success: true, outputPath: last.artifact, cached: true, warnings: last.warnings || '' });
    }
    buildCache.delete(dir);
    let result;
    try {
        result = await plan.make();
    } catch (err) {
        result = { error: err.message };
    }
    if (result.error) return done({ success: false, outputPath: null, error: result.error, problems: result.problems || [] });
    buildCache.set(dir, { key: plan.key, artifact: result.artifact, stamp: stampOf(result.artifact), warnings: result.warnings || '' });
    return done({ success: true, outputPath: result.artifact, warnings: result.warnings || '', problems: result.problems || [] });
}

// ---------------------------------------------------------------------------
// Running an artifact
// ---------------------------------------------------------------------------

const PY_ENV = { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' };

/** JVM options: a small initial heap and the memory limit as -Xmx (see the module comment). */
function jvmArgs(memoryLimit) {
    const args = ['-Xss64m', '-XX:+UseSerialGC', '-Xms8m'];
    if (memoryLimit > 0) args.push(`-Xmx${Math.max(16, Math.round(memoryLimit))}m`);
    args.push('-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8', '-Dstderr.encoding=UTF-8', '-Duser.language=en');
    return args;
}

/** Whether a path is a run.json this module wrote. */
function isRunFile(file) {
    if (path.basename(String(file || '')) !== RUN_FILE) return false;
    const root = path.join(appTempDir('cpp-ide-builds'), 'lang');
    const rel = path.relative(root, path.resolve(file));
    return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * The command that starts a built program.
 * @param {string} artifact - what compile() returned as outputPath
 * @param {{memoryLimit?: number, interactive?: boolean}} [options] interactive: a terminal run
 *   (Python unbuffered, so a prompt shows before input is read)
 * @returns {{file: string, args: string[], env: object, interpreted: boolean}}
 * @throws {Error} when the interpreter it needs cannot be found any more
 */
function runCommand(artifact, { memoryLimit = 0, interactive = false } = {}) {
    if (!isRunFile(artifact)) return { file: artifact, args: [], env: {}, interpreted: false };
    const spec = JSON.parse(fs.readFileSync(artifact, 'utf8'));
    const langOf = { python: 'python', node: 'javascript', java: 'java' };
    const langId = langOf[spec.tool];
    if (!langId) throw new Error(`Unknown program kind in ${artifact}`);
    const tool = spec.tool === 'java'
        ? (locateTool('java', { near: (toolsFor('java').tools || {}).javac?.file || '' }) || locateTool('java'))
        : locateTool(spec.tool, { override: settingsOverride(langId) });
    if (!tool) throw new Error(`${spec.tool} was not found. ${INSTALL_HINT[langId]}`);
    const args = Array.isArray(spec.args) ? spec.args.map(String) : [];
    if (spec.tool === 'python') {
        return { file: tool.file, args: [...tool.prefix, ...(interactive ? ['-u'] : []), ...args], env: PY_ENV, interpreted: true };
    }
    if (spec.tool === 'java') {
        return { file: tool.file, args: [...jvmArgs(memoryLimit), ...args], env: {}, interpreted: true };
    }
    return { file: tool.file, args: [...tool.prefix, ...args], env: {}, interpreted: true };
}

// ---------------------------------------------------------------------------
// Settings › Compiler › Other Languages
// ---------------------------------------------------------------------------

function probeVersion(tool, spec) {
    return new Promise((resolve) => {
        let out = '';
        let child;
        try {
            child = spawnTool(tool.file, [...tool.prefix, ...spec.version], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: baseEnv() });
        } catch (_) { resolve(''); return; }
        const timer = setTimeout(() => { killProcessTree(child); }, spec.timeout || 10000);
        child.stdout.on('data', d => { out += d; });
        child.stderr.on('data', d => { out += d; });
        child.on('error', () => { clearTimeout(timer); resolve(''); });
        child.on('close', () => { clearTimeout(timer); resolve(((out.match(spec.match) || [])[1]) || ''); });
    });
}

/**
 * Every language, with what was found for it.
 * @param {Object<string,string>|null} [typed] - paths typed in Settings and not saved yet, instead of the saved ones
 * @returns {Promise<Array<{id, name, exts, found: boolean, path: string, version: string, error: string, override: string}>>}
 */
async function listLanguages(typed = null) {
    registryPathCache.at = 0;   // look again: the user may have just installed something
    return Promise.all(Object.entries(LANGUAGES).map(async ([id, lang]) => {
        const override = typed && typeof typed === 'object' ? String(typed[id] || '').trim() : settingsOverride(id);
        const found = toolsFor(id, override);
        if (found.error) return { id, name: lang.name, exts: lang.exts, found: false, path: '', version: '', error: found.error, override };
        const main = found.tools[lang.tools[0]];
        const version = await probeVersion(main, TOOLS[lang.tools[0]]);
        return { id, name: lang.name, exts: lang.exts, found: true, path: main.file, version, error: '', override };
    }));
}

module.exports = {
    LANGUAGES,
    languageOfFile,
    build,
    cancelBuild,
    runCommand,
    isRunFile,
    listLanguages,
    // for tests
    locateTool,
    expandPattern,
    jvmArgs,
};
