// ============================================================================
// SNIPPETS - Settings › Snippets list and the snippet editor dialog
// ============================================================================
// A user snippet is { trigger, name, content, lang }. `lang` is a SNIPPET_LANGS key; snippets
// saved before it existed have none and count as C/C++. The editor only suggests the snippets
// of the file's language: cpp-suggestions.js for C and C++, registerSnippetCompletions() below
// for the other languages.

// lang -> [label, the Monaco languages it applies to]
const SNIPPET_LANGS = {
    'c-cpp': ['C/C++', ['cpp', 'c']],
    cpp: ['C++', ['cpp']],
    c: ['C', ['c']],
    python: ['Python', ['python']],
    java: ['Java', ['java']],
    kotlin: ['Kotlin', ['kotlin']],
    rust: ['Rust', ['rust']],
    go: ['Go', ['go']],
    pascal: ['Pascal', ['pascal']],
    javascript: ['JavaScript', ['javascript']]
};
// Imported file extension -> lang (anything else is C/C++).
const SNIPPET_EXT_LANGS = {
    cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hxx: 'cpp', c: 'c',
    py: 'python', java: 'java', kt: 'kotlin', rs: 'rust', go: 'go', pas: 'pascal', js: 'javascript'
};
const C_FAMILY = ['c-cpp', 'cpp', 'c'];

function snippetLang(s) {
    return SNIPPET_LANGS[s?.lang] ? s.lang : 'c-cpp';
}

/** Whether a user snippet is suggested in a file of this Monaco language. */
function snippetAppliesTo(s, monacoLang) {
    return SNIPPET_LANGS[snippetLang(s)][1].includes(monacoLang);
}

function snippetLangsOverlap(a, b) {
    const x = SNIPPET_LANGS[a][1];
    return SNIPPET_LANGS[b][1].some(l => x.includes(l));
}

/** The filter chip a snippet falls under: C, C++ and C/C++ share one. */
function snippetGroup(lang) {
    return C_FAMILY.includes(lang) ? 'c-family' : lang;
}

/** The snippet language of the file being edited, to preselect for a new snippet. */
function activeFileSnippetLang() {
    const id = typeof getPreferredTabId === 'function' ? getPreferredTabId() : App.activeTabId;
    const lang = App.tabs?.find(t => t.id === id)?.model?.getLanguageId?.();
    return SNIPPET_LANGS[lang] ? lang : 'c-cpp';
}

// ----------------------------------------------------------------------------
// Editor dialog
// ----------------------------------------------------------------------------
let snippetEditor = null;
let currentEditingIndex = null;

function initSnippetEditor() {
    if (snippetEditor) return;
    const container = document.getElementById('snippet-content-editor');
    if (!container || typeof monaco === 'undefined') return;

    snippetEditor = monaco.editor.create(container, {
        value: '',
        language: 'cpp',
        theme: App.settings.appearance.theme || 'kawaii-dark',
        fontSize: 14,
        fontFamily: 'JetBrains Mono, monospace',
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        // No tabSize here: in standalone Monaco it is a global model setting and would reset
        // the indentation of every open file.
        lineNumbers: 'on',
        renderWhitespace: 'selection',
        emptySelectionClipboard: false,
        bracketPairColorization: { enabled: true }
    });
}

function snippetMonacoLang(lang) {
    return SNIPPET_LANGS[lang][1][0];
}

/**
 * Put `text` in the snippet editor, highlighted as `lang`. Monaco loads lazily: opened before
 * it was ready, the dialog used to stay without an editor for good.
 */
let snippetTextRequest = 0;
function showSnippetText(text, lang) {
    const request = ++snippetTextRequest;
    const apply = () => {
        if (request !== snippetTextRequest) return; // another snippet was opened since
        if (!snippetEditor) initSnippetEditor();
        if (!snippetEditor) return;
        monaco.editor.setModelLanguage(snippetEditor.getModel(), snippetMonacoLang(lang));
        snippetEditor.setValue(text);
    };
    if (typeof monaco !== 'undefined') apply();
    else if (typeof ensureMonaco === 'function') ensureMonaco().then(apply).catch(() => { });
}

function setSnippetError(message) {
    const el = document.getElementById('snippet-error');
    if (!el) return;
    el.textContent = message || '';
    el.hidden = !message;
}

function openSnippetDialog(title, trigger, content, lang) {
    document.getElementById('snippet-editor-title').textContent = title;
    document.getElementById('snippet-trigger-input').value = trigger;
    document.getElementById('snippet-lang-select').value = lang;
    setSnippetError('');
    showSnippetText(content, lang);
    document.getElementById('snippet-editor-modal').classList.add('active');
    setTimeout(() => document.getElementById('snippet-trigger-input').focus(), 50);
}

window.editSnippet = function (index) {
    const snippet = App.settings.snippets[index];
    if (!snippet) return;
    currentEditingIndex = index;
    openSnippetDialog('Edit Snippet', snippet.trigger, snippet.content, snippetLang(snippet));
};

window.addNewSnippet = function () {
    currentEditingIndex = null;
    // The language of the filter being looked at, else the open file's.
    const lang = snippetFilter !== 'all' && snippetFilter !== 'c-family' ? snippetFilter : activeFileSnippetLang();
    openSnippetDialog('Add New Snippet', '', '', lang);
};

function closeSnippetEditor() {
    document.getElementById('snippet-editor-modal').classList.remove('active');
    currentEditingIndex = null;
}

// ----------------------------------------------------------------------------
// Settings list
// ----------------------------------------------------------------------------
const SNIPPET_ICON_EDIT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>';
const SNIPPET_ICON_DELETE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>';

// 'all', 'c-family' or a SNIPPET_LANGS key outside C/C++.
let snippetFilter = 'all';

/** First line of a snippet, cut to 50 characters, with "..." when there is more. */
function snippetPreviewText(content) {
    // Show the code as it is inserted: ${1:i} -> i, $1 / ${0} -> nothing.
    const text = content.replace(/\$\{\d+:([^}]*)\}/g, '$1').replace(/\$\{\d+\}|\$\d+/g, '');
    return text.split('\n')[0].substring(0, 50) + (text.length > 50 || text.includes('\n') ? '...' : '');
}

/** Built-in snippets (window.BUILTIN_SNIPPETS, cpp-suggestions.js) with their language. */
function builtinSnippetRows() {
    const B = window.BUILTIN_SNIPPETS || {};
    return [
        ...(B.common || []).map(s => [s, 'c-cpp']),
        ...(B.cpp || []).map(s => [s, 'cpp']),
        ...(B.c || []).map(s => [s, 'c'])
    ];
}

/** A user snippet replaces a built-in of the same trigger in the languages both cover. */
function builtinReplaced(trigger, lang) {
    return (App.settings.snippets || []).some(s => s.trigger === trigger && snippetLangsOverlap(snippetLang(s), lang));
}

function snippetLangBadge(lang) {
    return `<div class="snippet-lang" translate="no">${escHtml(SNIPPET_LANGS[lang][0])}</div>`;
}

/**
 * The built-in snippets as rows: hide/show one, or edit a copy, which becomes a user snippet
 * that replaces the built-in of the same trigger.
 */
function renderBuiltinSnippets() {
    const hidden = new Set(App.settings.hiddenSnippets || []);
    const rows = builtinSnippetRows().map(([s, lang]) => {
        const replaced = builtinReplaced(s.label, lang);
        const isHidden = !replaced && hidden.has(s.label);
        const actions = replaced
            ? '<div class="snippet-replaced-note">Replaced by your snippet</div>'
            : `<div class="snippet-actions">
                ${isHidden ? '<span class="snippet-hidden-tag">Hidden</span>' : ''}
                <button class="btn-edit" data-builtin-edit="${escHtml(s.label)}" title="Edit a copy">${SNIPPET_ICON_EDIT}</button>
                <label class="switch snippet-switch" title="${isHidden ? 'Hidden: not suggested in the editor' : 'Suggested in the editor'}">
                    <input type="checkbox" data-builtin-toggle="${escHtml(s.label)}" aria-label="${escHtml(s.label)}"${isHidden ? '' : ' checked'}>
                    <span class="slider"></span>
                </label>
            </div>`;
        return `
        <div class="snippet-item builtin${isHidden ? ' is-hidden' : ''}${replaced ? ' is-replaced' : ''}" data-builtin-trigger="${escHtml(s.label)}">
            <div class="snippet-trigger" translate="no">${escHtml(s.label)}</div>
            ${snippetLangBadge(lang)}
            <div class="snippet-preview" translate="no" title="${escHtml(s.text)}">${escHtml(snippetPreviewText(s.text))}</div>
            ${actions}
        </div>`;
    }).join('');
    if (!rows) return '';
    return `
        <div class="snippets-section-title">Built-in snippets</div>
        <div class="snippets-section-desc">Hide the ones you don't use, or edit one: your copy replaces the built-in. Delete the copy to get the built-in back.</div>
        ${rows}`;
}

/** Opens the editor on a copy of a built-in snippet, saved as a new user snippet. */
function editBuiltinSnippet(trigger) {
    const row = builtinSnippetRows().find(([s]) => s.label === trigger);
    if (!row) return;
    currentEditingIndex = null;
    openSnippetDialog('Edit Snippet', row[0].label, row[0].text, row[1]);
}

function toggleBuiltinSnippet(trigger) {
    const hidden = Array.isArray(App.settings.hiddenSnippets) ? App.settings.hiddenSnippets : [];
    App.settings.hiddenSnippets = hidden.includes(trigger)
        ? hidden.filter(t => t !== trigger)
        : [...hidden, trigger];
    renderSnippetsList();
    if (typeof saveSettings === 'function') saveSettings();
}

/** The filter chips: All, C/C++ (which holds the built-ins), then each language that has snippets. */
function renderSnippetFilters(user) {
    const bar = document.getElementById('snippet-filters');
    if (!bar) return;
    const counts = { all: user.length + builtinSnippetRows().length, 'c-family': builtinSnippetRows().length };
    for (const s of user) {
        const g = snippetGroup(snippetLang(s));
        counts[g] = (counts[g] || 0) + 1;
    }
    const keys = ['all', 'c-family', ...Object.keys(SNIPPET_LANGS).filter(k => !C_FAMILY.includes(k) && counts[k])];
    if (!keys.includes(snippetFilter)) snippetFilter = 'all';
    bar.innerHTML = keys.map(k => `
        <button class="snippet-filter${k === snippetFilter ? ' active' : ''}" data-snippet-filter="${k}" role="tab" aria-selected="${k === snippetFilter}">
            <span${k === 'all' ? '' : ' translate="no"'}>${k === 'all' ? 'All' : k === 'c-family' ? 'C/C++' : escHtml(SNIPPET_LANGS[k][0])}</span>
            <span class="snippet-filter-count">${counts[k] || 0}</span>
        </button>`).join('');
    bar.querySelectorAll('[data-snippet-filter]').forEach(btn => {
        btn.addEventListener('click', () => { snippetFilter = btn.dataset.snippetFilter; renderSnippetsList(); });
    });
}

window.renderSnippetsList = function () {
    const listContainer = document.getElementById('snippets-list');
    if (!listContainer) return;

    const user = App.settings.snippets || [];
    renderSnippetFilters(user);
    const shown = user
        .map((s, idx) => [s, idx])
        .filter(([s]) => snippetFilter === 'all' || snippetGroup(snippetLang(s)) === snippetFilter);

    let userHtml = shown.map(([s, idx]) => `
        <div class="snippet-item">
            <div class="snippet-trigger" translate="no">${escHtml(s.trigger)}</div>
            ${snippetLangBadge(snippetLang(s))}
            <div class="snippet-preview" translate="no" title="${escHtml(s.content)}">${escHtml(snippetPreviewText(s.content))}</div>
            <div class="snippet-actions">
                <button class="btn-edit" data-snippet-edit="${idx}" title="Edit">${SNIPPET_ICON_EDIT}</button>
                <button class="btn-delete" data-snippet-delete="${idx}" title="Delete">${SNIPPET_ICON_DELETE}</button>
            </div>
        </div>`).join('');
    if (!userHtml) {
        const name = snippetFilter === 'all' ? '' : snippetFilter === 'c-family' ? 'C/C++' : SNIPPET_LANGS[snippetFilter][0];
        const message = name ? I18n.t('No {0} snippets of your own yet.', name) : I18n.t('No snippets of your own yet.');
        userHtml = `<div class="snippets-empty">${escHtml(message)}</div>`;
    }

    const showBuiltins = snippetFilter === 'all' || snippetFilter === 'c-family';
    listContainer.innerHTML = userHtml + (showBuiltins ? renderBuiltinSnippets() : '');

    // Listeners instead of inline onclick="" attributes (blocked by the CSP).
    listContainer.querySelectorAll('[data-snippet-edit]').forEach(btn => {
        btn.addEventListener('click', () => window.editSnippet(parseInt(btn.dataset.snippetEdit, 10)));
    });
    listContainer.querySelectorAll('[data-snippet-delete]').forEach(btn => {
        btn.addEventListener('click', () => window.deleteSnippet(parseInt(btn.dataset.snippetDelete, 10)));
    });
    listContainer.querySelectorAll('[data-builtin-edit]').forEach(btn => {
        btn.addEventListener('click', () => editBuiltinSnippet(btn.dataset.builtinEdit));
    });
    listContainer.querySelectorAll('[data-builtin-toggle]').forEach(box => {
        box.addEventListener('change', () => toggleBuiltinSnippet(box.dataset.builtinToggle));
    });
};

window.deleteSnippet = async function (index) {
    const snippet = App.settings.snippets[index];
    if (!snippet) return;
    const confirmed = await showConfirmDialog({
        title: 'Delete Snippet',
        message: I18n.t('Delete the snippet "{0}"?', snippet.trigger),
        confirmText: 'Delete',
        danger: true
    });
    if (!confirmed || App.settings.snippets[index] !== snippet) return;
    App.settings.snippets.splice(index, 1);
    renderSnippetsList();
    if (typeof saveSettings === 'function') saveSettings();
};

function pushSnippet(snippetData) {
    if (currentEditingIndex !== null) App.settings.snippets[currentEditingIndex] = snippetData;
    else App.settings.snippets.push(snippetData);
}

/** Another snippet already has this trigger in one of the same languages. */
function snippetTriggerExists(trigger, lang) {
    return (App.settings.snippets || []).some((s, i) =>
        i !== currentEditingIndex && s.trigger === trigger && snippetLangsOverlap(snippetLang(s), lang));
}

function saveSnippet() {
    const trigger = document.getElementById('snippet-trigger-input').value.trim();
    const lang = document.getElementById('snippet-lang-select').value;
    const content = snippetEditor ? snippetEditor.getValue() : '';

    if (!trigger) { setSnippetError('Please enter a trigger keyword.'); return; }
    if (/\s/.test(trigger)) { setSnippetError('A trigger keyword cannot contain spaces.'); return; }
    if (!content.trim()) { setSnippetError('Please enter snippet content.'); return; }
    if (!App.settings.snippets) App.settings.snippets = [];
    if (snippetTriggerExists(trigger, lang)) {
        setSnippetError(I18n.t('{0} already has a snippet with this trigger.', SNIPPET_LANGS[lang][0]));
        return;
    }

    pushSnippet({ trigger, name: trigger, content, lang });
    // Show the saved snippet: switch the filter when it would hide it.
    if (snippetFilter !== 'all' && snippetFilter !== snippetGroup(lang)) snippetFilter = snippetGroup(lang);
    renderSnippetsList();
    if (typeof saveSettings === 'function') saveSettings();
    closeSnippetEditor();
}

function setSnippetsStatus(message, type) {
    const el = document.getElementById('snippets-status');
    if (!el) return;
    el.textContent = message;
    el.dataset.type = type;
    el.hidden = !message;
}

/** Import files as snippets: the trigger is the file name, the language its extension's. */
function addSnippetFromFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = ['h', 'txt', ...Object.keys(SNIPPET_EXT_LANGS)].map(e => '.' + e).join(',');

    input.onchange = async (e) => {
        const files = Array.from(e.target.files || []);
        if (!App.settings.snippets) App.settings.snippets = [];
        currentEditingIndex = null;
        let imported = 0;
        for (const file of files) {
            try {
                const trigger = file.name.replace(/\.[^/.]+$/, '').trim().replace(/\s+/g, '_');
                const lang = SNIPPET_EXT_LANGS[(file.name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase()] || 'c-cpp';
                const content = await file.text();
                if (!trigger || !content.trim() || snippetTriggerExists(trigger, lang)) continue;
                pushSnippet({ trigger, name: trigger, content, lang });
                imported++;
            } catch (_) { /* counted as failed below */ }
        }
        renderSnippetsList();
        if (imported && typeof saveSettings === 'function') saveSettings();

        const failed = files.length - imported;
        if (!files.length) return;
        if (!failed) setSnippetsStatus(I18n.t('Imported {0} snippet(s).', imported), 'success');
        else setSnippetsStatus(I18n.t('Imported {0} snippet(s). {1} skipped: empty, or the trigger is taken.', imported, failed), imported ? 'warning' : 'error');
    };

    input.click();
}

// ----------------------------------------------------------------------------
// Suggestions in the languages other than C and C++ (those are cpp-suggestions.js)
// ----------------------------------------------------------------------------
function registerSnippetCompletions(monacoApi) {
    const langs = [...new Set(Object.values(SNIPPET_LANGS).flatMap(([, l]) => l))].filter(l => l !== 'cpp' && l !== 'c');
    for (const lang of langs) {
        monacoApi.languages.registerCompletionItemProvider(lang, {
            provideCompletionItems: (model, position) => {
                if (App.settings?.editor?.snippets === false) return { suggestions: [] };
                const word = model.getWordUntilPosition(position);
                const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
                return {
                    suggestions: (App.settings.snippets || []).filter(s => snippetAppliesTo(s, lang)).map(s => ({
                        label: s.trigger,
                        kind: monacoApi.languages.CompletionItemKind.Snippet,
                        insertText: s.content,
                        insertTextRules: monacoApi.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                        documentation: s.name || 'Custom Snippet',
                        range
                    }))
                };
            }
        });
    }
}

// Setup listeners
document.addEventListener('DOMContentLoaded', () => {
    const on = (id, fn) => document.getElementById(id)?.addEventListener('click', fn);
    on('btn-close-snippet-editor', closeSnippetEditor);
    on('btn-cancel-snippet', closeSnippetEditor);
    on('btn-save-snippet', saveSnippet);
    on('btn-add-snippet', addNewSnippet);
    on('btn-add-snippet-from-file', addSnippetFromFile);
    document.querySelector('.snippet-editor-overlay')?.addEventListener('click', closeSnippetEditor);

    const langSelect = document.getElementById('snippet-lang-select');
    if (langSelect) {
        langSelect.innerHTML = Object.entries(SNIPPET_LANGS)
            .map(([k, [label]]) => `<option value="${k}">${escHtml(label)}</option>`).join('');
        langSelect.addEventListener('change', () => {
            setSnippetError('');
            if (snippetEditor) monaco.editor.setModelLanguage(snippetEditor.getModel(), snippetMonacoLang(langSelect.value));
        });
    }
    const triggerInput = document.getElementById('snippet-trigger-input');
    triggerInput?.addEventListener('input', () => setSnippetError(''));
    triggerInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); snippetEditor?.focus(); } });

    if (typeof App !== 'undefined' && App.settings) renderSnippetsList();
});

if (typeof module !== 'undefined' && module.exports) module.exports = { snippetAppliesTo, snippetLang, SNIPPET_LANGS };
else Object.assign(window, { snippetAppliesTo, snippetLang, registerSnippetCompletions });
