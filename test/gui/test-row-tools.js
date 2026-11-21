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
            await page.waitForFunction(() => window.testDebugStops.length > 0, null, { timeout: 20000 });
            const body = lineFor('int n = 0');
            if (await page.evaluate(() => window.testDebugStops.at(-1)?.frame?.line) < body) {
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

        await t.check('test tools have no renderer errors', () => assert.deepEqual(pageErrors, []));
    } finally {
        await close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
    t.finish();
}

main().catch(error => { console.error(error); process.exitCode = 1; });
