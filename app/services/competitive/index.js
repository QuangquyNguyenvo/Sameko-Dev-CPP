'use strict';

const companionServer = require('./companion-server');
const batchTester = require('./batch-tester');

module.exports = {
    // Companion Server
    startServer: companionServer.startServer,
    stopServer: companionServer.stopServer,
    getServerStatus: companionServer.getStatus,
    openExtensionPage: companionServer.openExtensionPage,
    setOnProblemReceived: companionServer.setOnProblemReceived,
    setOnFocusWindow: companionServer.setOnFocusWindow,
    // Sameko Companion extension (/sameko/v1/*, extension-bridge.js)
    configureBridge: companionServer.configureBridge,
    getBridge: companionServer.getBridge,
    CC_PORT: companionServer.CC_PORT,

    // Batch Tester
    runTest: batchTester.runTest,
    runBatchTests: batchTester.runBatchTests,
    normalizeOutput: batchTester.normalizeOutput,
};
