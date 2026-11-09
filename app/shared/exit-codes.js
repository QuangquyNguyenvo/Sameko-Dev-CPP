'use strict';

/**
 * What a crashed program's exit status means, in words a student can act on.
 *
 * Windows reports a crash as an NTSTATUS exit code, which Node gives unsigned
 * (0xC00000FD arrives as 3221225725); POSIX kills the process with a signal. The codes
 * below are the ones C++ programs built by the bundled GCC (UCRT) actually end with,
 * checked one by one: abort(), a failed assert(), an uncaught exception (vector::at,
 * bad_alloc) and a -D_GLIBCXX_DEBUG check all end with 0xC0000409.
 *
 * The strings are English; the renderer translates them (keys in src/renderer/locales).
 */

const WINDOWS = {
    0xC0000005: {
        name: 'Access violation (invalid memory access)',
        hint: 'Usually an index outside an array or vector, or a null or dangling pointer. Add -D_GLIBCXX_DEBUG to Additional Compile Flags (Settings › Compiler) to get the exact line for vector and string indexes.',
    },
    0xC00000FD: {
        name: 'Stack overflow',
        hint: 'Recursion too deep (a DFS on a long path) or a large array declared inside a function. Turn on Large Stack (256 MB) in Settings › Compiler, or make big arrays global.',
    },
    0xC0000094: {
        name: 'Division by zero',
        hint: 'An integer / or % by 0.',
    },
    0xC0000095: {
        name: 'Integer overflow in division',
        hint: 'INT_MIN / -1 (or LLONG_MIN / -1) does not fit in the type.',
    },
    0xC0000409: {
        name: 'Program aborted',
        hint: 'abort(), a failed assert(), or an exception nobody caught (out_of_range from .at(), bad_alloc when memory runs out). The reason is in the Stderr output.',
    },
    0xC0000374: {
        name: 'Heap corruption',
        hint: 'Writing past the end of a new[]/vector buffer, or deleting the same memory twice.',
    },
    0xC000001D: {
        name: 'Illegal instruction',
        hint: 'Undefined behaviour stopped by a trap, or a function that must return a value reached its end without return.',
    },
    0xC0000017: {
        name: 'Out of memory',
        hint: 'The program asked for more memory than Windows could give, often a huge global array.',
    },
    0xC0000135: {
        name: 'A DLL the program needs was not found',
        hint: 'Run it from the IDE, or build with -static to make an .exe that runs anywhere.',
    },
    0xC000013A: {
        name: 'Stopped with Ctrl+C',
        hint: '',
    },
};

const SIGNALS = {
    SIGSEGV: { name: 'Segmentation fault', hint: 'An index outside an array or vector, a null pointer, or a stack overflow from deep recursion.' },
    SIGFPE: { name: 'Division by zero', hint: 'An integer / or % by 0.' },
    SIGABRT: { name: 'Program aborted', hint: 'abort(), a failed assert(), or an exception nobody caught. The reason is in the Stderr output.' },
    SIGILL: { name: 'Illegal instruction', hint: 'Undefined behaviour stopped by a trap, or a function that must return a value reached its end without return.' },
    SIGBUS: { name: 'Bus error', hint: 'A misaligned or invalid memory access.' },
    SIGKILL: { name: 'Killed', hint: 'Stopped from outside, often for using too much memory.' },
};

/**
 * @param {number|null} code - exit code as Node reports it (unsigned on Windows)
 * @param {string|null} [signal] - POSIX signal name, when the process was killed by one
 * @returns {{ hex: string, name: string, hint: string } | null} null for a normal exit or
 *   an exit code the program chose itself (return 1, exit(2)…)
 */
function describeExit(code, signal) {
    if (signal && SIGNALS[signal]) return { hex: signal, ...SIGNALS[signal] };
    if (typeof code !== 'number' || !Number.isFinite(code)) return null;
    const status = code >>> 0;   // a signed -1073741819 is the same status as 3221225477
    const known = WINDOWS[status];
    if (!known) return null;
    return { hex: '0x' + status.toString(16).toUpperCase(), ...known };
}

/**
 * Why Windows would not start a freshly built program: the GetLastError() of CreateProcess,
 * recorded by the run launcher (run-launcher.js). Antivirus and application-control blocks
 * are the usual cause of "Build OK, but the program does not run".
 * @param {number} winError
 * @returns {string}
 */
function describeStartError(winError) {
    switch (winError) {
        case 2: case 3:
            return 'The program file is gone: it was removed after it was built, most likely quarantined by an antivirus.';
        case 5:
            return 'Windows refused to start the program (access denied), usually because an antivirus blocked it.';
        case 32:
            return 'The program file is still in use, usually by an antivirus scanning it. Run it again in a moment.';
        case 193: case 216:
            return 'The built file is not a valid Windows program. Build it again.';
        case 225: case 226:
            return 'An antivirus flagged the program and blocked it. Add the build folder to its exclusions.';
        case 1260:
            return 'A Windows policy blocks programs in this folder (common on school and office computers).';
        case 4551:
            return 'Smart App Control or an application control policy blocked the program. It blocks unsigned programs, including the ones you compile.';
        default:
            return 'Windows could not start the program.';
    }
}

module.exports = { describeExit, describeStartError };
