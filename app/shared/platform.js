/**
 * Sameko Dev C++ IDE - Platform abstraction (MAIN PROCESS ONLY)
 * Tập trung mọi khác biệt Windows / Linux / macOS về một chỗ.
 * KHÔNG import ở renderer (src/) và KHÔNG import ở app/shared/constants.js
 * (constants.js được cả main lẫn renderer load).
 * @module app/shared/platform
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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
        return [
            '/opt/homebrew/bin/g++',   // Apple Silicon Homebrew
            '/usr/local/bin/g++',      // Intel Homebrew
            '/usr/bin/g++',
        ];
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
    return ['/usr/bin', '/usr/local/bin', '/opt/homebrew/bin', '/bin'];
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
 * mkdir -p với quyền chặt trên POSIX.
 * Trên Linux `app.getPath('temp')` là `/tmp` **dùng chung cho mọi user**, nên thư mục do app
 * tạo ở đó nên là 0o700 để tránh va chạm/ghi đè giữa các user trên cùng máy.
 * Trên Windows `mode` bị bỏ qua ⇒ hành vi không đổi.
 * @param {string} dir
 */
function ensurePrivateDir(dir) {
    fs.mkdirSync(dir, { recursive: true, mode: IS_WIN ? undefined : 0o700 });
}

module.exports = {
    IS_WIN,
    IS_MAC,
    IS_LINUX,
    EXE_SUFFIX,
    NULL_DEVICE,
    binName,
    systemCompilerPaths,
    systemBinDirs,
    which,
    commandExists,
    readProcMemoryKB,
    killPosixTree,
    ensurePrivateDir,
};
