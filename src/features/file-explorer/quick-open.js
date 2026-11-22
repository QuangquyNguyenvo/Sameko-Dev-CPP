/**
 * Go to File (Ctrl+P): a small picker over the open tabs and the Explorer folder's files.
 * Letters match in order (`mcpp` finds main.cpp); `name:12` opens the file at line 12.
 * The file list comes from the main process (file-search.js listFiles).
 */
const QuickOpen = (() => {
    const MAX_ROWS = 50;
    let root;
    let input;
    let list;
    let items = [];
    let shown = [];
    let active = 0;
    let request = 0;

    function build() {
        if (root) return;
        root = document.createElement('div');
        root.className = 'quick-open';
        root.hidden = true;
        root.innerHTML = `
            <div class="quick-open-box" role="dialog" aria-label="Go to File">
                <input type="text" spellcheck="false" autocomplete="off" maxlength="260"
                    placeholder="Type a file name (name:12 goes to line 12)" aria-label="Go to File">
                <div class="quick-open-list" role="listbox" translate="no"></div>
                <p class="quick-open-empty" hidden>No matching files</p>
            </div>`;
        document.body.append(root);
        input = root.querySelector('input');
        list = root.querySelector('.quick-open-list');
        input.addEventListener('input', () => { active = 0; render(); });
        input.addEventListener('keydown', onKey);
        root.addEventListener('mousedown', event => { if (event.target === root) close(); });
    }

    function onKey(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!shown.length) return;
            active = (active + (event.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
            paintActive();
        } else if (event.key === 'Enter') {
            event.preventDefault();
            choose(shown[active]);
        }
    }

    function relative(file, folder) {
        if (!folder) return file;
        const a = file.replace(/\\/g, '/');
        const b = folder.replace(/\\/g, '/').replace(/\/$/, '');
        return pathKey(a).startsWith(pathKey(b + '/')) ? a.slice(b.length + 1) : file;
    }

    async function open() {
        build();
        if (!root.hidden) { close(); return; }
        const folder = window.FileExplorer?.currentFolder || '';
        const id = ++request;
        items = App.tabs.map(tab => ({
            name: tab.name, tabId: tab.id, path: tab.path || '',
            detail: tab.path ? relative(tab.path, folder) : ''
        }));
        root.hidden = false;
        input.value = '';
        active = 0;
        render();
        input.focus();
        if (!folder) return;
        const response = await window.electronAPI.listWorkspaceFiles(folder).catch(() => null);
        if (id !== request || root.hidden || !response?.files) return;
        const known = new Set(items.filter(item => item.path).map(item => pathKey(item.path)));
        for (const file of response.files) {
            if (known.has(pathKey(file.path))) continue;
            items.push({ name: file.relativePath.split(/[/\\]/).pop(), path: file.path, detail: file.relativePath });
        }
        render();
    }

    function close() {
        if (!root || root.hidden) return;
        request++;
        root.hidden = true;
        getActiveEditor()?.focus();
    }

    /** Letters of `query` in order inside `text`; adjacent letters and word starts score more. */
    function score(query, text) {
        const lower = text.toLowerCase();
        let at = 0;
        let total = 0;
        let last = -2;
        for (let i = 0; i < lower.length && at < query.length; i++) {
            if (lower[i] !== query[at]) continue;
            total += i === last + 1 ? 5 : 1;
            if (i === 0 || /[/\\._-]/.test(lower[i - 1])) total += 3;
            last = i;
            at++;
        }
        return at === query.length ? total - text.length / 100 : -1;
    }

    function parseQuery() {
        const match = /^(.*?)(?::(\d+))?$/.exec(input.value.trim());
        return { text: match[1].toLowerCase().replace(/\s+/g, ''), line: match[2] ? Number(match[2]) : 0 };
    }

    function render() {
        const { text } = parseQuery();
        if (!text) {
            shown = items.slice(0, MAX_ROWS);
        } else {
            shown = items.map(item => {
                const byName = score(text, item.name);
                return { item, rank: byName >= 0 ? byName * 2 : score(text, item.detail || item.name) };
            }).filter(row => row.rank >= 0)
                .sort((a, b) => b.rank - a.rank)
                .slice(0, MAX_ROWS)
                .map(row => row.item);
        }
        active = Math.min(active, Math.max(0, shown.length - 1));
        list.replaceChildren(...shown.map((item, index) => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'quick-open-row';
            row.setAttribute('role', 'option');
            row.tabIndex = -1;
            const name = document.createElement('span');
            name.className = 'quick-open-name';
            name.textContent = item.name;
            const detail = document.createElement('span');
            detail.className = 'quick-open-detail';
            detail.textContent = item.detail;
            row.append(name, detail);
            row.addEventListener('mousemove', () => { if (active !== index) { active = index; paintActive(); } });
            row.addEventListener('click', () => choose(item));
            return row;
        }));
        root.querySelector('.quick-open-empty').hidden = shown.length > 0;
        paintActive();
    }

    function paintActive() {
        [...list.children].forEach((row, index) => {
            const on = index === active;
            row.classList.toggle('active', on);
            row.setAttribute('aria-selected', String(on));
            if (on) row.scrollIntoView({ block: 'nearest' });
        });
    }

    async function choose(item) {
        if (!item) return;
        const { line } = parseQuery();
        close();
        if (item.path) {
            await openFileAt(item.path, line ? { lineNumber: line, column: 1 } : null);
        } else if (item.tabId) {
            setActive(item.tabId);
            if (line) {
                const editor = getActiveEditor();
                editor?.setPosition({ lineNumber: line, column: 1 });
                editor?.revealLineInCenter(line);
            }
        }
        getActiveEditor()?.focus();
    }

    return { open, close, score };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = QuickOpen;
else window.QuickOpen = QuickOpen;
