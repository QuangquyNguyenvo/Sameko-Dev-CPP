/**
 * Sameko Dev C++ IDE - Platform abstraction (MAIN PROCESS ONLY)
 * Tập trung mọi khác biệt Windows / Linux / macOS về một chỗ.
 * KHÔNG import ở renderer (src/) và KHÔNG import ở app/shared/constants.js
 * (constants.js được cả main lẫn renderer load).
 * @module app/shared/platform
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execFile } = require('child_process');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const IS_LINUX = process.platform === 'linux';

/** Đuôi file thực thi cho toolchain binary & output biên dịch. */
const EXE_SUFFIX = IS_WIN ? '.exe' : '';

/**
 * Thiết bị "vứt output". Dùng cho cả `g++ -o <null>` (warmup) và
 * `g++ -E ... <null>` (clangd include-path probe).
 * LƯU Ý: trên Windows code cũ dùng cả 'NUL' (warmup.js) lẫn 'nul' (clangd-service.js).
 * Cả hai đều hợp lệ trên Windows; hằng này thống nhất về 'NUL'.
 */
const NULL_DEVICE = IS_WIN ? 'NUL' : '/dev/null';

/**
 * Gắn đuôi executable đúng nền tảng cho 1 tên binary.
 * binName('g++')    -> 'g++.exe'    (win) | 'g++'    (linux/mac)
 * binName('ld.lld') -> 'ld.lld.exe' (win) | 'ld.lld' (linux/mac)
 * @param {string} base
 * @returns {string}
 */
function binName(base) {
    return base + EXE_SUFFIX;
}

/**
 * Các đường dẫn g++ hệ thống mặc định theo OS (dùng khi không có bundled toolchain).
 * QUAN TRỌNG: phải trả về **đường dẫn tuyệt đối** — detector cần absolute path để
 * `getCompilerBinDir()` không trả về chuỗi rỗng (nếu rỗng, clangd sẽ không tìm ra
 * `clangd` cùng bin dir và IntelliSense tắt hoàn toàn). Xem Phase 2.
 * @returns {string[]}
 */
function systemCompilerPaths() {
    if (IS_WIN) {
        return [
            'C:\\TDM-GCC-64\\bin\\g++.exe',
            'C:\\TDM-GCC-32\\bin\\g++.exe',
            'C:\\MinGW\\bin\\g++.exe',
            'C:\\MinGW64\\bin\\g++.exe',
            'C:\\msys64\\mingw64\\bin\\g++.exe',
            'C:\\msys64\\mingw32\\bin\\g++.exe',
        ];
    }
    if (IS_MAC) {
        // Homebrew installs GCC as g++-<major>; /usr/bin/g++ is Apple Clang, which has no
        // <bits/stdc++.h>, so it is only the last resort.
        const homebrew = [];
        for (const dir of homebrewBinDirs()) {
            let names = [];
            try { names = fs.readdirSync(dir); } catch (_) { /* no Homebrew here */ }
            const versioned = names
                .filter((name) => /^g\+\+-\d+$/.test(name))
                .sort((a, b) => Number(b.slice(4)) - Number(a.slice(4)));
            homebrew.push(...versioned.map((name) => path.join(dir, name)), path.join(dir, 'g++'));
        }
        return [...homebrew, '/usr/bin/g++'];
    }
    // Linux
    return [
        '/usr/bin/g++',
        '/usr/local/bin/g++',
        '/bin/g++',
    ];
}

/**
 * Các thư mục bin hệ thống để dò công cụ phụ (astyle, clangd, gdb) trên POSIX.
 * @returns {string[]}
 */
function systemBinDirs() {
    if (IS_WIN) return [];
    const dirs = ['/usr/bin', '/usr/local/bin', '/opt/homebrew/bin', '/bin'];
    if (IS_MAC) for (const dir of homebrewBinDirs()) if (!dirs.includes(dir)) dirs.push(dir);
    return dirs;
}

const DEFAULT_BREW_DIRS = ['/opt/homebrew/bin', '/usr/local/bin'];
let customBrewDir = null;
let lastBrewAsk = 0;

/**
 * Folders where Homebrew puts its programs: the two default prefixes, plus the one of a
 * Homebrew installed elsewhere (issue #58). An app opened from Finder does not get the shell's
 * PATH, so that prefix comes from $HOMEBREW_PREFIX or, failing that, from asking the user's login
 * shell where `brew` is. The shell is asked only when no default prefix has `brew`, at most every
 * 30 seconds until it answers, and the answer is kept and added to PATH.
 * @returns {string[]}
 */
function homebrewBinDirs() {
    if (!IS_MAC) return [];
    if (customBrewDir) return [...DEFAULT_BREW_DIRS, customBrewDir];
    if (DEFAULT_BREW_DIRS.some((dir) => fs.existsSync(path.join(dir, 'brew')))) return DEFAULT_BREW_DIRS;
    let dir = process.env.HOMEBREW_PREFIX ? path.join(process.env.HOMEBREW_PREFIX, 'bin') : null;
    if (!dir && Date.now() - lastBrewAsk >= 30000) {
        lastBrewAsk = Date.now();
        try {
            const out = execFileSync(process.env.SHELL || '/bin/zsh', ['-lc', 'command -v brew'], {
                encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'],
            });
            const brew = out.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('/') && l.endsWith('/brew')).pop();
            // Not resolved through links: g++-N sits next to the `brew` the shell runs.
            if (brew) dir = path.dirname(brew);
        } catch (_) { /* no shell answer: Homebrew is not installed */ }
    }
    if (!dir || DEFAULT_BREW_DIRS.includes(dir) || !fs.existsSync(dir)) return DEFAULT_BREW_DIRS;
    customBrewDir = dir;
    const parts = String(process.env.PATH || '').split(':');
    if (!parts.includes(dir)) process.env.PATH = [dir, ...parts.filter(Boolean)].join(':');
    console.log(`[Platform] Homebrew found at ${path.dirname(dir)}`);
    return [...DEFAULT_BREW_DIRS, customBrewDir];
}

/**
 * Tìm 1 executable trong PATH, trả về đường dẫn tuyệt đối hoặc null.
 * Dùng `where` (Windows) / `command -v` qua /bin/sh (POSIX).
 * Đồng bộ (sync) — chỉ gọi ở lúc khởi tạo/dò tìm, KHÔNG gọi trong vòng lặp nóng.
 * @param {string} bin  tên binary KHÔNG kèm đuôi (vd 'g++', 'gnome-terminal')
 * @returns {string|null}
 */
function which(bin) {
    try {
        if (IS_WIN) {
            const out = execFileSync('where', [binName(bin)], {
                encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000,
            });
            const first = String(out).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
            return first || null;
        }
        const out = execFileSync('/bin/sh', ['-c', `command -v ${JSON.stringify(bin)}`], {
            encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000,
        });
        const p = String(out).trim();
        return p || null;
    } catch (_) {
        return null;
    }
}

/** `which()` nhưng chỉ trả boolean. */
function commandExists(bin) {
    return which(bin) !== null;
}

/**
 * Đọc memory của 1 pid trên Linux qua /proc/<pid>/status.
 *
 * MẶC ĐỊNH đọc **VmHWM** = "high water mark" = **đỉnh RSS thực sự** mà kernel ghi lại
 * trong suốt đời tiến trình. Nhờ vậy chỉ cần đọc được MỘT lần bất kỳ (dù muộn) là đã có
 * peak đúng — khác VmRSS (giá trị tức thời) vốn gần như luôn trượt đỉnh khi poll 500ms
 * với chương trình competitive-programming chạy <100ms.
 *
 * Trả 0 nếu không đọc được (tiến trình đã thoát, hoặc không phải Linux).
 * @param {number} pid
 * @param {boolean} [instantaneous=false] true: đọc VmRSS (tức thời) thay vì VmHWM (đỉnh)
 * @returns {number} KB
 */
function readProcMemoryKB(pid, instantaneous = false) {
    if (!IS_LINUX || !pid) return 0;
    try {
        const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
        const key = instantaneous ? 'VmRSS' : 'VmHWM';
        const m = status.match(new RegExp(`^${key}:\\s*(\\d+)\\s*kB`, 'm'));
        return m ? parseInt(m[1], 10) : 0;
    } catch (_) {
        return 0;
    }
}

/**
 * Kill 1 tiến trình theo cách "mạnh nhất có thể" cho nền tảng hiện tại, an toàn với lỗi.
 * - POSIX: thử kill cả process group (`-pid`) trước, rồi kill pid.
 *   Kill group chỉ thành công nếu tiến trình được spawn với `detached: true`;
 *   thất bại là bình thường và bị bỏ qua.
 * - Windows: KHÔNG làm gì (caller tự dùng taskkill như code cũ).
 * @param {number} pid
 */
function killPosixTree(pid) {
    if (IS_WIN || !pid) return;
    try { process.kill(-pid, 'SIGKILL'); } catch (_) { /* không phải group leader */ }
    try { process.kill(pid, 'SIGKILL'); } catch (_) { /* đã thoát */ }
}

/**
 * Stop a process we spawned and everything it started, by PID while we still
 * hold its handle (so the PID cannot have been reused).
 * - Windows: `taskkill /T` on the PID (never by image name), then the handle.
 * - POSIX: the process group (spawned with `detached: true`), else the process.
 * @param {import('child_process').ChildProcess} child
 */
function killProcessTree(child) {
    const pid = child && child.pid;
    if (!pid) return;
    if (IS_WIN) {
        if (child.exitCode === null && child.signalCode === null) {
            execFile('taskkill', ['/pid', String(pid), '/f', '/t'], { windowsHide: true }, () => { });
        }
        try { child.kill(); } catch (_) { }
        return;
    }
    killPosixTree(pid);
}

/**
 * mkdir -p với quyền chặt trên POSIX.
 * Trên Linux `app.getPath('temp')` là `/tmp` **dùng chung cho mọi user**, nên thư mục do app
 * tạo ở đó nên là 0o700 để tránh va chạm/ghi đè giữa các user trên cùng máy.
 * Trên Windows `mode` bị bỏ qua ⇒ hành vi không đổi.
 * @param {string} dir
 */
function ensurePrivateDir(dir) {
    fs.mkdirSync(dir, { recursive: true, mode: IS_WIN ? undefined : 0o700 });
}

/**
 * Thư mục tạm của app, tách riêng theo user trên POSIX.
 * `/tmp` dùng chung cho mọi user, nên một tên cố định như `/tmp/cpp-ide-pch`
 * thuộc về user nào chạy app trước; user thứ hai chỉ nhận EACCES (gặp thật khi
 * chạy bản .deb sau khi root đã chạy một lần). `%TEMP%` trên Windows vốn đã
 * riêng từng user nên giữ nguyên tên, không đổi đường dẫn của bản Windows.
 * @param {string} name
 * @returns {string}
 */
function appTempDir(name) {
    const suffix = IS_WIN ? '' : `-${process.getuid()}`;
    return path.join(os.tmpdir(), name + suffix);
}

/**
 * An app opened from Finder gets only the system folders on PATH, so Homebrew's tools (Go, Rust,
 * Node, a JDK...) would not be found. Adds the usual folders that exist, ahead of /usr/bin (whose
 * `java` is a stub when no JDK is installed) but behind anything the user's shell already set.
 * @returns {string} the new PATH
 */
function macToolPath(current, home, exists = fs.existsSync) {
    const dirs = String(current || '').split(':').filter(Boolean);
    const extra = [
        '/opt/homebrew/opt/openjdk/bin',
        '/opt/homebrew/bin',
        '/opt/homebrew/sbin',
        '/usr/local/bin',
        '/usr/local/go/bin',
        '/Library/Frameworks/Python.framework/Versions/Current/bin',
        ...(home ? [path.join(home, '.cargo', 'bin'), path.join(home, 'go', 'bin')] : []),
    ].filter((dir) => !dirs.includes(dir) && exists(dir));
    const system = dirs.findIndex((dir) => ['/usr/bin', '/bin', '/usr/sbin', '/sbin'].includes(dir));
    const at = system === -1 ? dirs.length : system;
    return [...dirs.slice(0, at), ...extra, ...dirs.slice(at)].join(':');
}

/** The error for a program the system would not start; only Windows has an antivirus to name. */
function blockedStartMessage(dir) {
    return IS_WIN
        ? `Windows or an antivirus blocked the program from starting. Add this folder to its exclusions: ${dir}`
        : `The system refused to start the program. Make sure this folder allows running programs: ${dir}`;
}

module.exports = {
    blockedStartMessage,
    macToolPath,
    IS_WIN,
    IS_MAC,
    IS_LINUX,
    EXE_SUFFIX,
    NULL_DEVICE,
    binName,
    systemCompilerPaths,
    systemBinDirs,
    homebrewBinDirs,
    which,
    commandExists,
    readProcMemoryKB,
    killPosixTree,
    killProcessTree,
    ensurePrivateDir,
    appTempDir,
};
