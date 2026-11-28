'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArgs } = require('node:util');

const SIZE = { width: 1440, height: 900 };
const GRAPH_INPUT = '5 6\n1 2 7\n1 3 2\n2 3 3\n2 4 5\n3 5 4\n4 5 1\n';

async function openThemeCustomizer(page, theme) {
    await page.evaluate(async themeId => {
        ThemeCustomizer.open(themeId);

        // Supply a repeatable still image alongside the builtin application video.
        const image = document.createElement('canvas');
        image.width = 320;
        image.height = 180;
        const ctx = image.getContext('2d');
        const gradient = ctx.createLinearGradient(0, 0, 320, 180);
        gradient.addColorStop(0, '#6559ab');
        gradient.addColorStop(1, '#e27fa5');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 320, 180);
        const blob = await new Promise(resolve => image.toBlob(resolve, 'image/webp'));
        const file = new File([blob], 'preview-background.webp', { type: blob.type });
        await ThemeCustomizer.setBackgroundFile(file, 'editorBackground');
    }, theme);
    await page.getByRole('heading', { name: 'Theme Customizer', exact: true }).waitFor();
    await page.waitForFunction(() => ThemeCustomizer.workingTheme?.colors?.editorBackground?.startsWith('file:'));
}

async function openTestGraph(page, profile) {
    const file = path.join(profile, 'graph.inp');
    fs.writeFileSync(file, GRAPH_INPUT);
    await page.evaluate(async ({ filePath, input }) => {
        await openFileFromPath(filePath);
        ccProblem = { name: 'Weighted graph', tests: [{ input, output: '' }] };
        ccTestIndex = 0;
        batchTestResults = [];
        updateTestNavUI();
        showTestsTab();
        setBottomPanelCollapsed(false);
        renderTestResults();
    }, { filePath: file, input: GRAPH_INPUT });

    await page.locator('.test-result-item[data-index="0"] [data-test-tool="graph"]').click();
    const dialog = page.locator('.test-tool-dialog');
    await dialog.locator('select[name="direction"]').selectOption('directed');
    await dialog.getByRole('img', { name: '5 nodes · 6 edges', exact: true }).waitFor();
    await dialog.locator('#test-graph-input').evaluate(input => {
        input.setSelectionRange(0, 0);
        input.scrollTop = 0;
    });
}

async function screenshot(page, scenario) {
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.locator('video[src]').evaluateAll(async videos => {
        const seeks = videos.map(video => {
            video.pause();
            if (!video.readyState || video.error || video.currentTime === 0) return;
            return new Promise(resolve => {
                video.addEventListener('seeked', resolve, { once: true });
                video.currentTime = 0;
            });
        });
        await Promise.race([Promise.all(seeks), new Promise(resolve => setTimeout(resolve, 500))]);
    });
    await page.mouse.move(0, 0);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sameko-preview-'));
    const file = path.join(dir, `${scenario}.png`);
    await page.screenshot({ path: file, animations: 'disabled', caret: 'hide', scale: 'css' });
    console.log(file);
}

async function main() {
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: {
            help: { type: 'boolean', short: 'h' },
            screenshot: { type: 'boolean' },
            theme: { type: 'string', default: 'kawaii-dark' },
        },
    });
    const [scenario] = positionals;
    if (values.help || !scenario) {
        console.log(`Usage: npm run dev:preview -- <theme-customizer|test-graph> [options]
  --theme <id>   Builtin theme (default: kawaii-dark)
  --screenshot  Capture a 1440 × 900 PNG to a temp file and close the preview
Without --screenshot the app stays open for interaction. Preview uses a temporary profile.`);
        return;
    }
    if (positionals.length !== 1 || !['theme-customizer', 'test-graph'].includes(scenario)) {
        throw new Error('Choose theme-customizer or test-graph. Run npm run dev:preview -- --help for usage.');
    }

    const { ROOT, launchApp } = require('../test/helpers/app');
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-monaco.js'), '--if-stale'],
        { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
    const theme = values.theme;
    const { page, profile, pageErrors, close } = await launchApp({
        settings: { appearance: { theme, language: 'en' }, windowBounds: SIZE },
    });
    try {
        page.setDefaultTimeout(10000);
        await page.waitForFunction(() => ThemeManager.builtinThemeIds.every(id => ThemeManager.themes.has(id)));
        if (!await page.evaluate(id => ThemeManager.builtinThemeIds.includes(id), theme)) {
            throw new Error(`Unknown builtin theme ${theme}.`);
        }
        if (values.screenshot) await page.setViewportSize(SIZE);
        if (scenario === 'theme-customizer') await openThemeCustomizer(page, theme);
        else await openTestGraph(page, profile);
        if (pageErrors.length) throw new Error(pageErrors.join('\n'));

        if (values.screenshot) await screenshot(page, scenario);
        else {
            console.log(`Preview ready: ${scenario}. Close the window to finish.`);
            if (!page.isClosed()) await page.waitForEvent('close', { timeout: 0 });
        }
    } finally {
        await close();
    }
}

main().catch(error => {
    console.error(`Preview failed: ${error.message}`);
    process.exitCode = 1;
});
