/**
 * Sameko Dev C++ IDE - Run launcher (Windows)
 *
 * A tiny native helper that starts the user's program, waits for it, and
 * reports what the OS itself recorded: wall time, CPU time and peak working
 * set. It replaces sampling with `tasklist`, which cost ~150 ms per sample,
 * competed with the program being timed, and could not see a run shorter than
 * the sampling interval at all (so "Memory" was simply missing for most
 * competitive-programming runs, and "Time" included Node's own spawn overhead).
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

const LAUNCHER_VERSION = 1; // bump when LAUNCHER_SOURCE changes

const LAUNCHER_SOURCE = String.raw`
#define UNICODE
#define _UNICODE
#include <windows.h>
#include <psapi.h>
#include <stdio.h>
#include <string>

// usage: sameko_run.exe <stats-file> <program.exe>
int wmain(int argc, wchar_t** argv) {
    if (argc < 3) return 127;

    std::wstring cmd = L"\"";
    cmd += argv[2];
    cmd += L"\"";

    HANDLE job = CreateJobObjectW(NULL, NULL);
    if (job) {
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits;
        ZeroMemory(&limits, sizeof(limits));
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits));
    }

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
        return 126;
    }
    if (job) AssignProcessToJobObject(job, pi.hProcess);

    LARGE_INTEGER freq, t0, t1;
    QueryPerformanceFrequency(&freq);
    QueryPerformanceCounter(&t0);
    ResumeThread(pi.hThread);
    WaitForSingleObject(pi.hProcess, INFINITE);
    QueryPerformanceCounter(&t1);

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
        fprintf(f, "{\"wallMs\":%.3f,\"cpuMs\":%.3f,\"peakKB\":%llu}",
            wallMs, (double)cpu100ns / 10000.0,
            (unsigned long long)(pmc.PeakWorkingSetSize / 1024));
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

            const src = path.join(dir, `sameko_run-${tag}.cpp`);
            fs.writeFileSync(src, LAUNCHER_SOURCE, 'utf-8');
            const tmpExe = exe + '.tmp';
            const child = spawn(compilerExe,
                [src, '-o', tmpExe, '-O2', '-s', '-static', '-municode', '-w'],
                { cwd: dir, env: getCompilerEnv(), windowsHide: true });
            child.on('error', () => resolve(null));
            child.on('close', (code) => {
                try { fs.unlinkSync(src); } catch (_) { }
                if (code !== 0) { console.warn('[RunLauncher] build failed, falling back to direct runs'); return resolve(null); }
                try {
                    fs.renameSync(tmpExe, exe);
                    launcherPath = exe;
                    console.log('[RunLauncher] ready:', exe);
                    resolve(exe);
                } catch (_) { resolve(fs.existsSync(exe) ? (launcherPath = exe) : null); }
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
 * @returns {{wallMs:number, cpuMs:number, peakKB:number}|null}
 */
function readStats(file) {
    if (!file) return null;
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
        if (data && Number.isFinite(data.wallMs)) return data;
    } catch (_) { /* program was killed before the helper could write */ }
    finally { try { fs.unlinkSync(file); } catch (_) { } }
    return null;
}

module.exports = { ensureLauncher, getLauncherIfReady, newStatsFile, readStats };
