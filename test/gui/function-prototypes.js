'use strict';

// Add Function Prototypes in the real editor (issue #78): the action, one undo step,
// and the quick fix offered on "'f' was not declared in this scope".

const { launchApp, checker } = require('../helpers/app');

const SOURCE = 'int main() {\n    return (int)loadArray(nullptr, 3);\n}\n\nfloat loadArray(float inputArray[], int N) { return 0; }\n';

(async () => {
    const t = checker();
    // IntelliSense off: the quick-fix menu then lists the local fixes without waiting for clangd.
    const { page, pageErrors, close } = await launchApp({ settings: { editor: { intellisense: false } } });
    try {
        await page.evaluate((src) => { newFile(); setTabText(App.tabs.find(x => x.id === App.activeTabId), src); }, SOURCE);

        await t.check('the action is registered and enabled on a C++ tab', async () => {
            const ok = await page.evaluate(() => {
                const a = App.editor.getAction('sameko-add-function-prototypes');
                return !!a && a.isSupported() && a.label;
            });
            if (ok !== 'Add Function Prototypes') throw new Error('action: ' + ok);
        });

        await t.check('running it adds the prototype above main', async () => {
            const text = await page.evaluate(async () => {
                await App.editor.getAction('sameko-add-function-prototypes').run();
                return App.editor.getModel().getValue();
            });
            if (!text.startsWith('float loadArray(float[], int);\n\nint main() {')) throw new Error(JSON.stringify(text.slice(0, 80)));
        });

        await t.check('a second run adds nothing', async () => {
            const n = await page.evaluate(() => addFunctionPrototypes(App.editor));
            if (n !== 0) throw new Error('added ' + n);
        });

        await t.check('one Ctrl+Z undoes it', async () => {
            const text = await page.evaluate(() => { App.editor.trigger('test', 'undo'); return App.editor.getModel().getValue(); });
            if (text !== SOURCE) throw new Error(JSON.stringify(text.slice(0, 80)));
        });

        await t.check('quick fix on a not-declared error', async () => {
            const titles = await page.evaluate(async () => {
                const model = App.editor.getModel();
                monaco.editor.setModelMarkers(model, CppLanguageTools.buildSource, [{
                    severity: monaco.MarkerSeverity.Error, message: '‘loadArray’ was not declared in this scope',
                    startLineNumber: 2, startColumn: 17, endLineNumber: 2, endColumn: 26, source: CppLanguageTools.buildSource,
                }]);
                App.editor.setPosition({ lineNumber: 2, column: 20 });
                App.editor.trigger('test', 'editor.action.quickFix');
                for (let i = 0; i < 150; i++) {
                    const rows = [...document.querySelectorAll('.action-widget .action-label, .action-widget .title')].map(e => e.textContent.trim()).filter(Boolean);
                    if (rows.length) return rows;
                    await new Promise(r => setTimeout(r, 100));
                }
                return [];
            });
            if (!titles.some(x => x.includes('Add function prototypes above main'))) throw new Error(JSON.stringify(titles));
        });

        await t.check('no page errors', async () => {
            if (pageErrors.length) throw new Error(pageErrors.join('\n'));
        });
    } finally {
        await close();
    }
    t.finish();
})().catch((e) => { console.error(e); process.exit(1); });
