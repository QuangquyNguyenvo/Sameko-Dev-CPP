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
    const isWeight = token => /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(token) && Number.isFinite(Number(token));
    let startingDebug = false;

    function bindGraphButton(button, onClick) {
        if (!button) return;
        button.querySelector('svg').innerHTML = icons.graph;
        button.addEventListener('click', onClick);
    }

    function init() {
        bindGraphButton(document.getElementById('btn-test-graph'), () => showGraph());
    }

    async function showInputGraph() {
        const tabId = getPreferredTabId();
        const attached = getTabInputFile(tabId);
        if (!attached) {
            showGraph(document.getElementById('input-area').value);
            return;
        }
        try {
            const input = await window.electronAPI.readFile(attached);
            if (getPreferredTabId() === tabId && getTabInputFile(tabId) === attached) showGraph(input || '');
        } catch (_) {
            showToast('Cannot read this file', 'warning');
        }
    }

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
        if (number != null) dialog.querySelector('header p').textContent = I18n.t('Test {0}', number);
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
            const tabId = getPreferredTabId();
            const text = test.inputPath ? await window.electronAPI.readFile(test.inputPath).catch(() => '') : input;
            if (getPreferredTabId() === tabId && ccProblem === problem && problem.tests[idx] === test) {
                showGraph(text || '', idx + 1, { problem, test });
            }
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
                await Debugger.startTest(tab, input, await testDebugOptions(problem, test, tabSourceText(tab)));
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
                input, inputPath: test.inputPath || '', fileIO: problemFileIO(problem, tabSourceText(tab)),
                timeLimit: problem.timeLimit || App.settings.execution.timeLimitSeconds * 1000,
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
     * 'n' (a line "n ...", then edges), 'tree' (n−1 edges, with optional queries or vertex data),
     * 'parents' (a parent array, optionally followed by labels and queries),
     * 'edges' (edge lines only; n is the largest node number), or 'matrix' (n rows of n values,
     * optionally preceded by n). With multi, the first line is the number of test cases and
     * each case has its own header. Reuse the reader to switch cases without splitting the input again.
     */
    function graphReader(input, { format, base, multi, directed, skip = 0 }, preparedLines) {
        skip = format === 'edges' || format === 'matrix' || !Number.isSafeInteger(skip) || skip < 0 ? 0 : skip;
        let lines = [];
        let blocks;
        let issue;
        if (input.length > GRAPH_CHARS) {
            issue = ['Graph input exceeds {0} characters.', GRAPH_CHARS];
        } else {
            lines = preparedLines || graphLines(input);
            if (multi) {
                blocks = splitGraphCases(lines, format, skip);
                if (!blocks) issue = ['The first line is not a number of test cases.'];
                else if (!blocks.tests.length) issue = ['No test case could be read.'];
            }
        }
        return (testIndex = 0) => {
            const result = { count: 0, edges: [], issues: [], unparsed: [], unparsedCount: 0, ignored: 0, tests: 0 };
            if (blocks) {
                result.tests = blocks.tests.length;
                result.declaredTests = blocks.declared;
                result.ignored = blocks.rest;
                result.remainingLines = blocks.rest;
            }
            if (issue) {
                result.issues.push(issue);
                return result;
            }
            const block = blocks ? blocks.tests[Math.min(Math.max(0, testIndex), result.tests - 1)] : lines;
            if (format === 'tree' || skip || blocks?.alternateFraming) result.graphOnly = true;
            return parseBlock(block, { format, base, multi, directed, skip }, result);
        };
    }

    function parseGraph(input, { testIndex, ...options }) {
        return graphReader(input, options)(testIndex);
    }

    const tokensOf = line => line.text.split(/\s+/);
    const isBinaryRow = (text, size) => size > 1 && text.length === size && /^[01]+$/.test(text);
    const isCount = value => Number.isSafeInteger(value) && value >= 0;
    const lineCount = line => line ? integer(line.text) : NaN;

    function isVertexData(line, n) {
        if (!line) return false;
        const values = tokensOf(line);
        return values.length === n && values.every(isWeight)
            || line.text.length === n && /^[a-z]+$/i.test(line.text);
    }

    function graphLines(input) {
        return input.split(/\r?\n/).map((raw, i) => ({ line: i + 1, text: raw.trim() })).filter(item => item.text);
    }

    /** The lines of each test case, or null when the first line is not a count. */
    function splitTestCases(lines, format, { skip = 0, tail = '', fullParents = false, headerMetadata = false } = {}) {
        const first = lines[0] && tokensOf(lines[0]);
        const t = first && first.length === 1 ? integer(first[0]) : NaN;
        if (!Number.isSafeInteger(t) || t < 1 || format === 'edges') return null;
        const tests = [];
        let i = 1;
        while (tests.length < t && i < lines.length) {
            const fields = tokensOf(lines[i]);
            const [n, m] = fields.map(integer);
            if (!Number.isSafeInteger(n) || n < 1 || (format === 'parents' && fields.length > 2)) break;
            if (headerMetadata && (fields.length !== 2 || !isCount(m))) break;
            let size;
            if (format === 'nm') size = isCount(m) ? 1 + skip + m : NaN;
            else if (format === 'n' || format === 'tree') size = n + skip;
            else if (format === 'matrix') size = fields.length === 1 ? 1 + n : NaN;
            else {
                // n, then n-1 or n parents, on one line or several
                let have = 0;
                size = 1 + skip;
                while (i + size < lines.length && have < n - Number(!fullParents)) {
                    have += tokensOf(lines[i + size++]).length;
                }
            }
            if (!Number.isFinite(size)) break;
            if (tail === 'values') {
                if (!isVertexData(lines[i + size], n)) break;
                size++;
            }
            if (!headerMetadata && (format === 'tree' || format === 'parents') && fields.length === 2) {
                if (!isCount(m) || tail === 'queries') break;
                size += m;
            } else if (tail === 'queries') {
                const queries = lineCount(lines[i + size]);
                if (!isCount(queries)) break;
                size += 1 + queries;
            }
            // The old formats can still show a partial last case with a diagnostic.
            if ((format === 'tree' || tail || fullParents) && i + size > lines.length) break;
            tests.push(lines.slice(i, i + size));
            i += size;
        }
        return { tests, rest: Math.max(0, lines.length - i), declared: t };
    }

    function splitGraphCases(lines, format, skip) {
        const first = splitTestCases(lines, format, { skip });
        if (!first || (first.tests.length === first.declared && !first.rest)) return first;
        const variants = format === 'tree' ? [{ tail: 'queries' }, { tail: 'values' }, { headerMetadata: true }]
            : format === 'parents' ? [{ fullParents: true }, { tail: 'values' }, { tail: 'values', fullParents: true }] : [];
        for (const variant of variants) {
            const cases = splitTestCases(lines, format, { skip, ...variant });
            if (variant.headerMetadata && cases.tests.every(block => integer(tokensOf(block[0])[0]) === 1)) continue;
            if (cases.tests.length === cases.declared && !cases.rest) return { ...cases, alternateFraming: true };
        }
        return first;
    }

    function matrixShape(lines, multi) {
        const fields = lines[0] ? tokensOf(lines[0]) : [];
        const size = fields.length === 1 ? integer(fields[0]) : NaN;
        const compactSquare = isBinaryRow(fields[0] || '', lines.length)
            && lines.every(line => isBinaryRow(line.text, lines.length) || tokensOf(line).length === lines.length);
        const hasHeader = multi || (!compactSquare && lines.length > 1 && Number.isSafeInteger(size) && size > 0);
        return { n: hasHeader ? size : lines.length, hasHeader };
    }

    function parseMatrix(lines, multi, directed, result, mark) {
        const { n, hasHeader } = matrixShape(lines, multi);
        const rows = hasHeader ? lines.slice(1, 1 + n) : lines;
        if (!n) {
            result.issues.push(['Enter a square adjacency matrix.']);
            return result;
        }
        if (n > GRAPH_NODES) {
            result.issues.push(['Draw up to {0} nodes.', GRAPH_NODES]);
            return result;
        }
        if (rows.length < n) result.issues.push(['Expected {0} matrix rows. Found {1}.', n, rows.length]);
        const matrix = rows.map(line => {
            const values = isBinaryRow(line.text, n) ? [...line.text] : tokensOf(line);
            if (values.length === n && values.every(isWeight)) return values;
            mark(line);
            return [];
        });
        if (rows.length < n || result.unparsedCount) return result;

        result.count = n;
        result.ignored += lines.length - rows.length - Number(hasHeader);
        const weighted = matrix.some(row => row.some(value => Number(value) !== 0 && Number(value) !== 1));
        for (const [from, row] of matrix.entries()) {
            for (const [to, value] of row.entries()) {
                const weight = Number(value);
                if (weight === 0 || (!directed && from > to && weight === Number(matrix[to][from]))) continue;
                if (result.edges.length === GRAPH_EDGES) {
                    result.issues.push(['Only the first {0} edges are shown.', GRAPH_EDGES]);
                    return result;
                }
                result.edges.push({ from, to, weight: weighted ? value : undefined });
            }
        }
        return result;
    }

    /** Adds an isolated node to the selected graph and keeps the surrounding input. */
    function addGraphNode(input, options) {
        const { format, multi, base, testIndex = 0 } = options;
        const root = base === 1 ? '0' : '-1';
        if (!input.trim()) {
            if (format === 'matrix') return { input: '1\n0\n', format, multi: false };
            if (format === 'parents') return { input: `1\n${root}\n`, format, multi: false };
            if (format === 'n') return { input: '1\n', format, multi: false };
            return { input: '1 0\n', format: 'nm', multi: false };
        }
        const graph = parseGraph(input, options);
        if (!graph.count || graph.count >= GRAPH_NODES || graph.unparsedCount || graph.issues.length || graph.graphOnly
                || (multi && format === 'n')) return null;
        const nextSize = graph.count + 1;
        if (format === 'edges') {
            const text = `${nextSize}\n${input}`;
            return text.length <= GRAPH_CHARS ? { input: text, format: 'n', multi: false } : null;
        }

        const lines = graphLines(input);
        const block = multi ? splitTestCases(lines, format)?.tests[testIndex] : lines;
        if (!block?.length) return null;
        const raw = input.split(/\r?\n/);
        const headerIndex = block[0].line - 1;
        const updateHeader = () => {
            raw[headerIndex] = raw[headerIndex].replace(/^(\s*)[-+]?\d+/, (_, indent) => indent + nextSize);
        };

        if (format === 'matrix') {
            const { n, hasHeader } = matrixShape(block, multi);
            if (hasHeader) updateHeader();
            const rows = block.slice(Number(hasHeader), Number(hasHeader) + n);
            const compact = rows.every(row => isBinaryRow(row.text, n));
            for (const { line, text } of rows) {
                const value = isBinaryRow(text, n) && !compact ? [...text].join(' ') : raw[line - 1].trimEnd();
                raw[line - 1] = value + (compact ? '0' : ' 0');
            }
            const emptyRow = Array(nextSize).fill('0').join(compact ? '' : ' ');
            raw.splice(rows.at(-1).line, 0, emptyRow);
        } else if (format === 'parents') {
            updateHeader();
            const parents = block.slice(1).flatMap(tokensOf);
            if (parents.length === graph.count - 1) parents.unshift(root);
            parents.push(root);
            raw.splice(headerIndex + 1, block.at(-1).line - headerIndex - 1, parents.join(' '));
        } else {
            updateHeader();
        }

        const text = raw.join('\n');
        return text.length <= GRAPH_CHARS ? { input: text, format, multi } : null;
    }

    function editGraphInput(input, options, edit) {
        const { format, base, directed, multi, testIndex = 0 } = options;
        const graph = parseGraph(input, options);
        const { count, edges } = graph;
        if (graph.graphOnly) return { issue: 'Edit this input in the text box to preserve its extra data.' };
        if (!count || graph.issues.length || graph.unparsedCount || (multi && graph.tests !== graph.declaredTests)) {
            return { issue: 'Fix the graph input before editing it.' };
        }
        const lines = graphLines(input);
        const block = multi ? splitTestCases(lines, format).tests[testIndex] : lines;
        const fields = tokensOf(block[0]);
        const nodeRemoved = edit.type === 'deleteNode';
        const edgeAdded = edit.type === 'connect';
        const weightChanged = edit.type === 'weight';
        const edge = edges[edit.index];
        const weight = edit.weight?.trim();
        const validNode = node => Number.isInteger(node) && node >= 0 && node < count;
        const isIncident = ({ from, to }) => from === edit.node || to === edit.node;
        if (nodeRemoved && (!validNode(edit.node) || count === 1)) return { issue: 'Keep at least one node.' };
        if (nodeRemoved && (graph.ignored || (format === 'nm' && fields.length > 2) || (format === 'n' && fields.length > 1))) {
            return { issue: 'Remove extra input before renumbering nodes.' };
        }
        if (edgeAdded && (!validNode(edit.from) || !validNode(edit.to))) return { issue: 'Select a node to connect.' };
        if (!nodeRemoved && !edgeAdded && !edge) return { issue: 'Select an edge to edit.' };
        if (weightChanged && weight && !isWeight(weight)) return { issue: 'Enter a valid weight.' };
        if (format === 'n' && multi && !weightChanged && (!nodeRemoved || edges.filter(isIncident).length !== 1)) {
            return { issue: 'This format requires n−1 edges in each case.' };
        }

        const raw = input.split(/\r?\n/);
        const headerIndex = block[0].line - 1;
        const replaceHeader = (n, m) => {
            const values = [n, m];
            let column = 0;
            raw[headerIndex] = raw[headerIndex].replace(/\S+/g, token => values[column++] ?? token);
        };
        const renumber = node => node + base - Number(nodeRemoved && node > edit.node);
        let nextFormat = format;

        if (format === 'matrix') {
            const { hasHeader } = matrixShape(block, multi);
            const rows = block.slice(Number(hasHeader), Number(hasHeader) + count);
            const compact = rows.map(row => isBinaryRow(row.text, count));
            const matrix = rows.map((row, i) => compact[i] ? [...row.text] : tokensOf(row));
            const write = (i, values) => {
                raw[rows[i].line - 1] = values.join(compact[i] && values.every(v => /^[01]$/.test(v)) ? '' : ' ');
            };
            if (nodeRemoved) {
                if (hasHeader) replaceHeader(count - 1);
                matrix.forEach((values, i) => { if (i !== edit.node) write(i, values.filter((_, j) => j !== edit.node)); });
                raw.splice(rows[edit.node].line - 1, 1);
            } else {
                const { from, to } = edgeAdded ? edit : edge;
                const current = matrix[from][to];
                const mirror = matrix[to][from];
                if (edgeAdded && (Number(current) || (!directed && Number(mirror)))) return { issue: 'This edge already exists.' };
                if (weightChanged && weight && Number(weight) === 0) return { issue: 'Zero means no edge in this matrix.' };
                const value = edgeAdded ? '1' : weightChanged ? (weight || '1') : '0';
                matrix[from][to] = value;
                write(from, matrix[from]);
                if (!directed && from !== to && (edgeAdded || Number(current) === Number(mirror))) {
                    matrix[to][from] = value;
                    write(to, matrix[to]);
                }
            }
        } else if (format === 'parents') {
            if (weightChanged) return { issue: 'Parent arrays do not store weights.' };
            const parents = Array(count).fill(null);
            for (const { from, to } of edges) parents[to] = from;
            const implicitRoot = block.slice(1).flatMap(tokensOf).length === count - 1;
            if (edgeAdded) {
                if (parents[edit.to] !== null) return { issue: 'This node already has a parent.' };
                parents[edit.to] = edit.from;
            } else if (nodeRemoved) {
                parents.splice(edit.node, 1);
                for (let i = 0; i < parents.length; i++) if (parents[i] === edit.node) parents[i] = null;
            } else {
                parents[edge.to] = null;
            }
            if (implicitRoot && (parents[0] !== null || parents.slice(1).includes(null))) {
                return { issue: 'This parent array requires a parent for each non-root node.' };
            }
            if (nodeRemoved) replaceHeader(count - 1);
            const values = (implicitRoot ? parents.slice(1) : parents).map(parent => parent === null ? (base === 1 ? 0 : -1) : renumber(parent));
            const parentLines = values.length ? [values.join(' ')] : [];
            raw.splice(headerIndex + 1, block.at(-1).line - headerIndex - 1, ...parentLines);
        } else {
            const edgeRows = block.slice(Number(format !== 'edges'), Number(format !== 'edges') + edges.length);
            if (edgeAdded) {
                raw.splice(edgeRows.at(-1)?.line ?? block[0].line, 0, `${renumber(edit.from)} ${renumber(edit.to)}`);
                if (format === 'nm') replaceHeader(undefined, edges.length + 1);
            } else if (weightChanged) {
                const row = edgeRows[edit.index];
                const endpoints = tokensOf(row).slice(0, 2).join(' ');
                raw[row.line - 1] = weight ? `${endpoints} ${weight}` : endpoints;
            } else if (nodeRemoved) {
                if (format !== 'edges') replaceHeader(count - 1, format === 'nm' ? edges.filter(e => !isIncident(e)).length : undefined);
                for (let i = edgeRows.length - 1; i >= 0; i--) {
                    const e = edges[i];
                    const row = edgeRows[i].line - 1;
                    if (isIncident(e)) raw.splice(row, 1);
                    else raw[row] = [renumber(e.from), renumber(e.to), e.weight].filter(value => value !== undefined).join(' ');
                }
            } else {
                raw.splice(edgeRows[edit.index].line - 1, 1);
                if (format === 'nm') replaceHeader(undefined, edges.length - 1);
            }
            if (format === 'edges' && !edgeAdded && !weightChanged) {
                const remaining = nodeRemoved ? edges.filter(e => !isIncident(e)) : edges.filter((_, i) => i !== edit.index);
                const lastNode = count - Number(nodeRemoved) - 1 + base;
                if (!remaining.some(e => renumber(e.from) === lastNode || renumber(e.to) === lastNode)) {
                    raw.splice(headerIndex, 0, String(count - Number(nodeRemoved)));
                    nextFormat = 'n';
                }
            }
        }

        const text = raw.join('\n');
        const next = parseGraph(text, { ...options, format: nextFormat });
        if (!next.count || next.issues.length || next.unparsedCount || (multi && next.tests !== graph.tests)) {
            return { issue: 'This edit cannot be represented in the selected format.' };
        }
        return { input: text, format: nextFormat, multi };
    }

    function parseBlock(lines, { format, base, multi, directed, skip }, result) {
        const mark = ({ line, text }) => {
            result.unparsedCount++;
            if (result.unparsed.length < 30) result.unparsed.push({ line, text: text.slice(0, 120) });
        };
        if (format === 'matrix') return parseMatrix(lines, multi, directed, result, mark);
        let n;
        let m;
        let queries = null;
        let prefix;
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
            const [header] = lines;
            lines = lines.slice(1);
            const fields = header ? tokensOf(header) : [];
            result.headerFields = fields.length;
            [n, m] = fields.map(integer);
            const counted = format === 'nm';
            const structured = format === 'tree' || format === 'parents';
            if (structured && fields.length === 2) queries = m;
            if (!Number.isSafeInteger(n) || n < 1 || (counted && !isCount(m)) || (queries !== null && !isCount(queries))
                    || (format === 'parents' && fields.length > 2)) {
                if (header) mark(header);
                result.issues.push([counted ? 'Expected a header with n m.' : 'Expected a header with n.']);
                return result;
            }
            if (skip === 1) prefix = lines[0];
            result.ignored += Math.min(skip, lines.length);
            lines = lines.slice(skip);
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
            let data = queries === null ? lines : lines.slice(0, Math.max(0, lines.length - queries));
            const entries = rows => rows.flatMap(line => tokensOf(line).map(token => ({ token, line })));
            let values = entries(data);
            const last = data.at(-1);
            if (isVertexData(last, n) && (values.length > n || /^[a-z]+$/i.test(last.text))) {
                const parents = entries(data.slice(0, -1));
                if (parents.length === n - 1 || parents.length === n) {
                    data = data.slice(0, -1);
                    values = parents;
                }
            }
            if (data.length !== lines.length || queries !== null) {
                result.ignored += lines.length - data.length;
                result.graphOnly = true;
            }
            const omitFirst = values.length === n - 1;
            if (!omitFirst && values.length !== n) {
                result.issues.push(['Expected {0} or {1} parent entries. Found {2}.', n - 1, n, values.length]);
                result.count = 0;
                return result;
            }
            result.roots = omitFirst ? [0] : [];
            const bad = new Set();
            values.forEach(({ token, line }, i) => {
                const id = integer(token);
                if (!omitFirst && (id === -1 || (base === 1 && id === 0) || id === i + base)) {
                    result.roots.push(i);
                    if (id === i + base) result.graphOnly = true;
                    return;
                }
                const from = node(token);
                if (Number.isNaN(from)) bad.add(line);
                else result.edges.push({ from, to: i + Number(omitFirst) });
            });
            bad.forEach(mark);
            return result;
        }

        if (format === 'tree') m = n - 1;
        const counted = format === 'nm' || format === 'tree';
        const supplied = counted ? Math.min(m, lines.length) : lines.length;
        if (counted && lines.length < m) result.issues.push(['Expected {0} edge lines. Found {1}.', m, lines.length]);
        if (supplied > GRAPH_EDGES) result.issues.push(['Only the first {0} edge lines are shown.', GRAPH_EDGES]);
        result.ignored += lines.length - supplied;
        const readEdge = line => {
            const parts = tokensOf(line);
            const [u, v, weight] = parts;
            const from = node(u);
            const to = node(v);
            if (parts.length < 2 || parts.length > 3 || Number.isNaN(from) || Number.isNaN(to)
                    || (weight !== undefined && !isWeight(weight))) return null;
            return { from, to, weight };
        };
        for (const [i, line] of lines.entries()) {
            if (i >= supplied || i >= GRAPH_EDGES) break;
            const edge = readEdge(line);
            if (edge) result.edges.push(edge);
            else mark(line);
        }
        if (format === 'tree') {
            const extra = lines.slice(supplied);
            if (prefix) {
                const edge = readEdge(prefix);
                result.vertexPrefix = isVertexData(prefix, n) && (!edge || edge.from === edge.to);
            }
            const values = isVertexData(extra[0], n);
            result.framed = !extra.length || (queries !== null
                ? extra.length === queries || (extra.length === queries + 1 && values)
                : (extra.length === 1 && values && !readEdge(extra[0]))
                    || lineCount(extra[0]) === extra.length - 1);
            if (result.edges.length === n - 1 && !isTree(n, result.edges)) {
                result.issues.push(['The selected edges do not form a tree.']);
            }
        }
        return result;
    }

    function isTree(count, edges) {
        const parents = Array.from({ length: count }, (_, i) => i);
        const root = i => parents[i] === i ? i : (parents[i] = root(parents[i]));
        return edges.every(({ from, to }) => {
            const a = root(from), b = root(to);
            if (a === b) return false;
            parents[a] = b;
            return true;
        });
    }

    /**
     * A tree or forest drawn top-down: each root (smallest number) on top, children one layer
     * below, leaves spaced evenly and a parent centred over its children, so no edge crosses.
     * null when the graph has a cycle, or when most nodes are isolated (a force layout fits better).
     */
    function treeLayout(count, edges, roots = []) {
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
        if (!links || (!roots.length && links < count / 2)) return null;
        const GAP = 64;
        const LAYER = 84;
        const nodes = Array.from({ length: count }, () => ({ x: 0, y: 0, dx: 0, dy: 0 }));
        const seen = new Array(count).fill(false);
        let slot = 0;
        for (const root of [...roots, ...parent.keys()]) {
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

    function layoutGraph(count, edges, random, roots) {
        if (!random) {
            const tree = treeLayout(count, edges, roots);
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
        const fallback = { format: 'nm', base: 1, multi: false };
        if (input.length > GRAPH_CHARS) return fallback;
        const lines = graphLines(input);
        const matrix = graphReader(input, { format: 'matrix', base: 1 }, lines)();
        const exactMatrix = matrix.count > 1 && !matrix.ignored;
        const matrixGuess = { format: 'matrix', base: 1, multi: false };
        if (exactMatrix && matrix.count >= 4) return matrixGuess;
        let best = null;
        let bestHasErrors = false;
        const layouts = [['nm', 0], ['n', 0], ['tree', 0], ['tree', 1], ['parents', 0], ['edges', 0]];
        for (const multi of [false, true]) {
            for (const [format, skip] of layouts) {
                if (multi && format === 'edges') continue;
                const complete = graph => graph.count && !graph.issues.length && !graph.unparsedCount
                    && (format !== 'tree' || graph.framed) && (!skip || graph.vertexPrefix)
                    && (!multi || format !== 'n' || graph.headerFields === 1);
                for (const base of [1, 0]) {
                    const read = graphReader(input, { format, base, multi, skip }, lines);
                    const g = read();
                    if (!g.count || (g.issues.length && !g.edges.length)) continue;
                    let exactTests = multi && g.tests === g.declaredTests && !g.remainingLines && complete(g);
                    for (let i = 1; exactTests && i < g.tests; i++) exactTests = complete(read(i));
                    if (format === 'tree' && (!complete(g) || (multi && !exactTests))) continue;
                    const structured = format === 'tree' || (format === 'parents' && g.graphOnly);
                    const cleanCountedEdges = format === 'nm' && complete(g) && !g.ignored && (!multi || exactTests);
                    const score = g.unparsedCount * 1000 + g.issues.length * 100
                        + (structured ? 0 : g.ignored * 20) + (multi && !exactTests ? 80 : 0)
                        + (format === 'edges' ? 50 : 0) - (exactTests ? 500 : 0) - g.edges.length
                        - (cleanCountedEdges ? 120 : 0) - (structured && (g.ignored || g.headerFields > 1) ? 80 : 0);
                    if (!best || score < best.score) {
                        best = { format, base, multi, score };
                        if (skip) best.skip = skip;
                        bestHasErrors = !!(g.unparsedCount || g.issues.length);
                    }
                }
            }
        }
        // A small square can also be an edge list. Keep a clean legacy reading in that case.
        if (exactMatrix && (!best || bestHasErrors)) return matrixGuess;
        return best || fallback;
    }

    /** The same edge listed more than once (u v and v u when undirected): one line, with ×k. */
    function edgeKey({ from, to }, directed) {
        return directed || from <= to ? `${from}>${to}` : `${to}>${from}`;
    }

    function mergeEdges(edges, directed) {
        const map = new Map();
        for (const e of edges) {
            const key = edgeKey(e, directed);
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
    function drawGraph({ count, edges, roots }, { base, directed, format }, summary, notes, onEdit, previousView) {
        const wrap = document.createElement('div');
        wrap.className = 'test-graph-wrap';
        const board = svg('svg', { class: 'test-graph', role: 'img', 'aria-label': summary, tabindex: -1 });
        board.setAttribute('translate', 'no');
        const gestures = I18n.t(onEdit ? 'Right-click a node or edge to edit it.' : 'Edit this input in the text box to preserve its extra data.');
        board.setAttribute('aria-description', gestures);
        board.append(svg('title', {}, gestures));
        const radius = count > 100 ? 10 : count > 30 ? 13 : 16;
        let nodes = previousView?.nodes.length === count ? previousView.nodes : layoutGraph(count, edges, undefined, roots);
        const merged = mergeEdges(edges, directed);
        const edgeIndices = new Map();
        edges.forEach((edge, index) => {
            const key = edgeKey(edge, directed);
            if (!edgeIndices.has(key)) edgeIndices.set(key, []);
            edgeIndices.get(key).push(index);
        });
        const directions = directed ? new Set(merged.map(edge => `${edge.from}>${edge.to}`)) : null;
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
        const connection = svg('line', { class: 'test-graph-connection', visibility: 'hidden' });
        const nodeLayer = svg('g', {});
        board.append(edgeLayer, labelLayer, connection, nodeLayer);

        const edgeEls = merged.map((e, index) => {
            const shape = e.from === e.to ? 'path' : 'line';
            const el = svg(shape, { class: 'test-graph-edge' + (e.count > 1 ? ' multi' : ''), 'data-edge': index });
            const hit = svg(shape, { class: 'test-graph-edge-hit', 'data-edge': index });
            if (directed) el.setAttribute('marker-end', 'url(#test-graph-arrow)');
            edgeLayer.append(el, hit);
            const text = edgeLabel(e);
            let label = null;
            if (text) {
                label = svg('text', { class: 'test-graph-weight', 'dominant-baseline': 'central', 'data-edge': index }, text);
                if (e.weights.some(w => w.length > 12)) label.append(svg('title', {}, e.weights.join(', ').slice(0, 200)));
                labelLayer.append(label);
            }
            return { el, hit, label };
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
                const { el, hit, label } = edgeEls[i];
                const position = (name, value) => { el.setAttribute(name, value); hit.setAttribute(name, value); };
                let lx;
                let ly;
                if (e.from === e.to) {
                    const r = radius;
                    position('d', `M${a.x - r * 0.5},${a.y - r * 0.85} C${a.x - r * 2.2},${a.y - r * 3.4} ${a.x + r * 2.2},${a.y - r * 3.4} ${a.x + r * 0.5},${a.y - r * 0.85}`);
                    lx = a.x;
                    ly = a.y - r * 3.1;
                } else {
                    const dx = b.x - a.x;
                    const dy = b.y - a.y;
                    const length = Math.max(1, Math.hypot(dx, dy));
                    const start = Math.min(radius, length / 3);
                    const end = Math.min(radius + (directed ? 2 : 0), length / 3);
                    const gap = directions?.has(`${e.to}>${e.from}`) ? Math.min(8, length / 6) : 0;
                    const offsetX = -dy / length * gap;
                    const offsetY = dx / length * gap;
                    position('x1', a.x + dx / length * start + offsetX);
                    position('y1', a.y + dy / length * start + offsetY);
                    position('x2', b.x - dx / length * end + offsetX);
                    position('y2', b.y - dy / length * end + offsetY);
                    lx = (a.x + b.x) / 2 + offsetX;
                    ly = (a.y + b.y) / 2 + offsetY;
                }
                if (label) { label.setAttribute('x', lx); label.setAttribute('y', ly); }
            });
            nodes.forEach((p, i) => nodeEls[i].setAttribute('transform', `translate(${p.x},${p.y})`));
        }

        // The view box: fitted around the nodes; pan and zoom change it.
        let view = previousView?.view || { x: 0, y: 0, w: GRAPH_WIDTH, h: GRAPH_HEIGHT };
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

        const menu = document.createElement('div');
        menu.className = 'test-graph-context';
        menu.tabIndex = -1;
        menu.hidden = true;
        const hideMenu = () => { menu.hidden = true; };
        const placeMenu = event => {
            const bounds = wrap.getBoundingClientRect();
            menu.hidden = false;
            menu.style.left = `${Math.max(0, Math.min(event.clientX - bounds.left, bounds.width - menu.offsetWidth))}px`;
            menu.style.top = `${Math.max(0, Math.min(event.clientY - bounds.top, board.clientHeight - menu.offsetHeight))}px`;
        };
        const showMenuIssue = (event, message) => {
            if (!message) return;
            let status = menu.querySelector('[role="status"]');
            if (!status) {
                status = appendText(menu, 'p', '', 'test-graph-issue');
                status.setAttribute('role', 'status');
            }
            status.textContent = I18n.t(message);
            placeMenu(event);
        };
        let connectFrom = null;
        const cancelConnection = () => {
            if (connectFrom === null) return;
            nodeEls[connectFrom].classList.remove('connecting');
            board.classList.remove('connecting');
            connection.setAttribute('visibility', 'hidden');
            connectFrom = null;
        };
        const moveConnection = event => {
            const point = toSvg(event);
            connection.setAttribute('x2', point.x);
            connection.setAttribute('y2', point.y);
        };
        const sendEdit = edit => onEdit(edit, { nodes: nodes.map(point => ({ ...point })), view: { ...view } });
        const menuButton = (label, icon, action, type = 'button') => {
            const button = document.createElement('button');
            button.type = type;
            button.className = icon ? 'test-tool-control test-graph-icon-btn' : 'test-graph-context-action';
            const name = I18n.t(label);
            if (icon) {
                button.title = name;
                button.setAttribute('aria-label', name);
                if (icon.startsWith('#')) {
                    const graphic = svg('svg', { class: 'ico', width: 13, height: 13, 'aria-hidden': 'true' });
                    graphic.append(svg('use', { href: icon }));
                    button.append(graphic);
                } else button.textContent = icon;
            } else button.textContent = name;
            if (action) button.addEventListener('click', action);
            return button;
        };

        board.addEventListener('contextmenu', event => {
            event.preventDefault();
            if (!onEdit) return;
            cancelConnection();
            const node = nodeEls.indexOf(event.target.closest('.test-graph-node'));
            const edgeTarget = event.target.closest('[data-edge]');
            if (node < 0 && !edgeTarget) { hideMenu(); return; }
            menu.replaceChildren();
            if (node >= 0) {
                menu.append(menuButton('Connect edge', '', () => {
                    hideMenu();
                    connectFrom = node;
                    nodeEls[node].classList.add('connecting');
                    board.classList.add('connecting');
                    connection.setAttribute('x1', nodes[node].x);
                    connection.setAttribute('y1', nodes[node].y);
                    moveConnection(event);
                    connection.setAttribute('visibility', 'visible');
                    board.focus({ preventScroll: true });
                }));
                menu.append(menuButton('Delete node', '', () => {
                    showMenuIssue(event, sendEdit({ type: 'deleteNode', node }));
                }));
            } else {
                const mergedEdge = merged[Number(edgeTarget.dataset.edge)];
                const indices = edgeIndices.get(edgeKey(mergedEdge, directed));
                const edgeForm = document.createElement('form');
                edgeForm.className = 'test-graph-edge-form';
                let index = indices[0];
                const field = document.createElement('input');
                field.className = 'test-tool-control';
                field.inputMode = 'decimal';
                field.spellcheck = false;
                field.value = edges[index].weight ?? '';
                field.setAttribute('aria-label', I18n.t('Weight'));
                if (indices.length > 1) {
                    const select = document.createElement('select');
                    select.className = 'test-tool-control';
                    select.setAttribute('aria-label', I18n.t('Edge'));
                    indices.forEach((i, position) => {
                        const e = edges[i];
                        const option = document.createElement('option');
                        option.value = String(i);
                        option.textContent = `${position + 1}. ${e.from + base}${directed ? ' → ' : ' – '}${e.to + base}${e.weight === undefined ? '' : ` · ${e.weight}`}`;
                        select.append(option);
                    });
                    select.addEventListener('change', () => {
                        index = Number(select.value);
                        field.value = edges[index].weight ?? '';
                    });
                    edgeForm.append(select);
                }
                const step = delta => {
                    const current = field.value.trim() ? Number(field.value) : 1;
                    let next = current + delta;
                    if (format === 'matrix' && next === 0) next += delta;
                    if (Number.isFinite(next)) field.value = String(next);
                };
                if (format !== 'parents') {
                    const label = appendText(edgeForm, 'label', I18n.t('Weight'));
                    label.append(field);
                    edgeForm.append(menuButton('Decrease weight', '−', () => step(-1)),
                        menuButton('Increase weight', '#i-plus', () => step(1)),
                        menuButton('Apply weight', '✓', null, 'submit'));
                }
                edgeForm.append(menuButton('Delete edge', '#i-trash', () => {
                    showMenuIssue(event, sendEdit({ type: 'deleteEdge', index }));
                }));
                edgeForm.addEventListener('submit', submitEvent => {
                    submitEvent.preventDefault();
                    const issue = sendEdit({ type: 'weight', index, weight: field.value });
                    showMenuIssue(event, issue);
                    if (issue) field.focus({ preventScroll: true });
                });
                menu.append(edgeForm);
            }
            placeMenu(event);
            menu.querySelector('button, select, input')?.focus({ preventScroll: true });
        });
        menu.addEventListener('focusout', event => { if (!menu.contains(event.relatedTarget)) hideMenu(); });
        wrap.addEventListener('keydown', event => {
            if (event.key !== 'Escape' || (menu.hidden && connectFrom === null)) return;
            event.preventDefault();
            hideMenu();
            cancelConnection();
            board.focus({ preventScroll: true });
        });

        let drag = null;   // { node, dx, dy } or { pan: true, x, y }
        board.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return;
            const g = event.target.closest('.test-graph-node');
            hideMenu();
            if (connectFrom !== null) {
                const from = connectFrom;
                cancelConnection();
                event.preventDefault();
                if (g) {
                    const issue = sendEdit({ type: 'connect', from, to: nodeEls.indexOf(g) });
                    if (issue) {
                        menu.replaceChildren();
                        showMenuIssue(event, issue);
                        menu.focus({ preventScroll: true });
                    }
                }
                return;
            }
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
            if (connectFrom !== null) moveConnection(event);
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
        if (merged.some(e => e.count > 1)) notes.push(I18n.t('×3 = the same pair of nodes is joined by 3 edges'));
        wrap.append(board, tools, menu);
        if (notes.length) {
            const help = appendText(wrap, 'p', '', 'test-graph-help');
            for (const note of notes) appendText(help, 'span', note, 'test-graph-note');
        }
        place();
        if (previousView) setView();
        else fit();
        return wrap;
    }

    function showGraph(input = '', number, target) {
        const standalone = number == null;
        const tabId = getPreferredTabId();
        const editableTest = target && !target.test.inputPath;
        const originalTestInput = target?.test.input || '';
        const { dialog, body } = openDialog(standalone ? 'Graph Preview' : labels.graph, number);
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
        if (standalone) picker.querySelector('.test-graph-cases-sep').remove();
        const caseSelect = picker.querySelector('select');

        body.innerHTML = `
            <form class="test-graph-options">
                <div class="test-graph-source">
                    <label for="test-graph-input">Graph input</label>
                    <textarea id="test-graph-input" name="source" class="test-tool-control" rows="4" wrap="off" spellcheck="false" translate="no" autofocus></textarea>
                    <p class="test-graph-issue" role="status" hidden></p>
                </div>
                <label><span>Format</span><select name="format" class="test-tool-control">
                    <option value="auto">Auto-detect</option>
                    <option value="nm">Edges (n m)</option>
                    <option value="n">Edges (n)</option>
                    <option value="tree">Tree (n−1 edges)</option>
                    <option value="parents">Parent array</option>
                    <option value="matrix">Adjacency matrix</option>
                    <option value="edges">Edge list</option>
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
                <label><span>Skip lines</span><input name="skip" type="number" class="test-tool-control" min="0" max="999" value="0"></label>
                <div class="test-graph-actions">
                    <button type="button" name="addNode" class="test-tool-control test-graph-icon-btn" title="Add node" aria-label="Add node">
                        <svg class="ico" width="14" height="14" aria-hidden="true"><use href="#i-plus"/></svg>
                    </button>
                    <button type="submit" class="test-tool-control test-graph-icon-btn" title="Draw graph" aria-label="Draw graph">
                        <svg class="ico" width="12" height="12" aria-hidden="true"><use href="#i-play-fill"/></svg>
                    </button>
                    <button type="button" name="undoGraph" class="test-tool-control test-graph-icon-btn" title="Undo graph edit" aria-label="Undo graph edit" disabled>↶</button>
                    ${editableTest ? '<button type="button" name="updateTest" class="test-tool-control primary" disabled>Update test</button>' : ''}
                    ${tabId ? `<button type="button" name="addTest" class="test-tool-control${editableTest ? '' : ' primary'}" disabled>Add to tests</button>` : ''}
                </div>
                <span class="test-graph-summary" aria-live="polite"></span>
            </form>
            <div class="test-graph-result"></div>`;
        const form = body.querySelector('form');
        const source = form.elements.source;
        const addTest = form.elements.addTest;
        const updateTest = form.elements.updateTest;
        const undoGraph = form.elements.undoGraph;
        source.value = input;
        input = source.value;
        const originalDraft = source.value;
        const history = [];
        const format = form.elements.format;
        const multiSel = form.elements.multi;
        const skipLines = form.elements.skip;
        skipLines.title = I18n.t('Skip nonempty lines after each case header.');
        const inputStatus = form.querySelector('[role="status"]');
        const result = body.querySelector('.test-graph-result');
        const summaryEl = body.querySelector('.test-graph-summary');
        const applyGuess = () => {
            const guess = guessGraphFormat(input);
            format.value = guess.format;
            form.elements.base.value = String(guess.base);
            multiSel.value = guess.multi ? '1' : '0';
            skipLines.value = String(guess.skip || 0);
        };
        if (input.trim()) applyGuess();
        let caseIndex = 0;
        let total = 0;
        let readCase;

        const options = () => ({
            format: format.value,
            base: Number(form.elements.base.value),
            multi: multiSel.value === '1' && format.value !== 'edges',
            directed: form.elements.direction.value === 'directed',
            skip: format.value === 'edges' || format.value === 'matrix' ? 0 : Math.min(999, Math.max(0, Math.trunc(skipLines.valueAsNumber || 0))),
        });

        const updatePicker = () => {
            caseSelect.value = String(caseIndex);
            picker.querySelectorAll('.test-graph-step').forEach(b => {
                b.disabled = Number(b.dataset.step) < 0 ? caseIndex === 0 : caseIndex >= total - 1;
            });
        };
        // One entry per case: "Case 3 · 15 nodes · 14 edges".
        const fillCases = first => {
            total = first?.tests || 0;
            picker.hidden = total < 2;
            sub.hidden = standalone && picker.hidden;
            caseSelect.replaceChildren();
            for (let k = 0; k < total; k++) {
                const g = k ? readCase(k) : first;
                const option = document.createElement('option');
                option.value = String(k);
                option.textContent = `${k + 1} / ${total}` + ' · ' + I18n.t('{0} nodes · {1} edges', g.count, g.edges.length);
                caseSelect.append(option);
            }
            updatePicker();
        };

        const draw = (graph, opts, canvasView) => {
            result.replaceChildren();
            summaryEl.textContent = '';
            const graphOnly = graph?.graphOnly || opts.format === 'tree' || opts.skip > 0;
            form.elements.addNode.disabled = !!graphOnly;
            form.elements.addNode.title = I18n.t(graphOnly ? 'Edit this input in the text box to preserve its extra data.' : 'Add node');
            if (!graph) return;
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
                if (graph.ignored) notes.push(I18n.t('Skipped {0} non-graph line(s)', graph.ignored));
                result.appendChild(drawGraph(graph, opts, summary, notes, graphOnly ? null : applyCanvasEdit, canvasView));
            }
        };
        const redraw = (preferredCase = 0, canvasView) => {
            const opts = options();
            multiSel.title = opts.format === 'matrix'
                ? I18n.t('Enter a square matrix, with n on the first line of each case if there are several. A zero means no edge.')
                : I18n.t('Each case: its first line, then m edges (n m) or n−1 edges (n, a tree).');
            format.title = {
                nm: I18n.t('n m, then m edges u v [w]'),
                n: I18n.t('n, then edges u v [w]'),
                tree: I18n.t('n or n q, then n−1 edges. Trailing queries are skipped.'),
                edges: I18n.t('Edges u v [w] only, no first line'),
                parents: I18n.t('Enter n−1 or n parents. A root can use its own number, −1, or 0 with 1-indexed nodes.'),
                matrix: I18n.t('Binary rows can be entered without spaces, such as 0101.'),
            }[opts.format] || '';
            multiSel.disabled = opts.format === 'edges';
            skipLines.disabled = opts.format === 'edges' || opts.format === 'matrix';
            readCase = input.trim() ? graphReader(input, opts) : null;
            const first = readCase?.(0);
            caseIndex = Math.min(preferredCase, Math.max(0, (first?.tests || 0) - 1));
            fillCases(first);
            draw(caseIndex ? readCase(caseIndex) : first, opts, canvasView);
        };
        const goTo = k => {
            caseIndex = k;
            updatePicker();
            draw(readCase(k), options());
        };
        const updatePreview = () => {
            input = source.value;
            if (format.value === 'auto' && input.trim()) applyGuess();
            inputStatus.hidden = true;
            redraw();
        };
        const showInputStatus = message => {
            inputStatus.hidden = !message;
            inputStatus.textContent = message ? I18n.t(message) : '';
            return message;
        };
        const updateActions = () => {
            if (addTest) addTest.disabled = !source.value.trim();
            if (updateTest) updateTest.disabled = source.value === originalDraft;
            undoGraph.disabled = history.length === 0;
        };
        const applyDraft = (draft, selectedCase, canvasView) => {
            source.value = input = draft.input;
            format.value = draft.format;
            form.elements.base.value = String(draft.base);
            form.elements.direction.value = draft.directed ? 'directed' : 'undirected';
            multiSel.value = draft.multi ? '1' : '0';
            skipLines.value = String(draft.skip || 0);
            showInputStatus();
            updateActions();
            redraw(selectedCase, canvasView);
        };
        const saveDraft = canvasView => {
            if (history.length === 20) history.shift();
            history.push({ input: source.value, ...options(), caseIndex, canvasView });
        };
        function applyCanvasEdit(edit, canvasView) {
            if (source.value !== input) return 'Draw the current input before editing the graph.';
            const opts = options();
            const next = editGraphInput(input, { ...opts, testIndex: caseIndex }, edit);
            if (next.issue) return next.issue;
            if (next.input === input) return null;
            saveDraft(canvasView);
            const nodes = edit.type === 'deleteNode' ? canvasView.nodes.filter((_, index) => index !== edit.node) : canvasView.nodes;
            applyDraft({ ...opts, ...next }, caseIndex, edit.type === 'connect' ? undefined : { ...canvasView, nodes });
            return null;
        }
        source.addEventListener('input', () => { showInputStatus(); history.length = 0; updateActions(); });
        undoGraph.addEventListener('click', () => {
            const previous = history.pop();
            if (previous) applyDraft(previous, previous.caseIndex, previous.canvasView);
        });
        form.elements.addNode.addEventListener('click', () => {
            input = source.value;
            if (format.value === 'auto' && input.trim()) applyGuess();
            const opts = options();
            const next = addGraphNode(input, { ...opts, testIndex: caseIndex });
            if (!next) { showInputStatus('Cannot add an isolated node to this input.'); return; }
            saveDraft();
            applyDraft({ ...opts, ...next }, caseIndex);
        });
        addTest?.addEventListener('click', () => {
            if (getPreferredTabId() !== tabId) {
                showToast('Return to the original file to add this test.', 'warning');
                return;
            }
            if (isBatchTesting || isBuilding) {
                showToast('Wait for the current build or test to finish.', 'warning');
                return;
            }
            dialog.close();
            addTestCaseForEditing(source.value);
            document.getElementById('input-area')?.focus();
        });
        updateTest?.addEventListener('click', () => {
            if (isBatchTesting || isBuilding) { showInputStatus('Wait for the current build or test to finish.'); return; }
            const { problem, test } = target;
            const index = problem.tests.indexOf(test);
            if (getPreferredTabId() !== tabId || ccProblem !== problem || index < 0 || test.inputPath
                    || (test.input || '') !== originalTestInput) {
                showInputStatus('The original test changed while the graph was open.');
                return;
            }
            test.input = source.value;
            batchTestResults = batchTestResults.filter(result => result.testIndex !== index);
            if (ccTestIndex === index) switchTestCase(index);
            touchProblem();
            renderTestResults();
            dialog.close();
        });
        form.addEventListener('change', event => {
            if (event.target !== source) updatePreview();
        });
        form.addEventListener('submit', event => {
            event.preventDefault();
            updatePreview();
        });
        caseSelect.addEventListener('change', () => goTo(Number(caseSelect.value)));
        picker.querySelectorAll('.test-graph-step').forEach(b => b.addEventListener('click', () => goTo(caseIndex + Number(b.dataset.step))));
        updateActions();
        redraw();
        dialog.showModal();
    }

    return { init, bindGraphButton, buttons, runAction, showGraph, showInputGraph, parseGraph, addGraphNode, editGraphInput, layoutGraph, treeLayout, guessGraphFormat, mergeEdges };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = TestRowTools;
else window.TestRowTools = TestRowTools;
