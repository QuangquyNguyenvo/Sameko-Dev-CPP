'use strict';
/*
 * A small fake of the chrome.* surface the worker uses, for Node tests. Promise APIs only.
 * Tabs keep { id, url, active, windowId, lastAccessed }; tabs.sendMessage is answered by a
 * per-tab handler the test installs with `fake.setTabHandler(tabId, fn)` (fn(msg) → response;
 * no handler → rejects like Chrome's "Receiving end does not exist").
 */
function event() {
    const listeners = new Set();
    return {
        addListener: fn => listeners.add(fn),
        removeListener: fn => listeners.delete(fn),
        fire: (...a) => { for (const fn of Array.from(listeners)) fn(...a); }
    };
}

function storageArea(name, onChanged) {
    let data = {};
    const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
    return {
        async get(keys) {
            if (keys == null) return clone(data);
            const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
            const out = {};
            for (const k of list) if (k in data) out[k] = clone(data[k]);
            return out;
        },
        async set(obj) {
            const changes = {};
            for (const [k, v] of Object.entries(obj)) { changes[k] = { oldValue: data[k], newValue: clone(v) }; data[k] = clone(v); }
            onChanged.fire(changes, name);
        },
        async remove(keys) { for (const k of [].concat(keys)) delete data[k]; },
        async clear() { data = {}; },
        _dump: () => data
    };
}

function createFakeChrome(opts) {
    const o = Object.assign({ id: 'testextensionid' }, opts || {});
    const onChanged = event();
    const tabs = new Map();
    const tabHandlers = new Map();
    const calls = [];
    let nextTabId = 100;

    const chrome = {
        runtime: {
            id: o.id,
            sent: [],
            async sendMessage(msg) { chrome.runtime.sent.push(msg); throw new Error('Could not establish connection. Receiving end does not exist.'); },
            async getPlatformInfo() { return { os: 'win' }; },
            getManifest: () => o.manifest || { version: '0.1.0', content_scripts: [] },
            onMessage: event(), onStartup: event(), onInstalled: event()
        },
        storage: { local: null, session: null, onChanged },
        tabs: {
            async create(props) {
                const tab = { id: nextTabId++, url: props.url, active: props.active !== false, windowId: 1, lastAccessed: Date.now() };
                tabs.set(tab.id, tab);
                calls.push(['tabs.create', props]);
                return Object.assign({}, tab);
            },
            async update(id, props) {
                const tab = tabs.get(id);
                if (!tab) throw new Error(`No tab with id: ${id}.`);
                Object.assign(tab, props);
                calls.push(['tabs.update', id, props]);
                return Object.assign({}, tab);
            },
            async get(id) {
                const tab = tabs.get(id);
                if (!tab) throw new Error(`No tab with id: ${id}.`);
                return Object.assign({}, tab);
            },
            async remove(id) {
                calls.push(['tabs.remove', id]);
                if (!tabs.has(id)) throw new Error(`No tab with id: ${id}.`);
                tabs.delete(id);
                chrome.tabs.onRemoved.fire(id, {});
            },
            async query(q) {
                let list = Array.from(tabs.values());
                if (q && q.active) list = list.filter(t => t.active);
                return list.map(t => Object.assign({}, t));
            },
            async sendMessage(tabId, msg) {
                calls.push(['tabs.sendMessage', tabId, msg]);
                const h = tabHandlers.get(tabId);
                if (!h) throw new Error('Could not establish connection. Receiving end does not exist.');
                return h(msg);
            },
            onRemoved: event(), onActivated: event(), onUpdated: event()
        },
        scripting: {
            async executeScript(details) {
                calls.push(['scripting.executeScript', details]);
                if (o.onExecuteScript) return o.onExecuteScript(details);
                return [{ result: null }];
            }
        },
        windows: { async update() { return {}; } },
        alarms: { create() {}, onAlarm: event() }
    };
    chrome.storage.local = storageArea('local', onChanged);
    chrome.storage.session = storageArea('session', onChanged);

    return {
        chrome, calls,
        tabs,
        setTabHandler(tabId, fn) { if (fn) tabHandlers.set(tabId, fn); else tabHandlers.delete(tabId); },
        addTab(props) {
            const tab = Object.assign({ id: nextTabId++, active: false, windowId: 1, lastAccessed: 0 }, props);
            tabs.set(tab.id, tab);
            return tab;
        },
        closeTab(id) { tabs.delete(id); chrome.tabs.onRemoved.fire(id, {}); }
    };
}

module.exports = { createFakeChrome };
