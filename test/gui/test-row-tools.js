'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchApp, checker } = require('../helpers/app');

const SOURCE = `#include <iostream>
#include <vector>
int spin(int n) {
    volatile unsigned sum = 0;
    for (unsigned i = 0; i < 30000000; ++i) sum = sum + i % 5;
    return n + (sum == 0);
}
int main() {
    int n = 0;
    std::cin >> n;
    int a[205] = {};
    std::vector<int> v = {0, 5};
    if (n < 0) return v[9];
    a[0] = n;
    v[0] = n;
    n++;
    n++;
    std::cout << (n == 43 ? spin(n) : n) << '\\n';
}
`;
const TESTS = [
    { input: '-1\n', output: 'should fail' },
    { input: '41\n', output: '43\n' },
    { input: '4 3\n0 1 7\n1 2\nbad edge\n', output: '' },
    { input: '', output: '0\n' },
    { input: '3\n3 2\n1 2\n2 3\n2 1\n1 2\n4 3\n1 2\n1 3\n1 4\n', output: '' },
    { input: '3\n0 1 0\n1 0 4\n0 4 0', output: '' },
];

async function main() {
    const t = checker();
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sameko-row-tools-')));
    const file = path.join(dir, 'tools.cpp');
    fs.writeFileSync(file, SOURCE);
    // SHOT_DIR=<dir> saves a screenshot at each step for a visual check; SHOT_THEME picks the theme.
    const { page, pageErrors, close } = await launchApp({ settings: { appearance: { theme: process.env.SHOT_THEME || 'kawaii-dark', language: 'en' } } });
    page.setDefaultTimeout(8000);
    const shot = async name => { if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, name + '.png') }); };
    try {
        await page.evaluate(async ({ file, tests }) => {
            localStorage.setItem('sameko-debug-guide-seen', '1');
            await openFileFromPath(file);
            ccProblem = { name: 'Test tools', tests };
            batchTestResults = [];
            updateTestNavUI();
            showTestsTab();
            setBottomPanelCollapsed(false);
            renderTestResults();
            document.getElementById('input-area').value = '99\n';
        }, { file, tests: TESTS });
        const row = i => page.locator(`.test-result-item[data-index="${i}"]`);
        const dialog = page.locator('.test-tool-dialog');
        const tool = (i, name) => row(i).locator(`[data-test-tool="${name}"]`);
        const closeDialog = async () => {
            if (await dialog.isVisible()) {
                await page.keyboard.press('Escape');
                await dialog.waitFor({ state: 'detached' });
            }
        };

        await t.check('graph confirmation, directed edges, weights and numbered malformed lines', async () => {
            await row(2).hover();
            await shot('rows');
            await tool(2, 'graph').click();
            assert.equal(await dialog.getByRole('textbox', { name: 'Graph input' }).inputValue(), TESTS[2].input);
            await dialog.locator('select[name=direction]').selectOption('directed');
            await dialog.locator('select[name=base]').selectOption('0');
            // The format is guessed and drawn at once; changing an option redraws.
            assert.equal(await dialog.locator('select[name=format]').inputValue(), 'nm');
            assert.equal(await dialog.locator('.test-graph circle').count(), 4);
            assert.equal(await dialog.locator('.test-graph-edge[marker-end]').count(), 2);
            assert.equal(await dialog.locator('.test-graph-weight').textContent(), '7');
            assert.match(await dialog.locator('details').textContent(), /Line 4\s*bad edge/);
            // A node follows the mouse when dragged; its edges follow it.
            const node = dialog.locator('.test-graph-node').first();
            const before = await node.getAttribute('transform');
            const edgeBefore = await dialog.locator('.test-graph-edge').first().getAttribute('x1');
            const box = await node.boundingBox();
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.down();
            await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 40, { steps: 5 });
            await page.mouse.up();
            assert.notEqual(await node.getAttribute('transform'), before, 'the node moved');
            assert.notEqual(await dialog.locator('.test-graph-edge').first().getAttribute('x1'), edgeBefore, 'its edge moved');
            await shot('graph');
            await page.keyboard.press('Escape');
            await dialog.waitFor({ state: 'detached' });
            assert.equal(await tool(2, 'graph').evaluate(el => el === document.activeElement), true);
        });

        await closeDialog();
        await t.check('an input with several cases opens on case 1, with a picker that steps through them', async () => {
            await tool(4, 'graph').click();
            assert.equal(await dialog.locator('select[name=multi]').inputValue(), '1');
            const picker = dialog.locator('.test-graph-cases');
            await picker.waitFor();
            assert.equal(await dialog.locator('.test-graph-case option').count(), 3);
            assert.equal(await dialog.locator('.test-graph circle').count(), 3);
            await shot('cases');
            await picker.getByRole('button', { name: 'Next case' }).click();
            assert.equal(await dialog.locator('.test-graph circle').count(), 2);
            await dialog.locator('.test-graph-case').selectOption('2');
            assert.equal(await dialog.locator('.test-graph circle').count(), 4);
            assert.equal(await picker.getByRole('button', { name: 'Next case' }).isDisabled(), true);
            await page.keyboard.press('Escape');
            await dialog.waitFor({ state: 'detached' });
        });

        await closeDialog();
        await t.check('Graph Preview accepts pasted input without altering the current tests or I/O', async () => {
            await page.locator('.menu-btn[data-menu=view]').click();
            await page.locator('#menu-view [data-action=graphpreview]').click();
            await dialog.getByRole('heading', { name: 'Graph Preview' }).waitFor();
            const source = dialog.getByRole('textbox', { name: 'Graph input' });
            assert.equal(await source.evaluate(el => el === document.activeElement), true);
            await source.fill('3 2\n0 1\n1 2');
            await dialog.getByRole('button', { name: 'Draw graph' }).click();
            assert.equal(await dialog.locator('select[name=base]').inputValue(), '0');
            assert.equal(await dialog.locator('.test-graph circle').count(), 3);
            assert.equal(await dialog.locator('.test-graph-edge').count(), 2);
            await source.fill('0 0\n1 0');
            await dialog.locator('select[name=format]').selectOption('matrix');
            await dialog.locator('select[name=direction]').selectOption('directed');
            await dialog.getByRole('button', { name: 'Draw graph' }).click();
            assert.equal(await dialog.locator('.test-graph circle').count(), 2);
            assert.equal(await dialog.locator('.test-graph-edge[marker-end]').count(), 1);
            await shot('standalone-graph');
            await closeDialog();
            assert.equal(await page.locator('#input-area').inputValue(), '99\n');
            assert.deepEqual(await page.evaluate(() => ccProblem.tests), TESTS);
        });

        await closeDialog();
        await t.check('a test row can be drawn as an adjacency matrix', async () => {
            await tool(5, 'graph').click();
            await dialog.locator('select[name=format]').selectOption('matrix');
            assert.equal(await dialog.locator('.test-graph-summary').textContent(), '3 nodes · 2 edges');
            assert.deepEqual(await dialog.locator('.test-graph-weight').allTextContents(), ['1', '4']);
            await dialog.locator('select[name=direction]').selectOption('directed');
            assert.equal(await dialog.locator('.test-graph-edge[marker-end]').count(), 4);
            const labels = await dialog.locator('.test-graph-weight').evaluateAll(elements => elements.map(el => [el.getAttribute('x'), el.getAttribute('y')]));
            assert.notDeepEqual(labels[0], labels[1], 'weights on opposite edges stay readable');
            await closeDialog();
        });

        await closeDialog();
        await t.check('right-click graph editing connects nodes and updates an existing test only on demand', async () => {
            await tool(5, 'graph').click();
            const source = dialog.getByRole('textbox', { name: 'Graph input' });
            const original = await page.evaluate(() => JSON.parse(JSON.stringify(ccProblem.tests[5])));
            const nodes = dialog.locator('.test-graph-node');

            await nodes.nth(0).click({ button: 'right' });
            await dialog.getByRole('button', { name: 'Connect edge', exact: true }).click();
            await nodes.nth(2).click();
            await page.waitForFunction(() => {
                const source = document.querySelector('.test-tool-dialog [name="source"]');
                const graph = TestRowTools.parseGraph(source.value, { format: 'matrix', base: 1 });
                return graph.edges.some(edge => edge.from === 0 && edge.to === 2);
            });
            assert.deepEqual(await page.evaluate(() => ccProblem.tests[5]), original,
                'connecting a preview does not mutate the test yet');

            const openFirstEdge = async () => {
                const edgeHit = dialog.locator('.test-graph-edge-hit').first();
                const point = await edgeHit.evaluate(edge => {
                    const midpoint = edge.getPointAtLength(edge.getTotalLength() / 2).matrixTransform(edge.getScreenCTM());
                    return { x: midpoint.x, y: midpoint.y };
                });
                await page.mouse.click(point.x, point.y, { button: 'right' });
            };
            await openFirstEdge();
            const weight = dialog.getByRole('textbox', { name: 'Weight', exact: true });
            await weight.fill('9');
            await shot('graph-context-edit');
            await dialog.getByRole('button', { name: 'Apply weight', exact: true }).click();
            await page.waitForFunction(() => {
                const source = document.querySelector('.test-tool-dialog [name="source"]');
                const graph = TestRowTools.parseGraph(source.value, { format: 'matrix', base: 1 });
                return graph.edges.some(edge => edge.weight === '9');
            });
            assert.deepEqual(await page.evaluate(() => ccProblem.tests[5]), original,
                'editing a preview does not mutate the test yet');

            await openFirstEdge();
            await dialog.getByRole('button', { name: 'Delete edge', exact: true }).click();
            assert.equal(await dialog.locator('.test-graph-edge').count(), 2);
            await dialog.getByRole('button', { name: 'Undo graph edit', exact: true }).click();
            assert.equal(await dialog.locator('.test-graph-edge').count(), 3);

            await dialog.getByRole('button', { name: 'Update test', exact: true }).click();
            await page.waitForFunction(() => ccProblem.tests[5].input.includes('9'));
            assert.equal(await page.evaluate(() => ccProblem.tests[5].output), original.output,
                'updating the graph preserves the expected output');
            await closeDialog();
        });

        await closeDialog();
        let judgePath;
        await t.check('a failing row re-runs with STL checks and keeps the judge binary', async () => {
            await page.evaluate(() => runSingleTestByIndex(0));
            assert.equal(await tool(1, 'checks').count(), 0);
            judgePath = await page.evaluate(() => App.exePath);
            const before = fs.statSync(judgePath);
            await tool(0, 'checks').click();
            await dialog.getByText('Diagnostics', { exact: true }).waitFor({ timeout: 60000 });
            assert.match(await dialog.locator('pre').first().textContent(), /out.of.bounds|subscript/i);
            await shot('checks');
            assert.equal(await page.evaluate(() => App.exePath), judgePath);
            assert.equal(fs.statSync(judgePath).mtimeMs, before.mtimeMs);
            assert.ok(fs.existsSync(judgePath.replace(/-judge(?=\.|$)/, '-checks')));
            await dialog.getByRole('button', { name: 'Close' }).click();
        });

        await closeDialog();
        // macOS has no gprof.
        if (process.platform !== 'darwin') await t.check('gprof reads the selected input and shows the flat profile without changing the judge build', async () => {
            await tool(1, 'profile').click();
            const status = dialog.locator('[role=status]');
            await page.waitForFunction(() => document.querySelector('.test-tool-dialog [role=status]')?.textContent !== 'Building and running this test…', null, { timeout: 60000 });
            assert.match(await status.textContent(), /^Run finished$/, await dialog.innerText());
            assert.match(await dialog.locator('pre').textContent(), /spin\(int\)/);
            await shot('profile');
            assert.equal(await page.evaluate(() => App.exePath), judgePath);
            await dialog.getByRole('button', { name: 'Close' }).click();
        });
        await closeDialog();

        const waitLine = line => page.waitForFunction(wanted => window.testDebugStops.at(-1)?.frame?.line === wanted, line, { timeout: 20000 });
        const lineFor = snippet => SOURCE.split('\n').findIndex(line => line.includes(snippet)) + 1;
        // GCC on Linux may stop first on `int main() {` (stack protector setup), one step earlier.
        const waitBody = async () => {
            const body = lineFor('int n = 0');
            const opening = lineFor('int main()');
            // Only a stop on one of these two lines counts: LLDB can report a stop with no line yet.
            await page.waitForFunction(lines => lines.includes(window.testDebugStops.at(-1)?.frame?.line), [opening, body], { timeout: 20000 });
            if (await page.evaluate(() => window.testDebugStops.at(-1).frame.line) === opening) {
                const n = await page.evaluate(() => window.testDebugStops.length);
                await page.evaluate(() => Debugger.stepOver());
                await page.waitForFunction(count => window.testDebugStops.length > count, n, { timeout: 20000 });
            }
            await waitLine(body);
        };
        const watch = async expr => {
            const field = page.locator('#sdbg-watchin');
            await field.fill(expr);
            await field.press('Enter');
            await page.locator('#sdbg-watch .sdbg-name').getByText(expr, { exact: true }).waitFor();
        };
        const watchRow = expr => page.locator('#sdbg-watch .sdbg-row').filter({ has: page.locator('.sdbg-name').getByText(expr, { exact: true }) });
        const arrayRow = expr => page.locator(`#sdbg-watch .sdbg-row:has(.sdbg-watchpoint[data-expr="${expr}"]) + .sdbg-array`);
        const step = async () => {
            const n = await page.evaluate(() => window.testDebugStops.length);
            await page.evaluate(() => Debugger.stepOver());
            await page.waitForFunction(count => window.testDebugStops.length > count, n, { timeout: 20000 });
        };

        await t.check('Debug this test uses the clicked row as stdin and pauses in main', async () => {
            await page.evaluate(() => {
                window.testDebugStops = [];
                window.electronAPI.onDebugStopped(value => window.testDebugStops.push(value));
            });
            await tool(1, 'debug').click();
            await waitBody();
            for (let i = 0; i < 5; i++) await step();
            await waitLine(lineFor('a[0] = n'));
            await watch('n');
            assert.equal(await watchRow('n').locator('.sdbg-val').textContent(), '41');
        });

        await t.check('watch arrays and vectors show indexed, capped cells and highlight changes by stop', async () => {
            await watch('a');
            await arrayRow('a').waitFor();
            assert.equal(await arrayRow('a').locator('.sdbg-array-cell').count(), 200);
            assert.match(await arrayRow('a').textContent(), /Showing the first 200 elements/);
            await watch('v');
            await arrayRow('v').waitFor();
            assert.deepEqual(await arrayRow('v').locator('.sdbg-array-cell').allTextContents(), ['[0]0', '[1]5']);
            await step();
            assert.equal(await arrayRow('a').locator('.sdbg-array-cell.changed').textContent(), '[0]41');
            await step();
            assert.equal(await arrayRow('v').locator('.sdbg-array-cell.changed').textContent(), '[0]41');
            assert.equal(await arrayRow('a').locator('.sdbg-array-cell.changed').count(), 0);
            await shot('arrays');
        });

        await t.check('a GDB watchpoint stops with old/new values and can be removed', async () => {
            const button = watchRow('n').locator('.sdbg-watchpoint');
            await button.click();
            await watchRow('n').locator('.sdbg-watchpoint[aria-pressed=true]').waitFor();
            await page.evaluate(() => Debugger.continue());
            const hit = page.locator('.sdbg-watchpoint-hit');
            await hit.waitFor({ timeout: 20000 });
            assert.deepEqual(await hit.locator('code').allTextContents(), ['n', '41', '42']);
            await shot('watchpoint');
            await button.click();
            await watchRow('n').locator('.sdbg-watchpoint[aria-pressed=false]:enabled').waitFor();
            await page.evaluate(() => Debugger.continue());
            await page.waitForFunction(() => !Debugger.isActive());
            assert.equal(await page.evaluate(() => window.testDebugStops.filter(stop => stop.watchpoint).length), 1);
        });

        await t.check('debugging an empty test sends EOF to the program', async () => {
            await page.evaluate(() => { window.testDebugStops.length = 0; });
            await tool(3, 'debug').click();
            await waitBody();
            await page.evaluate(() => Debugger.continue());
            await page.waitForFunction(() => !Debugger.isActive());
        });

        await t.check('the Tests header opens Graph Preview and adds its input as the selected test', async () => {
            await page.evaluate(path => {
                dockIOToProblems({ open: false });
                showTestsTab();
                switchTestCase(0);
                setInputFile(path);
            }, file);
            const existingTests = await page.evaluate(() => ccProblem.tests);
            await page.locator('#btn-test-graph').click();
            const add = dialog.getByRole('button', { name: 'Add to tests' });
            assert.equal(await add.isDisabled(), true);
            const source = dialog.getByRole('textbox', { name: 'Graph input' });
            const plus = dialog.getByRole('button', { name: 'Add node' });
            await plus.click();
            assert.equal(await source.inputValue(), '1 0\n');
            assert.equal(await dialog.locator('.test-graph circle').count(), 1);
            const draft = '0100\n1010\n0101\n0010\n';
            await source.fill(draft);
            await dialog.locator('select[name=format]').selectOption('auto');
            assert.equal(await dialog.locator('select[name=format]').inputValue(), 'matrix');
            await plus.click();
            const expanded = '01000\n10100\n01010\n00100\n00000\n';
            assert.equal(await source.inputValue(), expanded);
            assert.equal(await dialog.locator('.test-graph-summary').textContent(), '5 nodes · 3 edges');
            await shot('graph-add-to-tests');
            await add.click();
            await dialog.waitFor({ state: 'detached' });
            assert.deepEqual(await page.evaluate(() => ccProblem.tests), [...existingTests, { input: expanded, output: '' }]);
            assert.equal(await page.evaluate(() => ccTestIndex), existingTests.length);
            await page.locator('#problems-panel[data-view=io] #input-area').waitFor();
            assert.equal(await page.locator('#input-area').inputValue(), expanded);
            assert.equal(await page.locator('#expected-area').inputValue(), '');
            assert.equal(await page.evaluate(() => getTabInputFile(getPreferredTabId())), null);
        });

        await t.check('Graph Preview in floating and docked I/O starts with its current input', async () => {
            const data = '3 1\n1 3\n';
            await page.locator('#input-area').fill(data);
            await page.locator('#btn-docked-input-graph').click();
            assert.equal(await dialog.getByRole('textbox', { name: 'Graph input' }).inputValue(), data);
            await closeDialog();

            await page.evaluate(() => {
                undockIO();
                if (!App.showIO) toggleIO();
            });
            await page.locator('#btn-input-graph').click();
            assert.equal(await dialog.getByRole('textbox', { name: 'Graph input' }).inputValue(), data);
            await closeDialog();
        });

        await t.check('test tools have no renderer errors', () => assert.deepEqual(pageErrors, []));
    } finally {
        await close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
    t.finish();
}

main().catch(error => { console.error(error); process.exitCode = 1; });
