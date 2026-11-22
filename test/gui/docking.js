#!/usr/bin/env node
'use strict';

/*
 * Docking Terminal and I/O into the bottom panel by real drag and drop: exactly one body shows,
 * and elements go back where they came from.
 *   node test/gui/docking.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchApp, checker } = require('../helpers/app');

/** Which bodies of the bottom panel are really on screen. */
const shownBodies = page => page.evaluate(() => {
    const panel = document.getElementById('problems-panel');
    const on = el => !!el && el.getClientRects().length > 0;
    const bodies = {
        problems: panel.querySelector('.problems-body'),
        tests: document.getElementById('tests-results-list'),
        stress: document.getElementById('stress-body'),
        io: panel.querySelector('.docked-io-view'),
        terminal: panel.querySelector(':scope > .terminal-view'),
    };
    return Object.keys(bodies).filter(k => on(bodies[k]));
});
const activeTab = page => page.evaluate(() => {
    const list = [...document.querySelectorAll('#problems-panel .panel-head .panel-title.active')];
    return list.map(t => t.firstChild.textContent.trim());
});

async function main() {
    const t = checker();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sameko-dock-'));
    const inputFile = path.join(dir, 'big.inp');
    fs.writeFileSync(inputFile, '1 2 3\n');
    const { page, pageErrors, close } = await launchApp({
        settings: { appearance: { theme: 'kawaii-dark', language: 'en' }, panels: { showIO: true, terminalDocked: false, ioDocked: false, showTerm: true } },
    });
    page.setDefaultTimeout(10000);
    const panel = page.locator('#problems-panel');
    const tab = name => page.locator('#problems-panel .panel-head .panel-title', { hasText: name }).first();
    const open = name => page.evaluate(n => showBottomPanel(n), name);

    try {
        await page.evaluate(() => {
            newFile();
            App.showIO = true;
            App.showProblems = true;
            updateUI();
            setBottomPanelCollapsed(false);
            ccProblem = { name: 'D', tests: [{ input: '1\n', output: '1\n' }] };
            ccTestIndex = -1;
            updateTestNavUI();
            renderTestResults();
            switchDockedPanel('problems');
            document.getElementById('input-area').value = 'typed text';
        });

        await t.check('dragging I/O onto the panel opens it, alone', async () => {
            await page.locator('#io-section .io-panel-input .panel-head .panel-title').dragTo(panel);
            await page.waitForFunction(() => DockingState.ioDocked);
            assert.deepEqual(await shownBodies(page), ['io']);
            assert.deepEqual(await activeTab(page), ['I/O']);
            assert.equal(await page.locator('#input-area').inputValue(), 'typed text');
        });

        await t.check('PROBLEMS after docking shows no I/O (the reported bug)', async () => {
            await open('problems');
            assert.deepEqual(await shownBodies(page), ['problems']);
            assert.deepEqual(await activeTab(page), ['PROBLEMS']);
        });

        await t.check('every tab shows exactly its own body', async () => {
            for (const name of ['tests', 'stress', 'io', 'problems']) {
                await open(name);
                assert.deepEqual(await shownBodies(page), [name]);
            }
        });

        await t.check('docking the terminal too keeps one body per tab', async () => {
            await page.locator('#terminal-section .panel-head .panel-title').first().dragTo(panel);
            await page.waitForFunction(() => DockingState.terminalDocked);
            assert.deepEqual(await shownBodies(page), ['terminal']);
            for (const name of ['io', 'tests', 'terminal', 'problems']) {
                await open(name);
                assert.deepEqual(await shownBodies(page), [name]);
            }
        });

        await t.check('letting a docked tab go over the panel keeps it docked', async () => {
            await open('problems');
            await tab('I/O').dragTo(page.locator('#problems-list'));
            await page.waitForTimeout(150);
            assert.equal(await page.evaluate(() => DockingState.ioDocked), true);
            assert.deepEqual(await shownBodies(page), ['problems']);
        });

        await t.check('an input file attached while docked replaces the box', async () => {
            await open('io');
            await page.evaluate(f => setInputFile(f), inputFile);
            await page.locator('#input-file-head').waitFor();
            assert.match(await page.locator('#input-file-head').textContent(), /1 2 3/);
            assert.equal(await page.locator('#input-area').isVisible(), false);
            await page.evaluate(() => setInputFile(null));
            assert.equal(await page.locator('#input-area').isVisible(), true);
        });

        await t.check('dragging the tab out puts everything back in its place', async () => {
            await open('problems');
            await tab('I/O').dragTo(page.locator('.editor-section .monaco-editor').first());
            await page.waitForFunction(() => !DockingState.ioDocked);
            const order = await page.evaluate(() => ({
                input: [...document.querySelector('.io-panel-input').children].map(e => e.id).filter(Boolean),
                expected: [...document.querySelector('.io-panel-expected').children].map(e => e.id).filter(Boolean),
                leftovers: document.querySelectorAll('.docked-io-view, #docked-io-tab').length,
            }));
            assert.deepEqual(order.input, ['input-area', 'input-file']);
            assert.deepEqual(order.expected, ['expected-area', 'expected-diff']);
            assert.equal(order.leftovers, 0);
            assert.equal(await page.locator('#input-area').inputValue(), 'typed text');
            assert.deepEqual(await activeTab(page), ['PROBLEMS']);
        });

        await t.check('a docked I/O restored at startup does not open over PROBLEMS', async () => {
            await page.evaluate(() => {
                switchDockedPanel('problems');
                dockIOToProblems({ open: false });
            });
            assert.deepEqual(await shownBodies(page), ['problems']);
            await page.evaluate(() => undockIO());
        });

        await t.check('no page errors', async () => assert.deepEqual(pageErrors, []));
    } finally {
        await close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
    t.finish();
}

main().catch((err) => { console.error(err); process.exit(1); });
