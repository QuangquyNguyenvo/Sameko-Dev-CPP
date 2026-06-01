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

window.editSnippet = function (index) {
    if (!App.settings.snippets[index]) return;

    const snippet = App.settings.snippets[index];
    currentEditingIndex = index;

    document.getElementById('snippet-editor-title').textContent = 'Edit Snippet';
    document.getElementById('snippet-trigger-input').value = snippet.trigger;

    if (!snippetEditor) initSnippetEditor();
    if (snippetEditor) snippetEditor.setValue(snippet.content);

    document.getElementById('snippet-editor-modal').classList.add('active');
};

window.addNewSnippet = function () {
    currentEditingIndex = null;

    document.getElementById('snippet-editor-title').textContent = 'Add New Snippet';
    document.getElementById('snippet-trigger-input').value = '';

    if (!snippetEditor) initSnippetEditor();
    if (snippetEditor) snippetEditor.setValue('');

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
                <p>No snippets found. Click "Add New Snippet" to create one.</p>
            </div>
        `;
        return;
    }

    listContainer.innerHTML = App.settings.snippets.map((s, idx) => `
        <div class="snippet-item ${s.isBuiltin ? 'builtin' : ''}">
            <div class="snippet-trigger">${s.trigger}</div>
            <div class="snippet-preview" title="${s.content.replace(/"/g, '&quot;')}">
                ${s.content.split('\n')[0].substring(0, 50)}${s.content.length > 50 || s.content.includes('\n') ? '...' : ''}
            </div>
            <div class="snippet-actions">
                <button class="btn-edit" onclick="editSnippet(${idx})" title="Edit">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                </button>
                <button class="btn-delete" onclick="deleteSnippet(${idx})" title="Delete">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    </svg>
                </button>
            </div>
        </div>
    `).join('');
};

window.deleteSnippet = function (index) {
    if (confirm('Are you sure you want to delete this snippet?')) {
        App.settings.snippets.splice(index, 1);
        renderSnippetsList();
        if (typeof saveSettings === 'function') saveSettings();
    }
};

function saveSnippet() {
    const trigger = document.getElementById('snippet-trigger-input').value.trim();
    const content = snippetEditor ? snippetEditor.getValue() : '';

    if (!trigger) { alert('Please enter a trigger keyword.'); return; }
    if (!content) { alert('Please enter snippet content.'); return; }

    if (!App.settings.snippets) App.settings.snippets = [];

    const existingIndex = App.settings.snippets.findIndex(s => s.trigger === trigger);

    // Check for duplicate triggers
    if (currentEditingIndex === null && existingIndex !== -1) {
        alert('A snippet with this trigger already exists!');
        return;
    }
    if (currentEditingIndex !== null && existingIndex !== -1 && existingIndex !== currentEditingIndex) {
        alert('A snippet with this trigger already exists!');
        return;
    }

    const snippetData = { trigger, name: 'Custom', content };

    if (currentEditingIndex !== null) {
        App.settings.snippets[currentEditingIndex] = snippetData;
    } else {
        App.settings.snippets.push(snippetData);
    }

    renderSnippetsList();
    if (typeof saveSettings === 'function') saveSettings();
    closeSnippetEditor();
}

// Setup listeners
document.addEventListener('DOMContentLoaded', () => {
    const closeBtn = document.getElementById('btn-close-snippet-editor');
    const cancelBtn = document.getElementById('btn-cancel-snippet');
    const saveBtn = document.getElementById('btn-save-snippet');
    const overlay = document.querySelector('.snippet-editor-overlay');
    const addBtn = document.getElementById('btn-add-snippet');

    if (closeBtn) closeBtn.addEventListener('click', closeSnippetEditor);
    if (cancelBtn) cancelBtn.addEventListener('click', closeSnippetEditor);
    if (saveBtn) saveBtn.addEventListener('click', saveSnippet);
    if (overlay) overlay.addEventListener('click', closeSnippetEditor);
    if (addBtn) addBtn.addEventListener('click', addNewSnippet);

    // Initial render if App is already loaded
    if (typeof App !== 'undefined' && App.settings) {
        renderSnippetsList();
    }
});
