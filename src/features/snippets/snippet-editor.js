// ============================================================================
// SNIPPET EDITOR MODAL LOGIC
// ============================================================================

// Global Monaco Editor instance for snippet editing
let snippetEditor = null;
let currentEditingIndex = null;

function initSnippetEditor() {
    if (snippetEditor) return; // Already initialized

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
        tabSize: 4,
        lineNumbers: 'on',
        renderWhitespace: 'selection',
        emptySelectionClipboard: false,
        bracketPairColorization: { enabled: true }
    });
}

/**
 * Put `text` in the snippet editor. Monaco loads lazily: opened before it was
 * ready, the dialog used to stay without an editor for good.
 */
let snippetTextRequest = 0;
function showSnippetText(text) {
    const request = ++snippetTextRequest;
    const apply = () => {
        if (request !== snippetTextRequest) return; // another snippet was opened since
        if (!snippetEditor) initSnippetEditor();
        if (snippetEditor) snippetEditor.setValue(text);
    };
    if (typeof monaco !== 'undefined') apply();
    else if (typeof ensureMonaco === 'function') ensureMonaco().then(apply).catch(() => { });
}

window.editSnippet = function (index) {
    if (!App.settings.snippets[index]) return;

    const snippet = App.settings.snippets[index];
    currentEditingIndex = index;

    document.getElementById('snippet-editor-title').textContent = 'Edit Snippet';
    document.getElementById('snippet-trigger-input').value = snippet.trigger;

    showSnippetText(snippet.content);

    document.getElementById('snippet-editor-modal').classList.add('active');
};

window.addNewSnippet = function () {
    currentEditingIndex = null;

    document.getElementById('snippet-editor-title').textContent = 'Add New Snippet';
    document.getElementById('snippet-trigger-input').value = '';

    showSnippetText('');

    document.getElementById('snippet-editor-modal').classList.add('active');
};

function closeSnippetEditor() {
    document.getElementById('snippet-editor-modal').classList.remove('active');
    currentEditingIndex = null;
}

const SNIPPET_ICON_EDIT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>';
const SNIPPET_ICON_HIDE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>';
const SNIPPET_ICON_SHOW = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>';

/** First line of a snippet, cut to 50 characters, with "..." when there is more. */
function snippetPreviewText(content) {
    // Show the code as it is inserted: ${1:i} -> i, $1 / ${0} -> nothing.
    const text = content.replace(/\$\{\d+:([^}]*)\}/g, '$1').replace(/\$\{\d+\}|\$\d+/g, '');
    return text.split('\n')[0].substring(0, 50) + (text.length > 50 || text.includes('\n') ? '...' : '');
}

/**
 * The built-in snippets (window.BUILTIN_SNIPPETS, cpp-suggestions.js) as rows: hide/show one,
 * or edit a copy, which becomes a user snippet that replaces the built-in of the same trigger.
 */
function renderBuiltinSnippets() {
    const B = window.BUILTIN_SNIPPETS;
    if (!B) return '';
    const hidden = new Set(App.settings.hiddenSnippets || []);
    const userTriggers = new Set((App.settings.snippets || []).map(s => s.trigger));
    const rows = [
        ...(B.common || []).map(s => [s, 'C/C++']),
        ...(B.cpp || []).map(s => [s, 'C++']),
        ...(B.c || []).map(s => [s, 'C'])
    ].map(([s, lang]) => {
        const replaced = userTriggers.has(s.label);
        const isHidden = !replaced && hidden.has(s.label);
        const actions = replaced
            ? '<div class="snippet-replaced-note">Replaced by your snippet</div>'
            : `<div class="snippet-actions">
                <button class="btn-edit" data-builtin-edit="${escHtml(s.label)}" title="Edit a copy">${SNIPPET_ICON_EDIT}</button>
                <button class="btn-edit" data-builtin-toggle="${escHtml(s.label)}" title="${isHidden ? 'Show' : 'Hide'}">${isHidden ? SNIPPET_ICON_SHOW : SNIPPET_ICON_HIDE}</button>
            </div>`;
        return `
        <div class="snippet-item builtin snippet-builtin${isHidden ? ' is-hidden' : ''}${replaced ? ' is-replaced' : ''}" data-builtin-trigger="${escHtml(s.label)}">
            <div class="snippet-trigger" translate="no">${escHtml(s.label)}</div>
            <div class="snippet-lang" translate="no">${lang}</div>
            <div class="snippet-preview" translate="no" title="${escHtml(s.text)}">${escHtml(snippetPreviewText(s.text))}</div>
            ${actions}
        </div>`;
    }).join('');
    return `
        <div class="snippets-section-title">Built-in snippets</div>
        <div class="snippets-section-desc">Hide the ones you don't use, or edit one: your copy replaces the built-in. Delete the copy to get the built-in back.</div>
        ${rows}`;
}

/** Opens the editor on a copy of a built-in snippet, saved as a new user snippet. */
function editBuiltinSnippet(trigger) {
    const B = window.BUILTIN_SNIPPETS || {};
    const s = [...(B.common || []), ...(B.cpp || []), ...(B.c || [])].find(x => x.label === trigger);
    if (!s) return;
    currentEditingIndex = null;
    document.getElementById('snippet-editor-title').textContent = 'Edit Snippet';
    document.getElementById('snippet-trigger-input').value = s.label;
    showSnippetText(s.text);
    document.getElementById('snippet-editor-modal').classList.add('active');
}

function toggleBuiltinSnippet(trigger) {
    const hidden = Array.isArray(App.settings.hiddenSnippets) ? App.settings.hiddenSnippets : [];
    App.settings.hiddenSnippets = hidden.includes(trigger)
        ? hidden.filter(t => t !== trigger)
        : [...hidden, trigger];
    renderSnippetsList();
    if (typeof saveSettings === 'function') saveSettings();
}

window.renderSnippetsList = function () {
    const listContainer = document.getElementById('snippets-list');
    if (!listContainer) return;

    let userHtml;
    if (!App.settings.snippets || App.settings.snippets.length === 0) {
        userHtml = `
            <div class="snippets-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="12" y1="18" x2="12" y2="12"></line>
                    <line x1="9" y1="15" x2="15" y2="15"></line>
                </svg>
                <p>No snippets found.</p>
                <p>Click "Add New Snippet" or "Import from File(s)" to add some.</p>
            </div>
        `;
    } else {
        userHtml = App.settings.snippets.map((s, idx) => `
        <div class="snippet-item ${s.isBuiltin ? 'builtin' : ''}">
            <div class="snippet-trigger">${escHtml(s.trigger)}</div>
            <div class="snippet-preview" title="${escHtml(s.content)}">
                ${escHtml(snippetPreviewText(s.content))}
            </div>
            <div class="snippet-actions">
                <button class="btn-edit" data-snippet-edit="${idx}" title="Edit">
                    ${SNIPPET_ICON_EDIT}
                </button>
                <button class="btn-delete" data-snippet-delete="${idx}" title="Delete">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    </svg>
                </button>
            </div>
        </div>
    `).join('');
    }

    listContainer.innerHTML = userHtml + renderBuiltinSnippets();

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
    listContainer.querySelectorAll('[data-builtin-toggle]').forEach(btn => {
        btn.addEventListener('click', () => toggleBuiltinSnippet(btn.dataset.builtinToggle));
    });
};

window.deleteSnippet = function (index) {
    if (confirm('Are you sure you want to delete this snippet?')) {
        App.settings.snippets.splice(index, 1);
        renderSnippetsList();
        if (typeof saveSettings === 'function') saveSettings();
    }
};

function pushSnippet(snippetData) {
    if (currentEditingIndex !== null) {
        App.settings.snippets[currentEditingIndex] = snippetData;
    } else {
        App.settings.snippets.push(snippetData);
    }
}

function snippetTriggerExists(trigger) {
    const existingIndex = App.settings.snippets.findIndex(s => s.trigger === trigger);

    if (currentEditingIndex === null && existingIndex !== -1) {
        return true;
    }
    if (currentEditingIndex !== null && existingIndex !== -1 && existingIndex !== currentEditingIndex) {
        return true;
    }

    return false;
}

function saveSnippet() {
    const trigger = document.getElementById('snippet-trigger-input').value.trim();
    const content = snippetEditor ? snippetEditor.getValue() : '';

    if (!trigger) { alert('Please enter a trigger keyword.'); return; }
    if (!content) { alert('Please enter snippet content.'); return; }

    if (!App.settings.snippets) App.settings.snippets = [];

    // Check for duplicate triggers
    if (snippetTriggerExists(trigger)) {
        alert('A snippet with this trigger already exists!');
        return;
    }

    pushSnippet({ trigger, name: trigger, content });

    renderSnippetsList();
    if (typeof saveSettings === 'function') saveSettings();
    closeSnippetEditor();
}

function snippetImportFeedback(successfulImports, failedImports) {
    if (successfulImports > 0 && failedImports === 0) {
        alert(`Successfully imported ${successfulImports} snippet(s)!`);
    } else if (successfulImports > 0 && failedImports > 0) {
        alert(
            `Successfully imported ${successfulImports} snippet(s)!\n\n` +
            `Failed to import ${failedImports} snippet(s).\n` +
            `Check for duplicate triggers!`
        );
    } else if (successfulImports === 0 && failedImports > 0) {
        alert(
            `Failed to import ${failedImports} snippet(s).\n` +
            `Check for duplicate triggers!`
        );
    } else {
        alert('No snippets were found to import.');
    }
}

function addSnippetFromFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true; // Import many snippets at once
    input.accept = '.cpp,.cc,.cxx,.c,.h,.hpp,.hxx,.txt'; // Only C/C++/txt

    input.onchange = async (e) => {
        const files = Array.from(e.target.files || []);
        let failedImports = 0;

        for (const file of files) {
            try {
                // Remove extension for cleaner trigger name
                const trigger = file.name.replace(/\.[^/.]+$/, '').trim();
                const content = await file.text();

                // Check for duplicate or empty triggers and empty files
                if (snippetTriggerExists(trigger) || !trigger || file.size === 0) {
                    failedImports++;
                    continue;
                }

                pushSnippet({ trigger, name: trigger, content });
            }
            catch {
                failedImports++;
            }
        }

        renderSnippetsList();
        if (typeof saveSettings === 'function') saveSettings();

        const successfulImports = files.length - failedImports;
        snippetImportFeedback(successfulImports, failedImports);
    };

    input.click();
}

// Setup listeners
document.addEventListener('DOMContentLoaded', () => {
    const closeBtn = document.getElementById('btn-close-snippet-editor');
    const cancelBtn = document.getElementById('btn-cancel-snippet');
    const saveBtn = document.getElementById('btn-save-snippet');
    const overlay = document.querySelector('.snippet-editor-overlay');
    const addBtn = document.getElementById('btn-add-snippet');
    const addFromFileBtn = document.getElementById('btn-add-snippet-from-file')

    if (closeBtn) closeBtn.addEventListener('click', closeSnippetEditor);
    if (cancelBtn) cancelBtn.addEventListener('click', closeSnippetEditor);
    if (saveBtn) saveBtn.addEventListener('click', saveSnippet);
    if (overlay) overlay.addEventListener('click', closeSnippetEditor);
    if (addBtn) addBtn.addEventListener('click', addNewSnippet);
    if (addFromFileBtn) addFromFileBtn.addEventListener('click', addSnippetFromFile);

    // Initial render if App is already loaded
    if (typeof App !== 'undefined' && App.settings) {
        renderSnippetsList();
    }
});
