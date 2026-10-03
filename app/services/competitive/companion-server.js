/**
 * Sameko Dev C++ IDE - Competitive Companion Server
 * HTTP server to receive problems from Competitive Companion browser extension
 * @module app/services/competitive/companion-server
 */

'use strict';

const http = require('http');
const { shell } = require('electron');

let ccServer = null;

let ccServerStatus = 'stopped';

/** @type {Function|null} - Callback to send received problems to renderer */
let onProblemReceived = null;

/** @type {Function|null} - Callback to focus main window */
let onFocusWindow = null;

const { COMPETITIVE_COMPANION } = require('../../shared/constants');

const CC_PORT = COMPETITIVE_COMPANION.PORT;

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_TESTS = 200;
const MAX_TEST_CHARS = 1024 * 1024;

/**
 * Reduce an incoming payload to the fields the IDE uses, with every value
 * coerced to the expected type and bounded in size. Returns null when it does
 * not look like a Competitive Companion problem at all.
 * @param {*} raw
 * @returns {{name:string, group:string, url:string, timeLimit:number|null, memoryLimit:number|null, tests:Array<{input:string, output:string}>}|null}
 */
function sanitizeProblem(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string' || !raw.name.trim()) return null;
    const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
    const num = (v) => (Number.isFinite(v) && v > 0 ? v : null);
    const tests = (Array.isArray(raw.tests) ? raw.tests : [])
        .slice(0, MAX_TESTS)
        .filter((t) => t && typeof t === 'object')
        .map((t) => ({ input: text(t.input, MAX_TEST_CHARS), output: text(t.output, MAX_TEST_CHARS) }));
    return {
        name: text(raw.name, 200),
        group: text(raw.group, 200),
        url: text(raw.url, 2000),
        timeLimit: num(raw.timeLimit),
        memoryLimit: num(raw.memoryLimit),
        tests
    };
}

function setOnProblemReceived(callback) {
    onProblemReceived = callback;
}

function setOnFocusWindow(callback) {
    onFocusWindow = callback;
}

function startServer() {
    if (ccServer) {
        console.log('[CC] Server already running');
        return Promise.resolve({ success: true, status: 'already_running' });
    }

    return new Promise((resolve) => {
        ccServerStatus = 'starting';

        ccServer = http.createServer((req, res) => {
            if (req.method === 'POST') {
                // The extension posts from its background page, whose Origin is
                // `chrome-extension://…` / `moz-extension://…` (or absent). A
                // request carrying a web origin comes from a page in the
                // browser — any site can reach 127.0.0.1 — and is refused.
                const origin = String(req.headers.origin || '');
                if (/^https?:\/\//i.test(origin)) {
                    res.writeHead(403);
                    res.end('Forbidden');
                    return;
                }

                const chunks = [];
                let received = 0;
                let rejected = false;

                req.on('data', chunk => {
                    if (rejected) return;
                    received += chunk.length;
                    if (received > MAX_BODY_BYTES) {
                        rejected = true;
                        res.writeHead(413);
                        res.end('Payload Too Large');
                        req.destroy();
                        return;
                    }
                    chunks.push(chunk);
                });

                req.on('end', () => {
                    if (rejected) return;
                    try {
                        const problem = sanitizeProblem(JSON.parse(Buffer.concat(chunks).toString('utf8')));
                        if (!problem) {
                            res.writeHead(400);
                            res.end('Invalid Problem');
                            return;
                        }
                        console.log(`[CC] Received problem: ${problem.name}`);

                        // Notify renderer
                        if (onProblemReceived) {
                            onProblemReceived(problem);
                        }

                        // Focus window
                        if (onFocusWindow) {
                            onFocusWindow();
                        }

                        res.writeHead(200);
                        res.end('OK');
                    } catch (e) {
                        console.error('[CC] Parse error:', e.message);
                        res.writeHead(400);
                        res.end('Parse Error');
                    }
                });
            } else {
                res.writeHead(405);
                res.end('Method Not Allowed');
            }
        });

        ccServer.on('error', (err) => {
            console.error('[CC] Server error:', err.message);
            ccServerStatus = 'error';
            ccServer = null;
            resolve({ success: false, error: err.message });
        });

        ccServer.listen(CC_PORT, COMPETITIVE_COMPANION.LISTEN_ADDRESS, () => {
            console.log(`[CC] Competitive Companion server listening on port ${CC_PORT}`);
            ccServerStatus = 'running';
            resolve({ success: true, status: 'running' });
        });
    });
}

function stopServer() {
    if (ccServer) {
        ccServer.close();
        ccServer = null;
        ccServerStatus = 'stopped';
        console.log('[CC] Server stopped');
    }
    return { success: true, status: 'stopped' };
}

function getStatus() {
    return {
        status: ccServerStatus,
        running: ccServer !== null,
        port: CC_PORT
    };
}

/**
 * Open Competitive Companion extension page in browser
 */
function openExtensionPage() {
    shell.openExternal('https://chromewebstore.google.com/detail/competitive-companion/cjnmckjndlpiamhfimnnjmnckgghkjbl');
    return { success: true };
}

module.exports = {
    startServer,
    stopServer,
    getStatus,
    openExtensionPage,
    setOnProblemReceived,
    setOnFocusWindow,
    CC_PORT,
};
