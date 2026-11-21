'use strict';

const assert = require('node:assert/strict');
const { checker } = require('../helpers/app');
const { parseGraph, layoutGraph, treeLayout, guessGraphFormat, mergeEdges } = require('../../src/renderer/app/test-row-tools');
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
