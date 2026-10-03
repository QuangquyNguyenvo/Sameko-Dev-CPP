/**
 * Sameko Dev C++ IDE - Compiler Services Index
 * Re-exports all compiler service modules
 * @module app/services/compiler
 */

'use strict';

const detector = require('./detector');
const warmup = require('./warmup');
const pchManager = require('./pch-manager');
const executor = require('./executor');

const runLauncher = require('./run-launcher');

module.exports = {
    ensureRunLauncher: runLauncher.ensureLauncher,
    // Detector
    detectCompiler: detector.detectCompiler,
    getCompilerVersion: detector.getCompilerVersion,
    getDetectedCompiler: detector.getDetectedCompiler,
    getCompilerInfo: detector.getCompilerInfo,
    getCompilerBinDir: detector.getCompilerBinDir,
    getCompilerEnv: detector.getCompilerEnv,
    getBasePath: detector.getBasePath,
    getResourcesPath: detector.getResourcesPath,

    // Warmup
    performCompilerWarmup: warmup.performCompilerWarmup,
    quickWarmup: warmup.quickWarmup,

    // PCH Manager
    ensurePCH: pchManager.ensurePCH,
    getPCHKey: pchManager.getPCHKey,
    cleanPCHCache: pchManager.cleanPCHCache,
    getPCHDir: pchManager.getPCHDir,

    // Executor
    compile: executor.compile,
    run: executor.run,
    runExternal: executor.runExternal,
    sendInput: executor.sendInput,
    stopProcess: executor.stopProcess,
    isProcessRunning: executor.isProcessRunning,
    getRunningProcess: executor.getRunningProcess,
    setFileWatcherCallback: executor.setFileWatcherCallback,
    setSendToRendererCallback: executor.setSendToRendererCallback,
};
