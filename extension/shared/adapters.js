/*
 * SamekoAdapters: the registry of online-judge adapters plus pure helpers they share.
 *
 * Loaded by the service worker (importScripts) and as the first content script on OJ pages,
 * so it must not touch the DOM or any chrome.* API at load time. Each adapters/<id>.js file
 * calls SamekoAdapters.register({...}) — see PROTOCOL.md "Adapter contract" and
 * test/mock-oj/adapter.js for a complete worked example.
 */
(function (root) {
    'use strict';

    if (root.SamekoAdapters && root.SamekoAdapters.__sameko) {
        if (typeof module !== 'undefined' && module.exports) module.exports = root.SamekoAdapters;
        return;
    }

    // ── Verdict codes (PROTOCOL §3) ───────────────────────────────────────────────────────
    const VERDICT = Object.freeze({
        AC: 'AC', WA: 'WA', TLE: 'TLE', MLE: 'MLE', RE: 'RE', CE: 'CE',
        OLE: 'OLE', IE: 'IE', PARTIAL: 'PARTIAL', OTHER: 'OTHER'
    });
    const VERDICT_CODES = Object.freeze(Object.keys(VERDICT));

    // Judge wording → code. Order matters: the first match wins.
    const VERDICT_PATTERNS = [
        [/^\s*(AC|OK)\s*$|accepted|\bpassed\b|perfect result|happy new year/i, 'AC'],
        [/partial|^\s*(PA|PAC|PC)\s*$/i, 'PARTIAL'],
        [/wrong answer|^\s*WA\s*$/i, 'WA'],
        [/time limit|^\s*TLE?\s*$|idleness limit/i, 'TLE'],
        [/memory limit|^\s*MLE?\s*$/i, 'MLE'],
        [/output limit|^\s*OLE?\s*$/i, 'OLE'],
        [/compil\w* error|^\s*CE\s*$/i, 'CE'],
        [/runtime error|^\s*(RE|RTE|IR)\s*$|invalid return|segmentation|signal/i, 'RE'],
        [/internal error|judgement failed|judge error|^\s*(IE|JE)\s*$/i, 'IE']
    ];
    const PENDING_PATTERN = /running|judging|pending|in queue|queued|waiting|compiling|testing|^\s*(WJ|WR|QU|P|G)\s*$|^\s*\d+\s*\/\s*\d+\s*(WJ)?\s*$|^\s*$/i;

    /** Judge wording ("Wrong answer on test 7", "RTE", "Accepted") → a verdict code. */
    function normalizeVerdict(text) {
        const t = String(text == null ? '' : text);
        for (const [re, code] of VERDICT_PATTERNS) if (re.test(t)) return code;
        return 'OTHER';
    }

    /** True for "Running on test 3", "In queue", "WJ", "3/12" and other not-yet-final wording. */
    function isPendingVerdict(text) {
        return PENDING_PATTERN.test(String(text == null ? '' : text));
    }

    /** "46 ms" → 46, "1.5 s" → 1500, "2 seconds" → 2000; null when there is no number. */
    function parseTimeMs(text) {
        const m = /(\d+(?:[.,]\d+)?)\s*(ms|milli\w*|s|sec\w*)?/i.exec(String(text || ''));
        if (!m) return null;
        const n = parseFloat(m[1].replace(',', '.'));
        const unit = (m[2] || 'ms').toLowerCase();
        return Math.round(unit.startsWith('ms') || unit.startsWith('milli') ? n : n * 1000);
    }

    /** "1024 KB" → 1024, "256 MB" → 262144, "1.5 MiB" → 1536; null when there is no number. */
    function parseMemoryKb(text) {
        const m = /(\d+(?:[.,]\d+)?)\s*([kmg])?i?b?/i.exec(String(text || ''));
        if (!m) return null;
        const n = parseFloat(m[1].replace(',', '.'));
        const unit = (m[2] || 'k').toLowerCase();
        return Math.round(unit === 'g' ? n * 1024 * 1024 : unit === 'm' ? n * 1024 : n);
    }

    // ── Language picking ──────────────────────────────────────────────────────────────────
    // Used when the adapter gives no patterns for a language. `exclude` always applies.
    const LANGUAGES = {
        cpp: { match: [/g\+\+|c\+\+|\bcpp\b|clang\+\+/i], exclude: /objective/i },
        c: { match: [/\bgnu\s*c\b|\bgcc\b|\bc\s*\d{2}\b|(^|[^a-z+#])c(?![a-z+#])/i], exclude: /\+\+|#|objective|g\+\+/i },
        python: { match: [/\bpython\s*3|\bcpython|python3/i, /pypy\s*3|pypy3/i, /python(?!\s*2)/i], exclude: /python\s*2(?!\d)|pypy\s*2|cython/i },
        java: { match: [/\bjava\b/i], exclude: /javascript/i },
        pascal: { match: [/pascal|\bfpc\b|delphi/i], exclude: null },
        rust: { match: [/\brust\b/i], exclude: null },
        go: { match: [/\bgo\b|golang/i], exclude: null },
        kotlin: { match: [/kotlin/i], exclude: null },
        csharp: { match: [/c#|csharp|c\s*sharp/i], exclude: null },
        javascript: { match: [/javascript|node\.?js|\bjs\b/i], exclude: /typescript/i }
    };

    const STD_ALIASES = { '0x': 11, '1y': 14, '1z': 17, '2a': 20, '2b': 23, '2c': 26 };
    // Two-digit standard → sortable year (98 → 1998, 03 → 2003, 20 → 2020).
    const stdYear = (n) => (n == null ? null : n >= 80 ? 1900 + n : 2000 + n);

    function stdFromToken(tok) {
        if (tok == null) return null;
        const t = String(tok).toLowerCase();
        if (STD_ALIASES[t] != null) return STD_ALIASES[t];
        const n = parseInt(t, 10);
        return Number.isFinite(n) ? n : null;
    }

    /** The language standard an option or a job names: "GNU G++20 13.2" → 20, "c++17" → 17, "GNU GCC C11" → 11. */
    function parseStd(text, language) {
        const s = String(text || '');
        let m;
        if (language === 'c') {
            m = /(?:gnu|\bc)\s*(\d{2})\b/i.exec(s) || /\bc(\d{2})\b/i.exec(s);
            return m ? stdFromToken(m[1]) : null;
        }
        m = /(?:c\+\+|g\+\+|gnu\+\+|clang\+\+|\bcpp)\s*(\d{2}|\d[a-z])(?![a-z0-9])/i.exec(s);
        return m ? stdFromToken(m[1]) : null;
    }

    /** First dotted version number that is not part of a standard: "GNU G++20 13.2 (64 bit)" → [13, 2]. */
    function parseVersion(text) {
        const m = /(?:^|[^\d.+])(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(text || ''));
        return m ? [+m[1], +m[2], +(m[3] || 0)] : [0, 0, 0];
    }

    function cmpVersion(a, b) {
        for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
        return 0;
    }

    /**
     * Choose the best submit-form <option> for a job.
     *   options      [{ value, text }] — the <select>'s options
     *   job          { language, std? } — the submit command (PROTOCOL §2)
     *   preferences  { [language]: RegExp[] } — ordered: earlier patterns are preferred.
     *                Languages the adapter leaves out use the built-in patterns above.
     * Returns the chosen option object, or null when nothing matches the language
     * (never a different language). For cpp/c: an option with the requested std wins; without
     * one (or with no std requested), the newest GCC standard, then the newest compiler version.
     */
    function pickLanguage(options, job, preferences) {
        const language = String((job && job.language) || 'cpp').toLowerCase();
        const builtin = LANGUAGES[language];
        const prefs = preferences && preferences[language];
        const patterns = (Array.isArray(prefs) && prefs.length ? prefs : builtin ? builtin.match : [])
            .map(p => (p instanceof RegExp ? p : new RegExp(String(p), 'i')));
        if (!patterns.length || !Array.isArray(options)) return null;
        const exclude = builtin && builtin.exclude;

        const candidates = [];
        options.forEach((opt, index) => {
            if (!opt || opt.value == null || opt.value === '') return;
            const text = String(opt.text == null ? '' : opt.text).trim();
            if (exclude && exclude.test(text)) return;
            const prefIndex = patterns.findIndex(re => { re.lastIndex = 0; return re.test(text); });
            if (prefIndex < 0) return;
            candidates.push({ opt, text, index, prefIndex });
        });
        if (!candidates.length) return null;

        const isCLike = language === 'cpp' || language === 'c';
        const wantStd = isCLike && job && job.std ? parseStd(job.std, language) : null;
        for (const c of candidates) {
            c.version = parseVersion(c.text.replace(/(?:c\+\+|g\+\+|gnu\+\+|\bc)\s*\d{2}\b/ig, ' '));
            if (isCLike) {
                c.std = parseStd(c.text, language);
                c.stdMatch = wantStd != null && c.std === wantStd ? 1 : 0;
                c.gcc = /g\+\+|gcc|gnu/i.test(c.text) && !/clang|msvc|visual|intel/i.test(c.text) ? 1 : 0;
            }
        }
        candidates.sort((a, b) => {
            if (isCLike) {
                if (a.stdMatch !== b.stdMatch) return b.stdMatch - a.stdMatch;
                if (a.prefIndex !== b.prefIndex) return a.prefIndex - b.prefIndex;
                if (a.gcc !== b.gcc) return b.gcc - a.gcc;
                const sa = stdYear(a.std) || 0, sb = stdYear(b.std) || 0;
                if (sa !== sb) return sb - sa;
            } else if (a.prefIndex !== b.prefIndex) {
                return a.prefIndex - b.prefIndex;
            }
            const v = cmpVersion(b.version, a.version);
            return v || a.index - b.index;
        });
        return candidates[0].opt;
    }

    // ── Registry ──────────────────────────────────────────────────────────────────────────
    const registry = new Map();

    function normHost(host) {
        return String(host || '').toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    }

    function register(adapter) {
        if (!adapter || typeof adapter.id !== 'string' || !adapter.id) throw new Error('adapter.id is required');
        if (!Array.isArray(adapter.hosts) || !adapter.hosts.length) throw new Error(`adapter ${adapter.id}: hosts[] is required`);
        if (typeof adapter.classify !== 'function') throw new Error(`adapter ${adapter.id}: classify() is required`);
        registry.set(adapter.id, adapter);
        return adapter;
    }

    function get(id) { return registry.get(id) || null; }

    /** The adapter whose hosts include this URL's host (exact match, "www." ignored), or null. */
    function byUrl(url) {
        let host;
        try { host = normHost(new URL(String(url)).hostname); } catch (_) { return null; }
        for (const a of registry.values()) {
            if (a.hosts.some(h => normHost(h) === host)) return a;
        }
        return null;
    }

    /** classify() that never throws: → 'problem' | 'submit' | 'status' | 'other' | null (no adapter). */
    function classifyUrl(url) {
        const a = byUrl(url);
        if (!a) return null;
        try {
            const r = a.classify(String(url));
            return (r && r.kind) || 'other';
        } catch (_) {
            return 'other';
        }
    }

    /** The adapter list sent in `hello` (PROTOCOL §1). */
    function list() {
        return Array.from(registry.values()).map(a => ({ id: a.id, name: a.name || a.id, hosts: a.hosts.slice() }));
    }

    function unregister(id) { registry.delete(id); }

    const SamekoAdapters = {
        __sameko: true,
        VERDICT, VERDICT_CODES,
        register, unregister, get, byUrl, classifyUrl, list,
        pickLanguage, parseStd, parseVersion,
        normalizeVerdict, isPendingVerdict, parseTimeMs, parseMemoryKb
    };

    root.SamekoAdapters = SamekoAdapters;
    if (typeof module !== 'undefined' && module.exports) module.exports = SamekoAdapters;
})(typeof globalThis !== 'undefined' ? globalThis : this);
