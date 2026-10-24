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

window.renderSnippetsList = function () {
    const listContainer = document.getElementById('snippets-list');
    if (!listContainer) return;

    if (!App.settings.snippets || App.settings.snippets.length === 0) {
        listContainer.innerHTML = `
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
        return;
    }

    listContainer.innerHTML = App.settings.snippets.map((s, idx) => `
        <div class="snippet-item ${s.isBuiltin ? 'builtin' : ''}">
            <div class="snippet-trigger">${escHtml(s.trigger)}</div>
            <div class="snippet-preview" title="${escHtml(s.content)}">
                ${escHtml(s.content.split('\n')[0].substring(0, 50))}${s.content.length > 50 || s.content.includes('\n') ? '...' : ''}
            </div>
            <div class="snippet-actions">
                <button class="btn-edit" data-snippet-edit="${idx}" title="Edit">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
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

    // Listeners instead of inline onclick="" attributes (blocked by the CSP).
    listContainer.querySelectorAll('[data-snippet-edit]').forEach(btn => {
        btn.addEventListener('click', () => window.editSnippet(parseInt(btn.dataset.snippetEdit, 10)));
    });
    listContainer.querySelectorAll('[data-snippet-delete]').forEach(btn => {
        btn.addEventListener('click', () => window.deleteSnippet(parseInt(btn.dataset.snippetDelete, 10)));
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
