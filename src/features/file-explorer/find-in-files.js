/**
 * Find in Files (Ctrl+Shift+F): a search panel in the Explorer sidebar that replaces the tree
 * while open. The search runs in the main process (app/services/file-search.js); results are
 * grouped by file, each line with its number and the match highlighted. Typing searches after
 * a short pause; Enter searches at once; Esc or the close button goes back to the tree.
 */
const FindInFiles = (() => {
    const TYPE_DELAY_MS = 300;
    let panel;
    let folder;
    let request = 0;
    let typeTimer = null;

    const t = (s, ...args) => (typeof I18n !== 'undefined' ? I18n.t(s, ...args) : s.replace('{0}', args[0]));

    function init(explorer) {
        if (panel) return;
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.id = 'btn-find-in-files';
        toggle.className = 'explorer-action-btn folder-only';
        toggle.title = 'Find in Files (Ctrl+Shift+F)';
        toggle.setAttribute('aria-label', 'Find in Files');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-controls', 'find-in-files');
        toggle.innerHTML = '<svg class="ico" aria-hidden="true" width="15" height="15"><use href="#i-magnifying-glass"/></svg>';
        explorer.elements.sidebar.querySelector('.explorer-actions').prepend(toggle);

        panel = document.createElement('section');
        panel.id = 'find-in-files';
        panel.hidden = true;
        panel.setAttribute('aria-label', 'Find in Files');
        // Static markup only: user text goes in with textContent below.
        panel.innerHTML = `
            <div class="fif-head">
                <span class="fif-title">Find in Files</span>
                <button type="button" class="fif-close" title="Close (Esc)" aria-label="Close">
                    <svg class="ico" aria-hidden="true" width="12" height="12"><use href="#i-x"/></svg>
                </button>
            </div>
            <form class="fif-form" autocomplete="off">
                <label class="explorer-filter fif-box" for="find-files-query">
                    <svg class="ico" aria-hidden="true" width="14" height="14"><use href="#i-magnifying-glass"/></svg>
                    <input id="find-files-query" type="text" maxlength="512" spellcheck="false" placeholder="Search…">
                    <span class="fif-toggle" title="Match case">
                        <input type="checkbox" name="caseSensitive" aria-label="Match case"><span aria-hidden="true">Aa</span>
                    </span>
                    <span class="fif-toggle" title="Use regex">
                        <input type="checkbox" name="regex" aria-label="Use regex"><span aria-hidden="true">.*</span>
                    </span>
                </label>
            </form>
            <p class="fif-status" role="status"></p>
            <div class="fif-results" translate="no"></div>`;
        explorer.elements.sidebar.append(panel);

        const form = panel.querySelector('form');
        const query = panel.querySelector('#find-files-query');
        toggle.addEventListener('click', () => panel.hidden ? open() : close());
        panel.querySelector('.fif-close').addEventListener('click', close);
        form.addEventListener('submit', (event) => { event.preventDefault(); search(); });
        query.addEventListener('input', () => {
            clearTimeout(typeTimer);
            typeTimer = setTimeout(search, TYPE_DELAY_MS);
        });
        for (const box of form.querySelectorAll('input[type=checkbox]')) box.addEventListener('change', search);
        panel.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                close();
            }
        });
    }

    function open() {
        const explorer = window.FileExplorer;
        if (!panel || !explorer) return;
        if (!explorer.isOpen) explorer.open();
        folderChanged();
        panel.hidden = false;
        explorer.elements.sidebar.classList.add('explorer-searching');
        document.getElementById('btn-find-in-files').setAttribute('aria-expanded', 'true');
        const query = panel.querySelector('#find-files-query');
        query.focus();
        query.select();
    }

    function close() {
        if (!panel || panel.hidden) return;
        panel.hidden = true;
        window.FileExplorer.elements.sidebar.classList.remove('explorer-searching');
        const toggle = document.getElementById('btn-find-in-files');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.focus();
    }

    function setStatus(text, kind = '') {
        const status = panel.querySelector('.fif-status');
        status.textContent = text;
        status.className = 'fif-status' + (kind ? ' ' + kind : '');
    }

    function folderChanged() {
        if (!panel || folder === window.FileExplorer.currentFolder) return;
        folder = window.FileExplorer.currentFolder;
        request++;
        panel.querySelector('.fif-results').replaceChildren();
        setStatus(folder ? '' : t('Open a folder to search its files.'));
    }

    async function search() {
        clearTimeout(typeTimer);
        folderChanged();
        if (!folder) return;
        const form = panel.querySelector('form');
        const query = form.querySelector('#find-files-query').value;
        const results = panel.querySelector('.fif-results');
        const id = ++request;
        if (!query) {
            results.replaceChildren();
            setStatus('');
            return;
        }
        const caseSensitive = form.elements.caseSensitive.checked;
        const regex = form.elements.regex.checked;
        setStatus(t('Searching files…'));
        const response = await window.electronAPI.searchInFiles({ folder, query, caseSensitive, regex })
            .catch(() => ({ status: 'unavailable' }));
        folderChanged();
        if (request !== id) return;   // a newer search or another folder
        if (response.status !== 'ok') {
            results.replaceChildren();
            setStatus(t({
                'invalid-regex': 'Invalid regular expression.',
                'invalid-query': 'Enter text to search for.',
                timeout: 'Search timed out. Try a narrower folder or a simpler query.',
                unavailable: 'Could not search this folder.'
            }[response.status] || 'Could not search this folder.'), 'error');
            return;
        }
        setStatus(response.capped ? t('Showing the first {0} matching lines.', response.count)
            : response.count ? t('Matching lines: {0}', response.count) : t('No matching lines.'));
        renderResults(results, response.files, highlighter(query, caseSensitive, regex));
    }

    /** A function that splits a preview line into [before, match, after], or null. */
    function highlighter(query, caseSensitive, regex) {
        let re;
        try {
            re = new RegExp(regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'u' : 'iu');
        } catch (_) {
            return () => null;
        }
        return (text) => {
            const m = re.exec(text);
            if (!m || !m[0]) return null;
            return [text.slice(0, m.index), m[0], text.slice(m.index + m[0].length)];
        };
    }

    function renderResults(root, files, split) {
        const groups = document.createDocumentFragment();
        for (const file of files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
            const group = document.createElement('details');
            group.className = 'fif-file';
            group.open = true;
            const title = document.createElement('summary');
            title.title = file.relativePath;
            const parts = file.relativePath.split(/[/\\]/);
            const name = document.createElement('span');
            name.className = 'fif-file-name';
            name.textContent = parts.pop();
            const dir = document.createElement('span');
            dir.className = 'fif-file-dir';
            dir.textContent = parts.join('/');
            const count = document.createElement('span');
            count.className = 'fif-count';
            count.textContent = String(file.matches.length);
            title.append(name, dir, count);
            group.append(title);
            for (const match of file.matches) {
                const row = document.createElement('button');
                row.type = 'button';
                row.className = 'find-files-match';
                row.title = file.relativePath + ':' + match.line;
                const line = document.createElement('span');
                line.className = 'fif-line';
                line.textContent = String(match.line);
                const text = document.createElement('span');
                text.className = 'fif-text';
                const preview = match.preview.replace(/^\s+/, '');
                const pieces = split(preview);
                if (pieces) {
                    const mark = document.createElement('mark');
                    mark.textContent = pieces[1];
                    text.append(pieces[0], mark, pieces[2]);
                } else {
                    text.textContent = preview;
                }
                row.append(line, text);
                row.addEventListener('click', () =>
                    openFileAt(file.path, { lineNumber: match.line, column: match.column }));
                group.append(row);
            }
            groups.append(group);
        }
        root.replaceChildren(groups);
    }

    return { init, open, close, folderChanged };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = FindInFiles;
else window.FindInFiles = FindInFiles;
