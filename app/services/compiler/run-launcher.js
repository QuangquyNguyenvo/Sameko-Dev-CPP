/**
 * Sameko Dev C++ IDE - Run launcher (Windows)
 *
 * A tiny native helper that starts the user's program, waits for it, and
 * reports what the OS itself recorded: wall time, CPU time and peak memory.
 *
 * Peak memory is the peak commit (PeakPagefileUsage): memory the program asked for, touched or
 * not. Judges count it that way, so a 400 MB global array of which ten elements are used is
 * 400 MB here as on Codeforces; the working set (pages touched, ~10 MB for that program) is
 * written too, as wsKB. With a time limit the helper stops the program itself, so the limit is
 * counted from the program's start, not from Node's spawn (an antivirus scan included). With a
 * memory limit the job refuses allocations past it, and the run is reported as over the limit.
 *
 * It replaces sampling with `tasklist`, which cost ~150 ms per sample, competed with the program
 * being timed, and could not see a run shorter than the sampling interval at all (so "Memory" was
 * simply missing for most competitive-programming runs, and "Time" included Node's own spawn
 * overhead).
 *
 * The helper is compiled once with the detected g++ into an app-owned temp
 * directory and reused until the compiler changes. The child inherits the
 * launcher's stdin/stdout/stderr, so piping and realtime output are unchanged,
 * and it runs in a kill-on-close job: killing the launcher kills the program.
 *
 * Everything here is best-effort — if the helper cannot be built, callers fall
 * back to running the program directly.
 *
 * @module app/services/compiler/run-launcher
 */

'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { getDetectedCompiler, getCompilerEnv } = require('./detector');
const { IS_WIN, ensurePrivateDir, appTempDir } = require('../../shared/platform');

const LAUNCHER_VERSION = 6; // bump when LAUNCHER_SOURCE changes

const LAUNCHER_SOURCE = String.raw`
#define UNICODE
#define _UNICODE
#include <windows.h>
#include <psapi.h>
#include <stdio.h>
#include <string>

// One argument, quoted when needed so CommandLineToArgvW / the CRT give it back unchanged.
static void appendArg(std::wstring& cmd, const wchar_t* arg) {
    std::wstring a(arg);
    cmd += L' ';
    if (!a.empty() && a.find_first_of(L" \t\n\v\"") == std::wstring::npos) { cmd += a; return; }
    cmd += L'"';
    for (size_t i = 0; ; ++i) {
        size_t slashes = 0;
        while (i < a.size() && a[i] == L'\\') { ++i; ++slashes; }
        if (i == a.size()) { cmd.append(slashes * 2, L'\\'); break; }
        if (a[i] == L'"') { cmd.append(slashes * 2 + 1, L'\\'); cmd += L'"'; }
        else { cmd.append(slashes, L'\\'); cmd += a[i]; }
    }
    cmd += L'"';
}

// usage: sameko_run.exe <stats-file> <program.exe> [time-limit-ms] [memory-limit-mb] [program args...]
int wmain(int argc, wchar_t** argv) {
    if (argc < 3) return 127;
    DWORD timeLimit = argc > 3 ? (DWORD)_wtoi(argv[3]) : 0;
    unsigned long long memLimitMB = argc > 4 ? (unsigned long long)_wtoi64(argv[4]) : 0;

    std::wstring cmd = L"\"";
    cmd += argv[2];
    cmd += L"\"";
    // Arguments for the program itself: an interpreter's script (python a.py, java -cp dir Main)
    // and a stress-test generator's seed. Quoted by the C runtime's rules, so any path survives.
    for (int i = 5; i < argc; i++) appendArg(cmd, argv[i]);

    HANDLE job = CreateJobObjectW(NULL, NULL);
    if (job) {
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits;
        ZeroMemory(&limits, sizeof(limits));
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if (memLimitMB) {
            limits.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_JOB_MEMORY;
            limits.JobMemoryLimit = (SIZE_T)(memLimitMB * 1024ULL * 1024ULL);
        }
        SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits));
    }
    // The job posts a message here when an allocation hits the memory limit.
    HANDLE port = NULL;
    if (job && memLimitMB) {
        port = CreateIoCompletionPort(INVALID_HANDLE_VALUE, NULL, 0, 1);
        if (port) {
            JOBOBJECT_ASSOCIATE_COMPLETION_PORT assoc;
            assoc.CompletionKey = job;
            assoc.CompletionPort = port;
            SetInformationJobObject(job, JobObjectAssociateCompletionPortInformation, &assoc, sizeof(assoc));
        }
    }

    // Inherited by the program: a crash (abort() after bad_alloc, an access violation) exits at
    // once instead of waiting seconds for Windows Error Reporting, which ran into the time limit.
    SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX | SEM_NOOPENFILEERRORBOX);

    STARTUPINFOW si;
    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESTDHANDLES;
    si.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
    si.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
    si.hStdError = GetStdHandle(STD_ERROR_HANDLE);

    PROCESS_INFORMATION pi;
    ZeroMemory(&pi, sizeof(pi));
    if (!CreateProcessW(argv[2], &cmd[0], NULL, NULL, TRUE, CREATE_SUSPENDED, NULL, NULL, &si, &pi)) {
        // Say why: 225/226 = antivirus, 5 = access denied, 2 = the file vanished (quarantined)...
        DWORD err = GetLastError();
        FILE* ef = _wfopen(argv[1], L"w");
        if (ef) {
            fprintf(ef, "{\"startError\":%lu}", (unsigned long)err);
            fclose(ef);
        }
        return 126;
    }
    if (job) AssignProcessToJobObject(job, pi.hProcess);

    LARGE_INTEGER freq, t0, t1;
    QueryPerformanceFrequency(&freq);
    QueryPerformanceCounter(&t0);
    ResumeThread(pi.hThread);
    int timedOut = 0;
    if (WaitForSingleObject(pi.hProcess, timeLimit ? timeLimit : INFINITE) == WAIT_TIMEOUT) {
        timedOut = 1;
        if (job) TerminateJobObject(job, 1); else TerminateProcess(pi.hProcess, 1);
        WaitForSingleObject(pi.hProcess, 5000);
    }
    QueryPerformanceCounter(&t1);

    int memLimitHit = 0;
    if (port) {
        DWORD msg; ULONG_PTR key; LPOVERLAPPED ov;
        while (GetQueuedCompletionStatus(port, &msg, &key, &ov, 0)) {
            if (msg == JOB_OBJECT_MSG_JOB_MEMORY_LIMIT || msg == JOB_OBJECT_MSG_PROCESS_MEMORY_LIMIT) memLimitHit = 1;
        }
    }

    DWORD code = 0;
    GetExitCodeProcess(pi.hProcess, &code);

    PROCESS_MEMORY_COUNTERS pmc;
    ZeroMemory(&pmc, sizeof(pmc));
    pmc.cb = sizeof(pmc);
    K32GetProcessMemoryInfo(pi.hProcess, &pmc, sizeof(pmc));

    FILETIME created, exited, kernel, user;
    unsigned long long cpu100ns = 0;
    if (GetProcessTimes(pi.hProcess, &created, &exited, &kernel, &user)) {
        ULARGE_INTEGER k, u;
        k.LowPart = kernel.dwLowDateTime; k.HighPart = kernel.dwHighDateTime;
        u.LowPart = user.dwLowDateTime;   u.HighPart = user.dwHighDateTime;
        cpu100ns = k.QuadPart + u.QuadPart;
    }

    double wallMs = (double)(t1.QuadPart - t0.QuadPart) * 1000.0 / (double)freq.QuadPart;
    FILE* f = _wfopen(argv[1], L"w");
    if (f) {
        fprintf(f, "{\"wallMs\":%.3f,\"cpuMs\":%.3f,\"peakKB\":%llu,\"wsKB\":%llu,\"timedOut\":%d,\"memLimitHit\":%d}",
            wallMs, (double)cpu100ns / 10000.0,
            (unsigned long long)(pmc.PeakPagefileUsage / 1024),
            (unsigned long long)(pmc.PeakWorkingSetSize / 1024), timedOut, memLimitHit);
        fclose(f);
    }

    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    return (int)code;
}
`;

let launcherPath = null;      // set once the helper exists on disk
let buildPromise = null;
let statsSeq = 0;

function toolsDir() {
    return appTempDir('cpp-ide-tools');
}

/**
 * Build the helper if needed. Safe to call repeatedly; resolves with the
 * path, or null when unavailable (not Windows, no compiler, build failed).
 * @returns {Promise<string|null>}
 */
function ensureLauncher() {
    if (!IS_WIN) return Promise.resolve(null);
    if (launcherPath) return Promise.resolve(launcherPath);
    if (buildPromise) return buildPromise;

    buildPromise = new Promise((resolve) => {
        try {
            const compilerExe = getDetectedCompiler();
            if (!compilerExe || !path.isAbsolute(compilerExe)) return resolve(null);

            let stamp = '';
            try { const st = fs.statSync(compilerExe); stamp = `${st.size}:${Math.round(st.mtimeMs)}`; } catch (_) { }
            const tag = crypto.createHash('sha1')
                .update(`${LAUNCHER_VERSION}|${compilerExe}|${stamp}`).digest('hex').slice(0, 10);

            const dir = toolsDir();
            if (!fs.existsSync(dir)) ensurePrivateDir(dir);
            const exe = path.join(dir, `sameko_run-${tag}.exe`);
            if (fs.existsSync(exe)) { launcherPath = exe; return resolve(exe); }

            // Unique per process: another app instance may build the same tag at once.
            const unique = `${process.pid}-${Date.now().toString(36)}`;
            const src = path.join(dir, `sameko_run-${tag}.${unique}.cpp`);
            fs.writeFileSync(src, LAUNCHER_SOURCE, 'utf-8');
            const tmpExe = `${exe}.${unique}.tmp`;
            const dropTmp = () => { try { fs.unlinkSync(tmpExe); } catch (_) { } };
            const child = spawn(compilerExe,
                [src, '-o', tmpExe, '-O2', '-s', '-static', '-municode', '-w'],
                { cwd: dir, env: getCompilerEnv(), windowsHide: true });
            child.on('error', () => { try { fs.unlinkSync(src); } catch (_) { } dropTmp(); resolve(null); });
            child.on('close', (code) => {
                try { fs.unlinkSync(src); } catch (_) { }
                if (code !== 0) { dropTmp(); console.warn('[RunLauncher] build failed, falling back to direct runs'); return resolve(null); }
                try {
                    fs.renameSync(tmpExe, exe);
                    launcherPath = exe;
                    console.log('[RunLauncher] ready:', exe);
                    resolve(exe);
                } catch (_) { dropTmp(); resolve(fs.existsSync(exe) ? (launcherPath = exe) : null); }
            });
        } catch (_) {
            resolve(null);
        }
    });
    buildPromise.then((p) => { if (!p) buildPromise = null; });
    return buildPromise;
}

/** The helper path if it is already built, else null (never blocks). */
function getLauncherIfReady() {
    if (!launcherPath && IS_WIN) ensureLauncher(); // kick off for next time
    return launcherPath;
}

/** A fresh path for one run's stats file. */
function newStatsFile() {
    const dir = toolsDir();
    return path.join(dir, `run-${process.pid}-${Date.now()}-${++statsSeq}.json`);
}

/**
 * Read and delete a stats file.
 * @param {string} file
 * @returns {{wallMs:number, cpuMs:number, peakKB:number, wsKB:number, timedOut:number, memLimitHit:number}|{startError:number}|null}
 *   peakKB: peak commit; timedOut / memLimitHit: 1 when a limit given to the helper stopped the
 *   program. startError:
 *   the program never started; CreateProcess failed with this Windows error code
 */
function readStats(file) {
    if (!file) return null;
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
        if (data && (Number.isFinite(data.wallMs) || Number.isFinite(data.startError))) return data;
    } catch (_) { /* program was killed before the helper could write */ }
    finally { try { fs.unlinkSync(file); } catch (_) { } }
    return null;
}

module.exports = { ensureLauncher, getLauncherIfReady, newStatsFile, readStats };
