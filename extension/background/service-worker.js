/*
 * Service worker: wires the bridge (app connection) to the jobs (tabs, submit/fetch state
 * machines) and routes messages from content scripts and the popup.
 *
 * Adapters are imported from the manifest's content_scripts list, so a dev copy that adds an
 * adapter (test/make-dev.js) needs no change here. Listeners are registered synchronously at the
 * top level, as MV3 requires.
 */
'use strict';

// The app's local server (PROTOCOL §1). test/make-dev.js rewrites this line for a stub app.
const APP_URL = 'http://127.0.0.1:27121';

const MANIFEST = chrome.runtime.getManifest();
const CONTENT_FILES = Array.from(new Set((MANIFEST.content_scripts || []).flatMap(c => c.js || [])));
const ADAPTER_FILES = CONTENT_FILES.filter(f => f.startsWith('adapters/'));

importScripts(
    '/shared/adapters.js',
    ...ADAPTER_FILES.map(f => '/' + f),
    '/content/page-world.js',
    '/background/bridge.js',
    '/background/jobs.js'
);

const log = (...a) => console.log('[Sameko]', ...a);

const bridge = SamekoBridge.create({
    chrome,
    fetch: (...a) => fetch(...a),
    extVersion: MANIFEST.version,
    browser: /Edg\//.test(navigator.userAgent) ? 'edge' : 'chrome',
    config: { baseUrl: APP_URL },
    getAdapters: () => SamekoAdapters.list(),
    log
});

const jobs = SamekoJobs.create({
    chrome,
    adapters: SamekoAdapters,
    emit: (ev) => bridge.postEvent(ev),
    isConnected: () => bridge.state.state === 'connected',
    contentFiles: CONTENT_FILES,
    pageWorld: SamekoPageWorld,
    log
});

bridge.setCommandHandler(cmd => jobs.handleCommand(cmd));

// ── messages ──────────────────────────────────────────────────────────────────────────────
// Content scripts: whoami, pageInfo, submitted, filled, verdict, failed, setEditorText.
// Popup: popup:getState, popup:sendProblem, popup:retry, popup:setSetting.
async function handlePopup(msg) {
    switch (msg.type) {
        case 'popup:getState':
            bridge.kick();                                  // opening the popup retries hello
            return {
                connection: bridge.state,
                settings: await jobs.getSettings(),
                recent: await jobs.recent(),
                tab: await jobs.activeTabInfo()
            };
        case 'popup:sendProblem':
            return jobs.sendActiveTab();
        case 'popup:retry':
            await bridge.retry();
            return { ok: true, connection: bridge.state };
        case 'popup:setSetting':
            return { ok: true, settings: await jobs.setSetting(msg.key, msg.value) };
        default:
            return undefined;
    }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string') return false;
    if (sender && sender.id && sender.id !== chrome.runtime.id) return false;
    let p;
    if (msg.type.startsWith('popup:')) {
        p = handlePopup(msg);
    } else {
        if (msg.type === 'pageInfo') bridge.kick();       // any OJ page load retries hello
        p = jobs.handleMessage(msg, sender);
    }
    if (!p || typeof p.then !== 'function') return false;
    p.then(r => sendResponse(r), e => { log('message failed', msg.type, e); sendResponse({ ok: false, error: { code: 'internal', message: String(e && e.message || e) } }); });
    return true;                                        // async sendResponse
});

// ── tabs, alarms ──────────────────────────────────────────────────────────────────────────
chrome.tabs.onRemoved.addListener(tabId => { jobs.onTabRemoved(tabId).catch(e => log('tab removed', e)); });
chrome.tabs.onActivated.addListener(info => { jobs.onTabActivated(info.tabId).catch(e => log('tab activated', e)); });

chrome.alarms.create('sameko-wake', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name !== 'sameko-wake') return;
    bridge.kick();
    jobs.checkTimeouts().catch(e => log('timeouts', e));
});

chrome.runtime.onStartup.addListener(() => bridge.kick());
chrome.runtime.onInstalled.addListener(details => {
    bridge.kick();
    // First install: open the welcome page once (not on updates or browser restarts).
    if (details && details.reason === 'install') {
        chrome.tabs.create({ url: chrome.runtime.getURL('welcome/welcome.html') }).catch(e => log('welcome', e));
    }
});

bridge.start();
jobs.checkTimeouts().catch(e => log('timeouts', e));
