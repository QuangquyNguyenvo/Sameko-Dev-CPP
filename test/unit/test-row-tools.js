'use strict';

const assert = require('node:assert/strict');
const { checker } = require('../helpers/app');
const { parseGraph, addGraphNode, editGraphInput, layoutGraph, treeLayout, guessGraphFormat, mergeEdges } = require('../../src/renderer/app/test-row-tools');
const { instrumentationFlags, summarizeFlatProfile } = require('../../app/services/compiler/test-instrumentation');
const { splitFlags } = require('../../app/shared/validators');

async function main() {
    const t = checker();

    await t.check('edge list keeps weights and reports original line numbers', () => {
        const result = parseGraph('4 4\r\n1 2 7\r\n\r\n2 4 -2.5\r\n2 5\r\n3\r\n1 4', { format: 'nm', base: 1 });
        assert.equal(result.count, 4);
        assert.deepEqual(result.edges, [{ from: 0, to: 1, weight: '7' }, { from: 1, to: 3, weight: '-2.5' }]);
        assert.deepEqual(result.unparsed.map(item => item.line), [5, 6]);
        assert.equal(result.ignored, 1, 'a line after the m edges is skipped, not an error');
        assert.equal(parseGraph('2 3\n1 2', { format: 'nm', base: 1 }).issues.length, 1);
    });

    await t.check('other input shapes: extra header numbers, queries after the edges, a bare edge list', () => {
        const queries = parseGraph('4 3 1 4\n1 2\n2 3\n3 4\n2\n1 4\n2 3', { format: 'nm', base: 1 });
        assert.equal(queries.count, 4);
        assert.equal(queries.edges.length, 3);
        assert.equal(queries.unparsedCount, 0);
        assert.equal(queries.ignored, 3);
        const bare = parseGraph('1 2\n2 5 9\n', { format: 'edges', base: 1 });
        assert.equal(bare.count, 5);
        assert.deepEqual(bare.edges, [{ from: 0, to: 1, weight: undefined }, { from: 1, to: 4, weight: '9' }]);
    });

    await t.check('several test cases: the first line is t, and each case is read on its own', () => {
        const input = '3\n3 2\n1 2\n2 3\n2 1\n1 2\n4 3\n1 2\n1 3\n1 4\n';
        const second = parseGraph(input, { format: 'nm', base: 1, multi: true, testIndex: 1 });
        assert.equal(second.tests, 3);
        assert.equal(second.count, 2);
        assert.equal(second.edges.length, 1);
        assert.equal(parseGraph(input, { format: 'nm', base: 1, multi: true, testIndex: 2 }).count, 4);
        const trees = parseGraph('2\n3\n1 2\n1 3\n2\n1 2\n', { format: 'n', base: 1, multi: true, testIndex: 1 });
        assert.equal(trees.tests, 2);
        assert.equal(trees.count, 2);
        assert.deepEqual(pick(guessGraphFormat(input)), { format: 'nm', base: 1, multi: true });
    });

    await t.check('parent arrays accept both bases and omitted or explicit roots', () => {
        const expected = [{ from: 0, to: 1 }, { from: 0, to: 2 }, { from: 2, to: 3 }];
        assert.deepEqual(parseGraph('4\n1 1 3', { format: 'parents', base: 1 }).edges, expected);
        assert.deepEqual(parseGraph('4\n-1 0\n0 2', { format: 'parents', base: 0 }).edges, expected);
        assert.deepEqual(parseGraph('4\n0 1 1 3', { format: 'parents', base: 1 }).edges, expected);
        assert.deepEqual(parseGraph('4\n0 7 1 3', { format: 'parents', base: 1 }).unparsed, [{ line: 2, text: '0 7 1 3' }]);
    });

    await t.check('Codeforces tree shapes separate vertex data and queries from edges', () => {
        // CF 1324F: vertex values before the edges. CF 274B: vertex values after the edges.
        const withColors = '4\n0 0 1 0\n1 2\n1 3\n1 4';
        const settings = guessGraphFormat(withColors);
        assert.equal(settings.format, 'tree');
        assert.equal(settings.skip, 1);
        const colors = parseGraph(withColors, settings);
        assert.deepEqual(colors.edges.map(e => [e.from, e.to]), [[0, 1], [0, 2], [0, 3]]);
        assert.equal(colors.ignored, 1);
        const withValues = '3\n1 2\n1 3\n1 -1 1';
        assert.deepEqual(pick(guessGraphFormat(withValues)), { format: 'tree', base: 1 });
        assert.equal(parseGraph(withValues, guessGraphFormat(withValues)).edges.length, 2);

        // CF 1797D shape: n q, one vertex array, n−1 edges, then q operations.
        const operations = '4 2\n5 4 3 2\n2 1\n2 3\n4 2\n1 4\n2 3';
        const operationOptions = guessGraphFormat(operations);
        assert.equal(operationOptions.skip, 1);
        const tree = parseGraph(operations, operationOptions);
        assert.deepEqual(tree.edges.map(e => [e.from, e.to]), [[1, 0], [1, 2], [3, 1]]);
        assert.equal(tree.ignored, 3);
        assert.deepEqual(tree.issues, []);
    });

    await t.check('tree case boundaries skip counted queries and keep both bases and weights', () => {
        // CF 1843D shape: t cases, each with n−1 edges followed by q and q queries.
        const input = '2\n4\n0 1 7\n1 2\n2 3\n2\n0 2\n1 3\n3\n0 2 -5\n2 1\n1\n0 1';
        const opts = guessGraphFormat(input);
        assert.deepEqual(pick(opts), { format: 'tree', base: 0, multi: true });
        const first = parseGraph(input, opts);
        const second = parseGraph(input, { ...opts, testIndex: 1 });
        assert.equal(first.tests, 2);
        assert.equal(first.ignored, 3);
        assert.deepEqual(second.edges, [{ from: 0, to: 2, weight: '-5' }, { from: 2, to: 1, weight: undefined }]);
        assert.equal(second.ignored, 2);
        assert.deepEqual(second.issues, []);
        assert.match(editGraphInput(input, opts, { type: 'weight', index: 0, weight: '8' }).issue, /preserve/);
        assert.equal(addGraphNode(input, opts), null);
    });

    await t.check('extra numbers on tree headers can be parameters instead of query counts', () => {
        const input = '2\n4 1\n1 2\n2 3\n2 4\n3 3\n1 2\n1 3';
        const opts = guessGraphFormat(input);
        assert.deepEqual(pick(opts), { format: 'tree', base: 1, multi: true });
        const graph = parseGraph(input, { ...opts, testIndex: 1 });
        assert.equal(graph.tests, 2);
        assert.deepEqual(graph.edges.map(e => [e.from, e.to]), [[0, 1], [0, 2]]);
        assert.equal(graph.ignored, 0);
    });

    await t.check('parent arrays with a self-root or trailing labels keep the actual root', () => {
        // CF 1675D shape, including a complete one-node parent array in the middle.
        const input = '3\n5\n3 1 3 3 1\n1\n1\n3\n1 1 2';
        const opts = guessGraphFormat(input);
        assert.deepEqual(pick(opts), { format: 'parents', base: 1, multi: true });
        const first = parseGraph(input, opts);
        assert.equal(first.tests, 3);
        assert.deepEqual(first.roots, [2]);
        assert.equal(first.edges.length, 4);
        const nodes = layoutGraph(first.count, first.edges, undefined, first.roots);
        assert.ok(nodes.every((p, i) => i === 2 || p.y > nodes[2].y));
        assert.equal(parseGraph(input, { ...opts, testIndex: 1 }).edges.length, 0);
        assert.equal(parseGraph(input, { ...opts, testIndex: 2 }).edges.length, 2);

        // CF 570D shape: n q, parents, labels, then q query rows.
        const queries = '4 2\n1 1 3\nabba\n1 2\n3 2';
        const graph = parseGraph(queries, guessGraphFormat(queries));
        assert.deepEqual(graph.edges, [{ from: 0, to: 1 }, { from: 0, to: 2 }, { from: 2, to: 3 }]);
        assert.equal(graph.ignored, 3);
        assert.equal(graph.unparsedCount, 0);
    });

    await t.check('manual skip selects a graph without rewriting its source', () => {
        const input = '3 1\r\nlabels red green blue\r\n10 20 30\r\n1 2 7\r\n2 3 -1\r\n2 1 3\r\n';
        const opts = { format: 'tree', base: 1, skip: 2 };
        const graph = parseGraph(input, opts);
        assert.deepEqual(graph.issues, []);
        assert.deepEqual(graph.edges.map(e => e.weight), ['7', '-1']);
        assert.equal(graph.ignored, 3);
        assert.equal(graph.graphOnly, true);
        assert.equal(addGraphNode(input, opts), null);
        assert.ok(editGraphInput(input, opts, { type: 'connect', from: 0, to: 2 }).issue);
    });

    await t.check('adjacency matrices keep isolated nodes, weights and edge directions', () => {
        const matrix = '0 2 0 0\n2 -1 1 0\n0 0 0 0\n0 0 0 0';
        const opts = { format: 'matrix', base: 1 };
        const graph = parseGraph(matrix, opts);
        assert.equal(graph.count, 4);
        assert.deepEqual(graph.edges, [
            { from: 0, to: 1, weight: '2' },
            { from: 1, to: 1, weight: '-1' },
            { from: 1, to: 2, weight: '1' },
        ]);
        const directed = parseGraph(`4\r\n${matrix}\nqueries`, { ...opts, directed: true });
        assert.equal(directed.edges.length, 4);
        assert.deepEqual(directed.edges[1], { from: 1, to: 0, weight: '2' });
        assert.equal(directed.ignored, 1);
        const binary = parseGraph('0 1\n1 0', { ...opts, base: 0 });
        assert.deepEqual(binary.edges, [{ from: 0, to: 1, weight: undefined }]);
        assert.equal(parseGraph('0 0\n0 0', opts).count, 2);
        assert.deepEqual(parseGraph('2', opts).edges, [{ from: 0, to: 0, weight: '2' }]);
    });

    await t.check('matrix cases validate row lengths, number syntax and drawing limits', () => {
        const opts = { format: 'matrix', base: 1 };
        const second = parseGraph('2\n2\n0 1\n1 0\n1\n3\n', { ...opts, multi: true, testIndex: 1 });
        assert.equal(second.tests, 2);
        assert.equal(second.count, 1);
        assert.deepEqual(second.edges, [{ from: 0, to: 0, weight: '3' }]);
        const malformed = parseGraph('3\n0 1 0\n\nNaN 0 1\n0 0', opts);
        assert.equal(malformed.count, 0);
        assert.deepEqual(malformed.unparsed.map(row => row.line), [4, 5]);
        assert.deepEqual(parseGraph('3\n0 1 0', opts).issues, [['Expected {0} matrix rows. Found {1}.', 3, 1]]);
        assert.equal(parseGraph('301\n0', opts).count, 0);
        const dense = parseGraph('60\n' + `${'1 '.repeat(60)}\n`.repeat(60), opts);
        assert.equal(dense.edges.length, 1500);
        assert.deepEqual(dense.issues, [['Only the first {0} edges are shown.', 1500]]);
    });

    await t.check('compact binary matrices are accepted and unambiguous matrices are guessed', () => {
        const compact = '0100\n1010\n0101\n0010';
        const options = { format: 'matrix', base: 1 };
        assert.equal(parseGraph(compact, options).edges.length, 3);
        assert.equal(parseGraph(`4\n${compact}`, options).count, 4);
        assert.equal(parseGraph(`2\n2\n01\n10\n4\n${compact}`, { ...options, multi: true, testIndex: 1 }).count, 4);
        assert.equal(guessGraphFormat(compact).format, 'matrix');
        assert.equal(guessGraphFormat(`4\n${compact.replace(/[01]{4}/g, row => [...row].join(' '))}`).format, 'matrix');
        assert.equal(guessGraphFormat('3\n1 2 7\n2 3 8\n3 1 9').format, 'n');
        assert.equal(guessGraphFormat('0 1\n1 0').format, 'edges');
    });

    await t.check('adding an isolated node updates the source and preserves existing edges', () => {
        assert.deepEqual(addGraphNode('', { format: 'auto' }), { input: '1 0\n', format: 'nm', multi: false });
        assert.deepEqual(addGraphNode('', { format: 'matrix' }), { input: '1\n0\n', format: 'matrix', multi: false });
        const inputs = [
            ['nm', '3 2 88\n1 2\n2 3\nqueries', '4 2 88\n1 2\n2 3\nqueries'],
            ['n', ' 3  \n1 2\n2 3', ' 4  \n1 2\n2 3'],
            ['edges', '1 2\n2 3', '4\n1 2\n2 3'],
            ['parents', '3\n1 2', '4\n0 1 2 0'],
            ['matrix', '2\n01\n10\nqueries', '3\n010\n100\n000\nqueries'],
            ['matrix', '0 1\n1 0', '0 1 0\n1 0 0\n0 0 0'],
            ['matrix', '2\n01\n1 0', '3\n0 1 0\n1 0 0\n0 0 0'],
        ];
        for (const [format, before, expected] of inputs) {
            const options = { format, base: 1 };
            const previous = parseGraph(before, options);
            const next = addGraphNode(before, options);
            assert.equal(next.input, expected);
            const graph = parseGraph(next.input, { ...options, format: next.format });
            assert.equal(graph.count, previous.count + 1);
            assert.deepEqual(graph.edges, previous.edges);
        }
    });

    await t.check('adding a node to one case preserves neighboring cases and malformed input', () => {
        const options = { format: 'matrix', base: 1, multi: true, testIndex: 1 };
        const multi = '3\n2\n01\n10\n2\n00\n10\n1\n0\n';
        const next = addGraphNode(multi, options);
        assert.equal(next.input, '3\n2\n01\n10\n3\n000\n100\n000\n1\n0\n');
        assert.equal(parseGraph(next.input, options).count, 3);
        assert.equal(addGraphNode('3\n0 1', options), null);
        assert.equal(addGraphNode('300 0', { format: 'nm', base: 1 }), null);
        assert.equal(addGraphNode('1\n2\n1 2', { format: 'n', base: 1, multi: true }), null);
    });

    await t.check('editing counted edges keeps other cases, header arguments and duplicate edge weights', () => {
        const opts = { format: 'nm', base: 1, multi: true, testIndex: 1 };
        const input = '2\n2 1\n1 2\n3 2 99\n1 2 6\n1 2 7\nqueries\n';
        const connected = editGraphInput(input, opts, { type: 'connect', from: 1, to: 2 });
        assert.equal(connected.input, '2\n2 1\n1 2\n3 3 99\n1 2 6\n1 2 7\n2 3\nqueries\n');
        const weighted = editGraphInput(connected.input, opts, { type: 'weight', index: 1, weight: '-2.5' });
        assert.match(weighted.input, /1 2 6\n1 2 -2\.5/);
        const deleted = editGraphInput(weighted.input, opts, { type: 'deleteEdge', index: 0 });
        assert.equal(deleted.input, '2\n2 1\n1 2\n3 2 99\n1 2 -2.5\n2 3\nqueries\n');
        assert.ok(editGraphInput(deleted.input, opts, { type: 'deleteNode', node: 0 }).issue);
    });

    await t.check('matrix edits preserve direction and mirror symmetric edges only', () => {
        const opts = { format: 'matrix', base: 0 };
        const input = '010\n101\n010\n';
        const weighted = editGraphInput(input, opts, { type: 'weight', index: 1, weight: '2.5' });
        assert.equal(weighted.input, '010\n1 0 2.5\n0 2.5 0\n');
        const removed = editGraphInput(weighted.input, { ...opts, directed: true }, { type: 'deleteEdge', index: 2 });
        assert.equal(removed.input, '010\n1 0 0\n0 2.5 0\n');
        assert.ok(editGraphInput(input, opts, { type: 'weight', index: 0, weight: '0' }).issue);
        const deleted = editGraphInput(input, opts, { type: 'deleteNode', node: 1 });
        assert.equal(deleted.input, '00\n00\n');
    });

    await t.check('topology edits keep node counts and respect tree input constraints', () => {
        const bare = editGraphInput('1 2\n', { format: 'edges', base: 1 }, { type: 'deleteEdge', index: 0 });
        assert.equal(bare.format, 'n');
        assert.equal(bare.input, '2\n');
        const tree = { format: 'n', base: 1, multi: true };
        assert.equal(editGraphInput('2\n3\n1 2\n1 3\n1\n', tree, { type: 'deleteNode', node: 1 }).input, '2\n2\n1 2\n1\n');
        assert.ok(editGraphInput('2\n3\n1 2\n1 3\n1\n', tree, { type: 'deleteEdge', index: 0 }).issue);
        const parents = { format: 'parents', base: 1 };
        assert.ok(editGraphInput('3\n1 2\n', parents, { type: 'deleteEdge', index: 1 }).issue);
        assert.equal(editGraphInput('3\n0 0 2\n', parents, { type: 'connect', from: 0, to: 1 }).input, '3\n0 1 2\n');
    });

    await t.check('graph limits bound the layout and diagnostic list', () => {
        assert.equal(parseGraph('301\n0 1', { format: 'n', base: 0 }).count, 0);
        const crowded = parseGraph('300\n' + '0 1\n'.repeat(1501), { format: 'n', base: 0 });
        assert.equal(crowded.edges.length, 1500);
        assert.equal(crowded.issues.length, 1);
        const invalid = parseGraph('2\n' + 'x\n'.repeat(100), { format: 'n', base: 0 });
        assert.equal(invalid.unparsedCount, 100);
        assert.equal(invalid.unparsed.length, 30);
        const positions = layoutGraph(300, [{ from: 0, to: 1 }, { from: 2, to: 2 }]);
        assert.equal(positions.length, 300);
        assert.ok(positions.every(({ x, y }) => x >= 40 && x <= 780 && y >= 40 && y <= 420));
    });

    await t.check('check flags match the platform and keep quoted include arguments', () => {
        const flags = '-std=c++20 -I"my headers" -O2 -g0 -flto -s -fsanitize=undefined';
        const win = splitFlags(instrumentationFlags(flags, 'checks', { windows: true, sanitizers: false }));
        assert.deepEqual(win, ['-std=c++20', '-Imy headers', '-g', '-O0', '-D_GLIBCXX_DEBUG']);
        const linux = splitFlags(instrumentationFlags(flags, 'checks', { windows: false, sanitizers: true }));
        assert.ok(linux.includes('-D_GLIBCXX_DEBUG_PEDANTIC'));
        assert.ok(linux.includes('-fsanitize=address,undefined'));
        assert.ok(linux.includes('-fno-sanitize-recover=all'));
        const fallback = instrumentationFlags(flags, 'checks', { windows: false, sanitizers: false });
        assert.doesNotMatch(fallback, /sanitize/);
    });

    await t.check('profile flags retain symbols and the flat profile stops at 15 rows', () => {
        assert.equal(instrumentationFlags('-O3 -s -flto -DLOCAL', 'profile', {}), '-DLOCAL -g -O0 -pg');
        assert.match(instrumentationFlags('', 'profile', { windows: true }), /-pg -no-pie$/);
        const header = 'Flat profile:\n\n  %   cumulative   self              self     total\n time   seconds   seconds    calls  ms/call  ms/call  name';
        const input = header + '\n' + Array.from({ length: 19 }, (_, i) => `  0.00 0.00 0.00 1 0.00 0.00 function_${i}`).join('\n');
        const output = summarizeFlatProfile(input);
        assert.equal(output.split('\n').length, header.split('\n').length + 15);
        assert.match(output, /function_14/);
        assert.doesNotMatch(output, /function_15/);
        assert.equal(summarizeFlatProfile(header), '');
    });

    await t.check('the graph format and numbering are guessed from the input', () => {
        assert.deepEqual(pick(guessGraphFormat('4 3\n1 2\n2 3\n3 4\n')), { format: 'nm', base: 1 });
        assert.deepEqual(pick(guessGraphFormat('3 2\n0 1\n1 2\n')), { format: 'nm', base: 0 });
        assert.deepEqual(pick(guessGraphFormat('4\n1 2\n2 3\n2 4\n')), { format: 'n', base: 1 });
        assert.deepEqual(pick(guessGraphFormat('5\n1 1 2 2\n')), { format: 'parents', base: 1 });
    });

    await t.check('a tree is laid out top-down: children one layer under their parent, no overlap', () => {
        // 0 -> 1, 2; 1 -> 3, 4; 2 -> 5
        const edges = [[0, 1], [0, 2], [1, 3], [1, 4], [2, 5]].map(([from, to]) => ({ from, to }));
        const p = treeLayout(6, edges);
        for (const { from, to } of edges) assert.ok(p[to].y > p[from].y, `${to} below ${from}`);
        assert.ok(p[3].x < p[4].x && p[4].x < p[5].x, 'leaves left to right');
        assert.ok(p[1].x > p[3].x && p[1].x < p[4].x, 'a parent sits over its children');
        assert.equal(treeLayout(3, [{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 0 }]), null, 'a cycle is not a tree');
        assert.equal(layoutGraph(6, edges)[3].y, p[3].y, 'layoutGraph uses it');
    });

    await t.check('repeated edges are drawn once with their count and weights', () => {
        const edges = [{ from: 0, to: 1, weight: '5' }, { from: 1, to: 0, weight: '7' }, { from: 0, to: 1, weight: '5' }, { from: 1, to: 2 }];
        assert.deepEqual(mergeEdges(edges, false), [
            { from: 0, to: 1, count: 3, weights: ['5', '7'] },
            { from: 1, to: 2, count: 1, weights: [] },
        ]);
        assert.equal(mergeEdges(edges, true).length, 3, 'u v and v u differ when directed');
    });

    t.finish();
}

function pick({ format, base, multi }) { return multi === undefined || multi === false ? { format, base } : { format, base, multi }; }

main().catch(error => { console.error(error); process.exitCode = 1; });
