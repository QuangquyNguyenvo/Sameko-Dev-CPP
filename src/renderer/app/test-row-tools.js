/** Debug, checks, graph and profiling actions for an individual TESTS row. */
const TestRowTools = (() => {
    'use strict';

    const labels = {
        debug: 'Debug this test',
        checks: 'Re-run with checks',
        graph: 'View input as a graph',
        profile: 'Profile with test input',
    };
    const icons = {
        debug: '<use href="#i-bug-duo"/>',
        checks: '<use href="#i-warning-circle-duo"/>',
        // Filled shapes only: the app's .ico rule turns every stroke off.
        graph: '<circle cx="60" cy="72" r="26" opacity=".2"/><circle cx="196" cy="52" r="26" opacity=".2"/><circle cx="84" cy="196" r="26" opacity=".2"/><circle cx="200" cy="180" r="26" opacity=".2"/><path fill-rule="evenodd" d="M34 72a26 26 0 1 0 52 0a26 26 0 1 0 -52 0Z M48 72a12 12 0 1 0 24 0a12 12 0 1 0 -24 0Z M170 52a26 26 0 1 0 52 0a26 26 0 1 0 -52 0Z M184 52a12 12 0 1 0 24 0a12 12 0 1 0 -24 0Z M58 196a26 26 0 1 0 52 0a26 26 0 1 0 -52 0Z M72 196a12 12 0 1 0 24 0a12 12 0 1 0 -24 0Z M174 180a26 26 0 1 0 52 0a26 26 0 1 0 -52 0Z M188 180a12 12 0 1 0 24 0a12 12 0 1 0 -24 0Z"/><path d="M86.7 75.1L171.3 62.7L169.3 48.9L84.7 61.3ZM58.1 98.9L72.2 171.8L85.9 169.1L71.8 96.2ZM189.8 78.2L192.2 154.2L206.2 153.8L203.8 77.8ZM110.7 199.4L175.2 190.5L173.3 176.6L108.8 185.5ZM76.3 93.4L175.1 169.7L183.7 158.6L84.9 82.3Z"/>',
        profile: '<use href="#i-timer-duo"/>',
    };
    const GRAPH_NODES = 300;
    const GRAPH_EDGES = 1500;
    const GRAPH_CHARS = 512 * 1024;
    const GRAPH_WIDTH = 820;
    const GRAPH_HEIGHT = 460;
    const NO_CHECKS = new Set(['AC', 'RAN', 'PENDING', 'SKIPPED']);
    const integer = token => /^[-+]?\d+$/.test(token) ? Number(token) : NaN;
    let startingDebug = false;

    function buttons(tab, result) {
        const cpp = tab && isCppTab(tab);
        const actions = ['graph'];
        if (cpp) {
            actions.unshift('debug');
            if (result?.status && !NO_CHECKS.has(result.status)) actions.push('checks');
            actions.push('profile');
        }
        return actions.map(action => {
            const label = escHtml(labels[action]);
            return `<button type="button" class="test-tool-btn" data-test-tool="${action}" title="${label}" aria-label="${label}">
                <svg class="ico" width="16" height="16" viewBox="0 0 256 256" aria-hidden="true">${icons[action]}</svg>
            </button>`;
        }).join('');
    }

    function openDialog(title, number) {
        const dialog = document.createElement('dialog');
        dialog.className = 'test-tool-dialog';
        dialog.setAttribute('aria-labelledby', 'test-tool-title');
        dialog.innerHTML = `
            <header><div><h2 id="test-tool-title"></h2><p></p></div>
                <form method="dialog"><button type="submit" class="test-tool-close" title="Close (Esc)" aria-label="Close">
                    <svg class="ico" width="14" height="14" aria-hidden="true"><use href="#i-x"/></svg></button></form>
            </header>
            <div class="test-tool-body"></div>`;
        dialog.querySelector('h2').textContent = title;
        dialog.querySelector('header p').textContent = I18n.t('Test {0}', number);
        dialog.addEventListener('close', () => dialog.remove());
        document.body.appendChild(dialog);
        return { dialog, body: dialog.querySelector('.test-tool-body') };
    }

    function appendText(parent, tag, text, className) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        el.textContent = text;
        parent.appendChild(el);
        return el;
    }

    function appendOutput(parent, title, value) {
        if (!value) return;
        appendText(parent, 'h3', title);
        const cap = 65536;
        const output = appendText(parent, 'pre', value.slice(0, cap));
        output.translate = false;
        output.tabIndex = 0;
        if (value.length > cap) appendText(parent, 'p', I18n.t('Showing the first {0} characters', cap));
    }

    async function runAction(action, idx) {
        const problem = ccProblem;
        const test = problem?.tests?.[idx];
        if (!test) return;
        const input = test.input || '';
        if (action === 'graph') {
            showGraph(input, idx + 1);
            return;
        }
        const tab = App.tabs.find(candidate => candidate.id === getPreferredTabId());
        if (!tab || !isCppTab(tab)) return;
        if (isBatchTesting || isBuilding || startingDebug) {
            showToast(I18n.t('Wait for the current build or test to finish.'), 'warning');
            return;
        }
        if (Debugger.isActive()) {
            showToast(I18n.t('Stop the current debug session first.'), 'warning');
            return;
        }
        const changed = externalChangeBlocksBuild(tab.path);
        if (changed) {
            log(changed, 'warning');
            return;
        }
        if (action === 'debug') {
            startingDebug = true;
            try {
                await Debugger.startTest(tab, input);
            } catch (err) {
                log(I18n.t('Could not debug this test.'), 'error');
                log(err.message, 'error');
            } finally {
                startingDebug = false;
            }
            return;
        }

        // The build writes the tab's text to its file, as Run Tests does: not over a newer copy.
        const changedOnDisk = externalChangeBlocksBuild(tab.path);
        if (changedOnDisk) { log(changedOnDisk, 'warning'); return; }

        const { dialog, body } = openDialog(labels[action], idx + 1);
        const status = appendText(body, 'p', 'Building and running this test…');
        status.setAttribute('role', 'status');
        dialog.showModal();
        isBatchTesting = true;
        try {
            const result = await window.electronAPI.runInstrumentedTest({
                mode: action, filePath: tab.path, untitledId: tab.path ? '' : tab.id,
                content: tabSourceText(tab), flags: buildCompileFlags(),
                singleFileMode: App.settings.compiler.singleFileMode !== false,
                input, timeLimit: problem.timeLimit || App.settings.execution.timeLimitSeconds * 1000,
            });
            status.textContent = result.issue ? I18n.t(result.issue) : result.run?.status !== 'RAN'
                ? I18n.t('Run stopped ({0})', result.run?.status) : I18n.t('Run finished');
            if (action === 'checks' && !result.issue) {
                appendText(body, 'p', result.sanitizers ? 'STL checks, AddressSanitizer and UBSan enabled.' : 'STL debug checks enabled.');
            }
            appendOutput(body, 'Flat profile (top 15 functions)', result.profile);
            appendOutput(body, 'Diagnostics', result.detail || result.run?.error
                || (result.run?.status !== 'RAN' ? result.run?.details : ''));
            if (action === 'checks') {
                appendOutput(body, 'Program output', result.run?.output);
                if (!result.issue && result.run?.status === 'RAN' && !result.run.error) {
                    appendText(body, 'p', 'No diagnostics were reported.');
                }
            }
        } catch (err) {
            status.textContent = I18n.t('Could not run the test.');
            appendOutput(body, 'Diagnostics', err.message);
        } finally {
            isBatchTesting = false;
        }
    }

    /**
     * Reads a graph from a test's input. format: 'nm' (a line "n m ...", then m edges),
     * 'n' (a line "n ...", then edges), 'parents' (a line "n", then the parent of each node),
     * 'edges' (edge lines only; n is the largest node number). Numbers after n (or n m) on the
     * first line are ignored, and so are the lines after the m edges (queries). With multi, the
     * first line is the number of test cases and testIndex picks one: each test then takes its
     * header and m edges ('nm'), n-1 edges ('n', a tree) or n-1 / n parents ('parents').
     */
    function parseGraph(input, { format, base, multi = false, testIndex = 0 }) {
        const result = { count: 0, edges: [], issues: [], unparsed: [], unparsedCount: 0, ignored: 0, tests: 0 };
        if (input.length > GRAPH_CHARS) {
            result.issues.push(['Graph input exceeds {0} characters.', GRAPH_CHARS]);
            return result;
        }
        let lines = input.split(/\r?\n/).map((raw, i) => ({ line: i + 1, text: raw.trim() })).filter(item => item.text);
        if (multi) {
            const blocks = splitTestCases(lines, format);
            if (!blocks) {
                result.issues.push(['The first line is not a number of test cases.']);
                return result;
            }
            result.tests = blocks.tests.length;
            result.declaredTests = blocks.declared;
            result.ignored = blocks.rest;
            if (!blocks.tests.length) {
                result.issues.push(['No test case could be read.']);
                return result;
            }
            lines = blocks.tests[Math.min(Math.max(0, testIndex), blocks.tests.length - 1)];
        }
        return parseBlock(lines, format, base, result);
    }

    const tokensOf = line => line.text.split(/\s+/);

    /** The lines of each test case, or null when the first line is not a count. */
    function splitTestCases(lines, format) {
        const first = lines[0] && tokensOf(lines[0]);
        const t = first && first.length === 1 ? integer(first[0]) : NaN;
        if (!Number.isSafeInteger(t) || t < 1 || format === 'edges') return null;
        const tests = [];
        let i = 1;
        while (tests.length < t && i < lines.length) {
            const [n, m] = tokensOf(lines[i]).map(integer);
            if (!Number.isSafeInteger(n) || n < 1) break;
            let size;
            if (format === 'nm') size = Number.isSafeInteger(m) && m >= 0 ? 1 + m : NaN;
            else if (format === 'n') size = n;   // n, then the n-1 edges of a tree
            else {
                // n, then n-1 or n parents, on one line or several
                let have = 0;
                size = 1;
                while (i + size < lines.length && have < n - 1) have += tokensOf(lines[i + size++]).length;
            }
            if (!Number.isFinite(size)) break;
            tests.push(lines.slice(i, i + size));
            i += size;
        }
        return { tests, rest: Math.max(0, lines.length - i), declared: t };
    }

    function parseBlock(lines, format, base, result) {
        const mark = ({ line, text }) => {
            result.unparsedCount++;
            if (result.unparsed.length < 30) result.unparsed.push({ line, text: text.slice(0, 120) });
        };
        let n;
        let m;
        if (format === 'edges') {
            // No header: the nodes are numbered up to the largest number seen.
            n = 0;
            for (const line of lines) {
                const [u, v] = tokensOf(line).map(integer);
                if (Number.isSafeInteger(u) && Number.isSafeInteger(v)) n = Math.max(n, u + 1 - base, v + 1 - base);
            }
            if (n < 1) {
                result.issues.push(['Expected edge lines u v.']);
                return result;
            }
        } else {
            const header = lines.shift();
            const fields = header ? tokensOf(header) : [];
            [n, m] = fields.map(integer);
            const counted = format === 'nm';
            if (!Number.isSafeInteger(n) || n < 1 || (counted && (!Number.isSafeInteger(m) || m < 0))
                    || (format === 'parents' && fields.length !== 1)) {
                if (header) mark(header);
                result.issues.push([counted ? 'Expected a header with n m.' : 'Expected a header with n.']);
                return result;
            }
        }
        if (n > GRAPH_NODES) {
            result.issues.push(['Draw up to {0} nodes.', GRAPH_NODES]);
            return result;
        }
        result.count = n;
        const node = token => {
            const id = integer(token) - base;
            return id >= 0 && id < n ? id : NaN;
        };

        if (format === 'parents') {
            const values = lines.flatMap(line => tokensOf(line).map(token => ({ token, line })));
            const omitFirst = values.length === n - 1;
            if (!omitFirst && values.length !== n) {
                result.issues.push(['Expected {0} or {1} parent entries. Found {2}.', n - 1, n, values.length]);
                result.count = 0;
                return result;
            }
            const bad = new Set();
            values.forEach(({ token, line }, i) => {
                const id = integer(token);
                if (!omitFirst && (id === -1 || (base === 1 && id === 0))) return;
                const from = node(token);
                if (Number.isNaN(from)) bad.add(line);
                else result.edges.push({ from, to: i + Number(omitFirst) });
            });
            bad.forEach(mark);
            return result;
        }

        const counted = format === 'nm';
        const supplied = counted ? Math.min(m, lines.length) : lines.length;
        if (counted && lines.length < m) result.issues.push(['Expected {0} edge lines. Found {1}.', m, lines.length]);
        if (supplied > GRAPH_EDGES) result.issues.push(['Only the first {0} edge lines are shown.', GRAPH_EDGES]);
        // Lines after the m edges are the rest of the input (queries...), not broken edges.
        result.ignored += lines.length - supplied;
        for (const [i, line] of lines.entries()) {
            if (i >= supplied) break;
            if (i >= GRAPH_EDGES) continue;
            const parts = tokensOf(line);
            const [u, v, weight] = parts;
            const from = node(u);
            const to = node(v);
            const validWeight = weight === undefined || (
                /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(weight) && Number.isFinite(Number(weight))
            );
            if (parts.length < 2 || parts.length > 3 || Number.isNaN(from) || Number.isNaN(to) || !validWeight) mark(line);
            else result.edges.push({ from, to, weight });
        }
        return result;
    }

    /**
     * A tree or forest drawn top-down: each root (smallest number) on top, children one layer
     * below, leaves spaced evenly and a parent centred over its children, so no edge crosses.
     * null when the graph has a cycle, or when most nodes are isolated (a force layout fits better).
     */
    function treeLayout(count, edges) {
        const parent = Array.from({ length: count }, (_, i) => i);
        const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
        const adjacent = Array.from({ length: count }, () => new Set());
        let links = 0;
        for (const { from, to } of edges) {
            if (from === to || adjacent[from].has(to)) continue;
            const a = find(from);
            const b = find(to);
            if (a === b) return null;   // a cycle
            parent[a] = b;
            adjacent[from].add(to);
            adjacent[to].add(from);
            links++;
        }
        if (!links || links < count / 2) return null;
        const GAP = 64;
        const LAYER = 84;
        const nodes = Array.from({ length: count }, () => ({ x: 0, y: 0, dx: 0, dy: 0 }));
        const seen = new Array(count).fill(false);
        let slot = 0;
        for (let root = 0; root < count; root++) {
            if (seen[root]) continue;
            // Breadth-first for depths and children, then leaves left to right.
            const children = new Map();
            const order = [root];
            seen[root] = true;
            nodes[root].y = 40;
            for (let k = 0; k < order.length; k++) {
                const u = order[k];
                const kids = [...adjacent[u]].filter(v => !seen[v]).sort((a, b) => a - b);
                kids.forEach(v => { seen[v] = true; nodes[v].y = nodes[u].y + LAYER; order.push(v); });
                children.set(u, kids);
            }
            // Leaves get slots in depth-first order, so a subtree's leaves sit together.
            const stack = [root];
            const leafX = new Map();
            while (stack.length) {
                const u = stack.pop();
                const kids = children.get(u);
                if (!kids.length) leafX.set(u, 40 + slot++ * GAP);
                for (let k = kids.length - 1; k >= 0; k--) stack.push(kids[k]);
            }
            for (let k = order.length - 1; k >= 0; k--) {
                const u = order[k];
                const kids = children.get(u);
                nodes[u].x = kids.length ? (nodes[kids[0]].x + nodes[kids[kids.length - 1]].x) / 2 : leafX.get(u);
            }
            slot++;   // a gap before the next tree
        }
        return nodes;
    }

    function layoutGraph(count, edges, random) {
        if (!random) {
            const tree = treeLayout(count, edges);
            if (tree) return tree;
        }
        const cx = GRAPH_WIDTH / 2;
        const cy = GRAPH_HEIGHT / 2;
        const nodes = Array.from({ length: count }, (_, i) => {
            // An even spiral gives isolated nodes room as well as connected ones.
            const angle = i * Math.PI * (3 - Math.sqrt(5)) + (random ? random() * 6.283 : 0);
            const radius = random ? 0.2 + random() * 0.8 : Math.sqrt(i / count);
            return { x: cx + Math.cos(angle) * radius * cx * 0.85, y: cy + Math.sin(angle) * radius * cy * 0.85, dx: 0, dy: 0 };
        });
        if (count <= 1) return nodes;
        const spacing = Math.min(130, Math.sqrt(GRAPH_WIDTH * GRAPH_HEIGHT / count) * 0.8);
        const rounds = count <= 80 ? 220 : 90;
        for (let iteration = 0; iteration < rounds; iteration++) {
            for (const p of nodes) {
                p.dx = (cx - p.x) * 0.025;
                p.dy = (cy - p.y) * 0.025;
            }
            for (let i = 0; i < count; i++) {
                const a = nodes[i];
                for (let j = i + 1; j < count; j++) {
                    const b = nodes[j];
                    const x = a.x - b.x;
                    const y = a.y - b.y;
                    const square = Math.max(1, x * x + y * y);
                    const force = spacing * spacing * 0.6 / (square * Math.sqrt(square));
                    a.dx += x * force;
                    a.dy += y * force;
                    b.dx -= x * force;
                    b.dy -= y * force;
                }
            }
            for (const { from, to } of edges) {
                if (from === to) continue;
                const a = nodes[from];
                const b = nodes[to];
                const x = b.x - a.x;
                const y = b.y - a.y;
                const distance = Math.max(1, Math.hypot(x, y));
                const force = (distance - spacing) * 0.05 / distance;
                a.dx += x * force;
                a.dy += y * force;
                b.dx -= x * force;
                b.dy -= y * force;
            }
            const step = 12 * (1 - iteration / rounds);
            for (const p of nodes) {
                p.x = Math.max(40, Math.min(GRAPH_WIDTH - 40, p.x + Math.max(-step, Math.min(step, p.dx))));
                p.y = Math.max(40, Math.min(GRAPH_HEIGHT - 40, p.y + Math.max(-step, Math.min(step, p.dy))));
            }
        }
        return nodes;
    }

    function svg(tag, attrs, text) {
        const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
        if (text !== undefined) el.textContent = text;
        return el;
    }

    /**
     * The reading that fits the input best: fewest unread lines, then fewest problems and
     * skipped lines. Several test cases that use up the input exactly ("t", then t graphs) win
     * over reading it as one graph; a header is preferred over a bare edge list.
     */
    function guessGraphFormat(input) {
        let best = null;
        for (const multi of [false, true]) {
            for (const format of ['nm', 'n', 'parents', 'edges']) {
                if (multi && format === 'edges') continue;
                for (const base of [1, 0]) {
                    const g = parseGraph(input, { format, base, multi });
                    if (!g.count || (g.issues.length && !g.edges.length)) continue;
                    const exactTests = multi && g.tests === g.declaredTests && !g.ignored;
                    const score = g.unparsedCount * 1000 + g.issues.length * 100 + g.ignored * 20
                        + (format === 'edges' ? 50 : 0) - (exactTests ? 500 : 0) - g.edges.length;
                    if (!best || score < best.score) best = { format, base, multi, score };
                }
            }
        }
        return best || { format: 'nm', base: 1, multi: false };
    }

    /** The same edge listed more than once (u v and v u when undirected): one line, with ×k. */
    function mergeEdges(edges, directed) {
        const map = new Map();
        for (const e of edges) {
            const key = directed || e.from <= e.to ? `${e.from}>${e.to}` : `${e.to}>${e.from}`;
            const item = map.get(key) || { from: e.from, to: e.to, count: 0, weights: [] };
            item.count++;
            if (e.weight !== undefined && !item.weights.includes(e.weight)) item.weights.push(e.weight);
            map.set(key, item);
        }
        return [...map.values()];
    }

    function edgeLabel({ count, weights }) {
        let text = weights.map(w => (w.length > 12 ? Number(w).toPrecision(6) : w)).slice(0, 3).join(', ');
        if (weights.length > 3) text += ', …';
        if (count > 1) text = (text ? text + ' ' : '') + '×' + count;
        return text;
    }

    /**
     * The graph as an SVG the user can work with: drag a node to move it, drag the background
     * to pan, scroll to zoom; Fit and Shuffle in the corner; hovering a node lights up its edges.
     */
    function drawGraph({ count, edges }, base, directed, summary, notes = []) {
        const wrap = document.createElement('div');
        wrap.className = 'test-graph-wrap';
        const board = svg('svg', { class: 'test-graph', role: 'img', 'aria-label': summary });
        board.setAttribute('translate', 'no');
        const radius = count > 100 ? 10 : count > 30 ? 13 : 16;
        let nodes = layoutGraph(count, edges);
        const merged = mergeEdges(edges, directed);
        const adjacent = Array.from({ length: count }, () => new Set());
        merged.forEach((e, i) => { adjacent[e.from].add(i); adjacent[e.to].add(i); });

        if (directed) {
            const marker = svg('marker', { id: 'test-graph-arrow', viewBox: '0 0 10 10', markerWidth: 4.5, markerHeight: 4.5, refX: 9, refY: 5, orient: 'auto-start-reverse' });
            marker.append(svg('path', { d: 'M0,0 L10,5 L0,10 Z' }));
            const defs = svg('defs', {});
            defs.append(marker);
            board.append(defs);
        }
        const edgeLayer = svg('g', {});
        const labelLayer = svg('g', {});
        const nodeLayer = svg('g', {});
        board.append(edgeLayer, labelLayer, nodeLayer);

        const edgeEls = merged.map(e => {
            const el = svg(e.from === e.to ? 'path' : 'line', { class: 'test-graph-edge' + (e.count > 1 ? ' multi' : '') });
            if (directed) el.setAttribute('marker-end', 'url(#test-graph-arrow)');
            edgeLayer.append(el);
            const text = edgeLabel(e);
            let label = null;
            if (text) {
                label = svg('text', { class: 'test-graph-weight', 'dominant-baseline': 'central' }, text);
                if (e.weights.some(w => w.length > 12)) label.append(svg('title', {}, e.weights.join(', ').slice(0, 200)));
                labelLayer.append(label);
            }
            return { el, label };
        });
        const degree = Array(count).fill(0);
        for (const e of edges) { degree[e.from]++; if (e.to !== e.from) degree[e.to]++; }
        const nodeEls = nodes.map((_, i) => {
            const g = svg('g', { class: 'test-graph-node' });
            g.append(svg('circle', { r: radius }), svg('text', { 'dominant-baseline': 'central' }, String(i + base)));
            g.append(svg('title', {}, I18n.t('Node {0} · degree {1}', i + base, degree[i])));
            nodeLayer.append(g);
            return g;
        });

        function place() {
            merged.forEach((e, i) => {
                const a = nodes[e.from];
                const b = nodes[e.to];
                const { el, label } = edgeEls[i];
                let lx;
                let ly;
                if (e.from === e.to) {
                    const r = radius;
                    el.setAttribute('d', `M${a.x - r * 0.5},${a.y - r * 0.85} C${a.x - r * 2.2},${a.y - r * 3.4} ${a.x + r * 2.2},${a.y - r * 3.4} ${a.x + r * 0.5},${a.y - r * 0.85}`);
                    lx = a.x;
                    ly = a.y - r * 3.1;
                } else {
                    const dx = b.x - a.x;
                    const dy = b.y - a.y;
                    const length = Math.max(1, Math.hypot(dx, dy));
                    const start = Math.min(radius, length / 3);
                    const end = Math.min(radius + (directed ? 2 : 0), length / 3);
                    el.setAttribute('x1', a.x + dx / length * start);
                    el.setAttribute('y1', a.y + dy / length * start);
                    el.setAttribute('x2', b.x - dx / length * end);
                    el.setAttribute('y2', b.y - dy / length * end);
                    lx = (a.x + b.x) / 2;
                    ly = (a.y + b.y) / 2;
                }
                if (label) { label.setAttribute('x', lx); label.setAttribute('y', ly); }
            });
            nodes.forEach((p, i) => nodeEls[i].setAttribute('transform', `translate(${p.x},${p.y})`));
        }

        // The view box: fitted around the nodes; pan and zoom change it.
        let view = { x: 0, y: 0, w: GRAPH_WIDTH, h: GRAPH_HEIGHT };
        const setView = () => board.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
        function fit() {
            const pad = radius * 3;
            const xs = nodes.map(p => p.x);
            const ys = nodes.map(p => p.y);
            const x0 = Math.min(...xs) - pad;
            const x1 = Math.max(...xs) + pad;
            const y0 = Math.min(...ys) - pad * 1.4;
            const y1 = Math.max(...ys) + pad;
            // Keep the box near the canvas's shape, so a few nodes are not blown up.
            const w = Math.max(x1 - x0, (y1 - y0) * 1.6, 600);
            const h = Math.max(y1 - y0, w / 1.9, 320);
            view = { x: (x0 + x1 - w) / 2, y: (y0 + y1 - h) / 2, w, h };
            setView();
        }
        const toSvg = (event) => {
            const pt = board.createSVGPoint();
            pt.x = event.clientX;
            pt.y = event.clientY;
            return pt.matrixTransform(board.getScreenCTM().inverse());
        };

        let drag = null;   // { node, dx, dy } or { pan: true, x, y }
        board.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return;
            const g = event.target.closest('.test-graph-node');
            if (g) {
                const i = nodeEls.indexOf(g);
                const p = toSvg(event);
                drag = { node: i, dx: nodes[i].x - p.x, dy: nodes[i].y - p.y };
            } else {
                drag = { pan: true, x: event.clientX, y: event.clientY };
            }
            board.setPointerCapture(event.pointerId);
            board.classList.add(g ? 'dragging-node' : 'panning');
            event.preventDefault();
        });
        board.addEventListener('pointermove', (event) => {
            if (!drag) return;
            if (drag.pan) {
                const scale = view.w / Math.max(1, board.clientWidth);
                view.x -= (event.clientX - drag.x) * scale;
                view.y -= (event.clientY - drag.y) * scale;
                drag.x = event.clientX;
                drag.y = event.clientY;
                setView();
            } else {
                const p = toSvg(event);
                nodes[drag.node].x = p.x + drag.dx;
                nodes[drag.node].y = p.y + drag.dy;
                place();
            }
        });
        const endDrag = () => { drag = null; board.classList.remove('dragging-node', 'panning'); };
        board.addEventListener('pointerup', endDrag);
        board.addEventListener('pointercancel', endDrag);
        board.addEventListener('wheel', (event) => {
            event.preventDefault();
            const p = toSvg(event);
            const w = Math.min(GRAPH_WIDTH * 20, Math.max(radius * 6, view.w * (event.deltaY > 0 ? 1.15 : 1 / 1.15)));
            const s = w / view.w;
            view = { x: p.x - (p.x - view.x) * s, y: p.y - (p.y - view.y) * s, w, h: view.h * s };
            setView();
        }, { passive: false });

        // Hovering a node: its edges and neighbours stay bright, the rest fades.
        nodeEls.forEach((g, i) => {
            g.addEventListener('pointerenter', () => {
                if (drag) return;
                board.classList.add('focus');
                g.classList.add('hl', 'hover');
                for (const k of adjacent[i]) {
                    edgeEls[k].el.classList.add('hl');
                    edgeEls[k].label?.classList.add('hl');
                    nodeEls[merged[k].from].classList.add('hl');
                    nodeEls[merged[k].to].classList.add('hl');
                }
            });
            g.addEventListener('pointerleave', () => {
                if (drag) return;
                board.classList.remove('focus');
                board.querySelectorAll('.hl').forEach(el => el.classList.remove('hl', 'hover'));
            });
        });

        const tools = document.createElement('div');
        tools.className = 'test-graph-tools';
        // Words, not icons: four corners read as "full screen", arrows as "reload".
        const tool = (label, title, onClick) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'test-graph-tool';
            b.textContent = label;
            b.title = title;
            b.addEventListener('click', onClick);
            tools.append(b);
            return b;
        };
        tool('Fit to view', 'Show the whole graph in the canvas', fit);
        tool('Shuffle layout', 'Place the nodes again at random', () => { nodes = layoutGraph(count, edges, Math.random); place(); fit(); });
        const help = document.createElement('p');
        help.className = 'test-graph-help';
        help.textContent = 'Drag a node to move it · drag the background to pan · scroll to zoom';
        if (merged.some(e => e.count > 1)) notes.push(I18n.t('×3 = the same pair of nodes is joined by 3 edges'));
        for (const note of notes) appendText(help, 'span', note, 'test-graph-note');

        wrap.append(board, tools, help);
        place();
        fit();
        return wrap;
    }

    function showGraph(input, number) {
        const { dialog, body } = openDialog(labels.graph, number);
        // The case picker sits next to "Test N" under the title: Test 2 › Case ‹ 3 / 12 › .
        const sub = dialog.querySelector('header p');
        const picker = document.createElement('span');
        picker.className = 'test-graph-cases';
        picker.hidden = true;
        picker.innerHTML = `
            <span class="test-graph-cases-sep" aria-hidden="true">›</span>
            <span class="test-graph-cases-label">Case</span>
            <button type="button" class="test-graph-step" data-step="-1" title="Previous case" aria-label="Previous case">‹</button>
            <select class="test-graph-case" aria-label="Case"></select>
            <button type="button" class="test-graph-step" data-step="1" title="Next case" aria-label="Next case">›</button>`;
        sub.append(picker);
        const caseSelect = picker.querySelector('select');

        body.innerHTML = `
            <form class="test-graph-options">
                <label><span>Read the input as</span><select name="format" class="test-tool-control">
                    <option value="nm">n m, then m edges u v [w]</option>
                    <option value="n">n, then edges u v [w]</option>
                    <option value="parents">n, then a parent array</option>
                    <option value="edges">Edges u v [w] only, no first line</option>
                </select></label>
                <label><span>Test cases</span><select name="multi" class="test-tool-control">
                    <option value="0">One case</option>
                    <option value="1">Several (first line is t)</option>
                </select></label>
                <label><span>Edge direction</span><select name="direction" class="test-tool-control">
                    <option value="undirected">Undirected</option><option value="directed">Directed</option>
                </select></label>
                <label><span>Node numbering</span><select name="base" class="test-tool-control">
                    <option value="1">1-indexed</option><option value="0">0-indexed</option>
                </select></label>
                <span class="test-graph-summary" aria-live="polite"></span>
            </form>
            <p class="test-graph-parent-hint" hidden>Enter n−1 parents (skip the first node) or n parents (use −1 for a root, or 0 with 1-indexed nodes).</p>
            <p class="test-graph-multi-hint" hidden>Each case: its first line, then m edges (n m) or n−1 edges (n, a tree).</p>
            <div class="test-graph-result"></div>`;
        const form = body.querySelector('form');
        const format = form.elements.format;
        const multiSel = form.elements.multi;
        const parentHint = body.querySelector('.test-graph-parent-hint');
        const multiHint = body.querySelector('.test-graph-multi-hint');
        const result = body.querySelector('.test-graph-result');
        const summaryEl = body.querySelector('.test-graph-summary');
        // Start from the reading that fits the input best, drawn at once; any change redraws.
        const guess = guessGraphFormat(input);
        format.value = guess.format;
        form.elements.base.value = String(guess.base);
        multiSel.value = guess.multi ? '1' : '0';
        let caseIndex = 0;

        const options = () => ({
            format: format.value,
            base: Number(form.elements.base.value),
            multi: multiSel.value === '1' && format.value !== 'edges',
        });

        // One entry per case: "Case 3 · 15 nodes · 14 edges".
        const fillCases = () => {
            const opts = options();
            const first = parseGraph(input, { ...opts, testIndex: 0 });
            const total = opts.multi ? first.tests : 0;
            picker.hidden = total < 2;
            caseSelect.replaceChildren();
            for (let k = 0; k < total; k++) {
                const g = k ? parseGraph(input, { ...opts, testIndex: k }) : first;
                const option = document.createElement('option');
                option.value = String(k);
                option.textContent = `${k + 1} / ${total}` + ' · ' + I18n.t('{0} nodes · {1} edges', g.count, g.edges.length);
                caseSelect.append(option);
            }
            caseIndex = Math.min(caseIndex, Math.max(0, total - 1));
            caseSelect.value = String(caseIndex);
            picker.querySelectorAll('.test-graph-step').forEach(b => {
                b.disabled = Number(b.dataset.step) < 0 ? caseIndex === 0 : caseIndex >= total - 1;
            });
        };

        const draw = () => {
            const opts = options();
            parentHint.hidden = opts.format !== 'parents';
            multiHint.hidden = !opts.multi;
            multiSel.disabled = opts.format === 'edges';
            const directed = form.elements.direction.value === 'directed';
            const graph = parseGraph(input, { ...opts, testIndex: caseIndex });
            result.replaceChildren();
            summaryEl.textContent = '';
            for (const [message, ...args] of graph.issues) appendText(result, 'p', I18n.t(message, ...args), 'test-graph-issue');
            if (graph.unparsedCount) {
                const details = document.createElement('details');
                details.className = 'test-graph-unparsed';
                appendText(details, 'summary', I18n.t('Could not parse {0} input line(s)', graph.unparsedCount));
                const list = appendText(details, 'ul', '');
                for (const { line, text } of graph.unparsed) {
                    const item = appendText(list, 'li', '');
                    appendText(item, 'span', I18n.t('Line {0}', line), 'test-graph-line-no');
                    appendText(item, 'code', text).translate = false;
                }
                if (graph.unparsed.length < graph.unparsedCount) appendText(details, 'p', I18n.t('Showing the first {0} unparsed lines', graph.unparsed.length));
                result.appendChild(details);
            }
            if (graph.count) {
                const summary = I18n.t('{0} nodes · {1} edges', graph.count, graph.edges.length);
                summaryEl.textContent = summary;
                const notes = [];
                if (graph.ignored) notes.push(I18n.t('Read {0} edges · skipped {1} line(s) after them', graph.edges.length, graph.ignored));
                result.appendChild(drawGraph(graph, opts.base, directed, summary, notes));
            }
        };
        const redraw = () => { fillCases(); draw(); };
        const goTo = (k) => { caseIndex = k; fillCases(); draw(); };
        form.addEventListener('change', (event) => { if (event.target !== caseSelect) { caseIndex = 0; redraw(); } });
        form.addEventListener('submit', event => { event.preventDefault(); draw(); });
        caseSelect.addEventListener('change', () => goTo(Number(caseSelect.value)));
        picker.querySelectorAll('.test-graph-step').forEach(b => b.addEventListener('click', () => goTo(caseIndex + Number(b.dataset.step))));
        redraw();
        dialog.showModal();
    }

    return { buttons, runAction, parseGraph, layoutGraph, treeLayout, guessGraphFormat, mergeEdges };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = TestRowTools;
else window.TestRowTools = TestRowTools;
