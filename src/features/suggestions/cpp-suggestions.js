window.registerCppIntellisense = function (monaco) {
    console.log('[Intellisense] Registering C/C++ Provider (Snippets + Clangd)...');

    // Resolve the tab that owns the given Monaco model. The app tracks tabs on
    // the global `App` object (App.tabs / App.activeTabId), NOT window.TabManager
    // (that module is never loaded in index.html). Handles the split editor by
    // matching the model against App.editor2 when present.
    const getActiveTabForModel = (model) => {
        if (typeof App === 'undefined' || !Array.isArray(App.tabs)) return null;
        let tabId = App.activeTabId;
        try {
            if (App.editor2 && model && App.editor2.getModel && model === App.editor2.getModel()) {
                tabId = App.splitTabId;
            }
        } catch (e) { /* editor2 may not exist */ }
        return App.tabs.find(t => t.id === tabId) || null;
    };

    // Always returns a non-empty, stable identifier for the document clangd
    // should analyze. Prefers the real saved path (so clangd resolves #includes
    // relative to it), then the tab id, and finally the Monaco model URI as a
    // last-resort fallback. This must NEVER return null/undefined — clangd is
    // called unconditionally, so a missing tab must not break completions.
    const clangdFileId = (model) => {
        const tab = getActiveTabForModel(model);
        if (tab && tab.path) return tab.path;
        if (tab && tab.id) return tab.id;
        try {
            if (model && model.uri && model.uri.toString) return model.uri.toString();
        } catch (e) { /* ignore */ }
        return 'untitled';
    };

    // ========================================================================
    // 1. DATA: SNIPPETS & TEMPLATES
    // ========================================================================
    const SNIPPETS = {
        cpp: [
            {
                label: 'cp', doc: 'CP Template',
                text: '#include <bits/stdc++.h>\nusing namespace std;\n\nusing ll = long long;\n\nvoid solve(){\n    ${0}\n}\n\nint main(){\n    ios_base::sync_with_stdio(false); cin.tie(NULL);\n    int t=1; cin >> t;\n    while(t--) solve();\n    return 0;\n}'
            },
            { label: 'cout', doc: 'Output', text: 'cout << ${1} << "\\n";' },
            { label: 'cin', doc: 'Input', text: 'cin >> ${1};' },
            { label: 'all', doc: 'Range', text: '${1:v}.begin(), ${1:v}.end()' },
            { label: 'rall', doc: 'Reverse Range', text: '${1:v}.rbegin(), ${1:v}.rend()' },
            { label: 'sz', doc: 'Size', text: '${1:v}.size()' },

            { label: 'vec', doc: 'Vector', text: 'vector<${1:int}> ${2:v};' },
            { label: 'vecn', doc: 'Vector size n', text: 'vector<${1:int}> ${2:v}(${3:n});' },
            { label: 'vecval', doc: 'Vector size n, val', text: 'vector<${1:int}> ${2:v}(${3:n}, ${4:0});' },
            { label: 'vv', doc: 'Vector 2D', text: 'vector<vector<${1:int}>> ${2:v};' },

            { label: 'ios', doc: 'Fast I/O', text: 'ios_base::sync_with_stdio(false); cin.tie(NULL);' },
            { label: 'setp', doc: 'Set precision', text: 'cout << fixed << setprecision(${1:number});' },
            { label: 'fre', doc: 'File I/O', text: 'if (fopen("${1:test}.inp", "r")) {\n    freopen("${1:test}.inp", "r", stdin);\n    freopen("${1:test}.out", "w", stdout);\n}' }
        ],
        c: [
            { label: 'main', doc: 'Main C', text: 'int main(){\n    ${0}\n    return 0;\n}' },
            { label: 'printf', doc: 'Print', text: 'printf("${1:%d}\\n", ${2});' },
            { label: 'scanf', doc: 'Scan', text: 'scanf("${1:%d}", &${2});' }
        ],
        common: [
            // Forward loop (0 -> n-1)
            { label: 'for', doc: 'Loop 0 -> n-1', text: 'for(int ${1:i}=0; ${1:i}<${2:n}; ${1:i}++){\n    ${0}\n}' },
            // Forward loop (1 -> n)
            { label: 'for1', doc: 'Loop 1 -> n', text: 'for(int ${1:i}=1; ${1:i}<=${2:n}; ${1:i}++){\n    ${0}\n}' },
            // Reverse loop (n-1 -> 0)
            { label: 'ford', doc: 'Loop n-1 -> 0', text: 'for(int ${1:i}=${2:n}-1; ${1:i}>=0; ${1:i}--){\n    ${0}\n}' },

            { label: 'while', doc: 'While', text: 'while(${1:cond}){\n    ${0}\n}' },
            { label: 'if', doc: 'If', text: 'if(${1:cond}){\n    ${0}\n}' },
            { label: 'ifelse', doc: 'If-Else', text: 'if(${1:cond}){\n    ${2}\n}else{\n    ${0}\n}' }
        ]
    };

    // Headers
    const HEADERS = {
        c: ['stdio.h', 'stdlib.h', 'string.h', 'math.h', 'windows.h', 'conio.h'],
        cpp: ['bits/stdc++.h', 'iostream', 'vector', 'algorithm', 'map', 'set', 'string', 'queue', 'stack', 'iomanip']
    };

    // ========================================================================
    // 2. LOGIC PROVIDER (fallback when clangd is unavailable, e.g. unsaved files)
    // ========================================================================
    const createProposals = (range, languageId, textUntilPosition) => {
        const suggestions = [];
        const insideInclude = /#include\s*[<"]\s*$/.test(textUntilPosition);
        const insideParentheses = /\([^\)]*$/.test(textUntilPosition);
        const atPreprocessor = /#\s*$/.test(textUntilPosition);
        const afterDot = /\.\s*$/.test(textUntilPosition);

        if (insideInclude) {
            let hList = [...HEADERS.c];
            if (languageId === 'cpp') hList = [...hList, ...HEADERS.cpp];
            hList.forEach(h => suggestions.push({
                label: h, kind: monaco.languages.CompletionItemKind.File, insertText: h, range: range
            }));
            return { suggestions };
        }

        if (atPreprocessor) {
            ['include', 'define', 'ifdef', 'ifndef', 'endif', 'pragma'].forEach(d => {
                suggestions.push({
                    label: d, kind: monaco.languages.CompletionItemKind.Keyword, insertText: d, range: range
                });
            });
            return { suggestions };
        }

        // Member access is handled exclusively by clangd. Without it we offer
        // nothing here to avoid polluting the list with keywords/snippets.
        if (afterDot) {
            return { suggestions };
        }

        if (!insideParentheses) {
            SNIPPETS.common.forEach(s => suggestions.push({
                label: s.label, kind: monaco.languages.CompletionItemKind.Snippet,
                insertText: s.text, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                documentation: s.doc, range: range
            }));
            const langSnippets = (languageId === 'cpp') ? SNIPPETS.cpp : SNIPPETS.c;
            langSnippets.forEach(s => suggestions.push({
                label: s.label, kind: monaco.languages.CompletionItemKind.Snippet,
                insertText: s.text, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                documentation: s.doc, range: range
            }));

            if (typeof App !== 'undefined' && App.settings && Array.isArray(App.settings.snippets)) {
                App.settings.snippets.forEach(s => {
                    suggestions.push({
                        label: s.trigger, kind: monaco.languages.CompletionItemKind.Snippet,
                        insertText: s.content, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                        documentation: s.name || 'Custom Snippet', range: range
                    });
                });
            }
        }

        const cppKeywords = [
            'int', 'long', 'void', 'char', 'bool', 'return', 'break', 'continue', 'struct', 'const',
            'auto', 'double', 'float', 'unsigned', 'class', 'namespace', 'using', 'template',
            'typename', 'constexpr', 'inline', 'static', 'virtual', 'override', 'final',
            'public', 'private', 'protected', 'switch', 'case', 'default', 'try', 'catch',
            'throw', 'new', 'delete', 'sizeof', 'typedef', 'enum', 'union', 'extern'
        ];

        cppKeywords.forEach(k => {
            suggestions.push({ label: k, kind: monaco.languages.CompletionItemKind.Keyword, insertText: k, range: range });
        });

        if (languageId === 'cpp') {
            ['ll', 'pb', 'mp', 'fi', 'se', 'vi', 'pii'].forEach(k => {
                suggestions.push({ label: k, kind: monaco.languages.CompletionItemKind.Constant, insertText: k, range: range });
            });
        }

        return { suggestions };
    };

    // ========================================================================
    // 3. REGISTRATION (COMPLETION & HOVER)
    // ========================================================================
    const registerFeatures = (lang) => {
        monaco.languages.registerCompletionItemProvider(lang, {
            triggerCharacters: ['<', '/', '"', '#', '.'],
            provideCompletionItems: async (model, position) => {
                const word = model.getWordUntilPosition(position);
                const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
                const textUntilPosition = model.getValueInRange({ startLineNumber: position.lineNumber, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column });
                const afterDot = /\.\s*$/.test(textUntilPosition);

                if (/[<>]{2}\s*$/.test(textUntilPosition)) {
                    return { suggestions: [] };
                }

                if (/<\s*$/.test(textUntilPosition) && !/#include\s*<\s*$/.test(textUntilPosition)) {
                    return { suggestions: [] };
                }

                let baseProposals = createProposals(range, lang, textUntilPosition);

                // For member-access (e.g. `v.|`), prefer clangd's
                // textEdit.range which is already correct. When the
                // user has typed a partial word after the dot (e.g.
                // `v.b|`), fall back to the current word range so the
                // partial prefix is replaced.

                // Call clangd if available. We ALWAYS have a stable file
                // identifier (see clangdFileId) so clangd is never skipped just
                // because the tab lookup missed — that fragility is what used to
                // silently drop us to the dumb fallback.
                if (window.electronAPI && window.electronAPI.getClangdCompletions) {
                    {
                        const filePath = clangdFileId(model);
                        const content = model.getValue();
                        const line = position.lineNumber - 1;
                        const character = position.column - 1;

                        try {
                            const clangdItems = await window.electronAPI.getClangdCompletions(filePath, content, line, character);
                            if (clangdItems && clangdItems.length > 0) {
                                // LSP CompletionItemKind: Method=2, Function=3, Field=5,
                                // Variable=6, Property=10, Value=11, Keyword=14, etc.
                                // For member-access (after a `.`) clangd sometimes leaks
                                // file-scope items (`main`, globals) when the receiver's
                                // type is unresolved. Keep only the kind that legitimately
                                // belong on an object: Method, Field, Property, Value.
                                // Outside member-access, keep Function/Variable so users
                                // can still complete identifiers (cout, local vars).
                                const memberKinds = afterDot
                                    ? new Set([2 /*Method*/, 5 /*Field*/, 10 /*Property*/, 11 /*Value*/])
                                    : null;
                                const filtered = memberKinds
                                    ? clangdItems.filter((it) => memberKinds.has(it.kind))
                                    : clangdItems;
                                // If filtering wiped everything, fall back to the raw list
                                // so the user still sees something rather than an empty
                                // popup — clangd's type-resolution problems will be more
                                // visible this way.
                                const itemsForMapping = filtered.length > 0 ? filtered : clangdItems;
                                const mappedClangdItems = itemsForMapping.map(item => {
                                    let doc = undefined;
                                    if (item.documentation) {
                                        if (typeof item.documentation === 'string') {
                                            doc = item.documentation;
                                        } else if (typeof item.documentation === 'object' && item.documentation.value) {
                                            doc = item.documentation.value;
                                        }
                                    }

                                    // Prefer the LSP textEdit.range that clangd
                                    // computed. Fall back to the current word
                                    // range (which handles both plain words and
                                    // partial words after a `.` like `v.b|`).
                                    let itemRange = range;
                                    let insertText = item.label;
                                    if (item.textEdit && item.textEdit.newText) {
                                        insertText = item.textEdit.newText;
                                        if (item.textEdit.range) {
                                            itemRange = {
                                                startLineNumber: item.textEdit.range.start.line + 1,
                                                endLineNumber: item.textEdit.range.end.line + 1,
                                                startColumn: item.textEdit.range.start.character + 1,
                                                endColumn: item.textEdit.range.end.character + 1
                                            };
                                        }
                                    } else if (item.insertText) {
                                        insertText = item.insertText;
                                    }

                                    return {
                                        label: item.label,
                                        kind: item.kind,
                                        detail: item.detail,
                                        documentation: doc,
                                        insertText: insertText,
                                        insertTextRules: item.insertTextFormat === 2 ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
                                        range: itemRange,
                                        sortText: item.sortText || (item.label || '').trim() || item.label,
                                        additionalTextEdits: item.additionalTextEdits ? item.additionalTextEdits.map(edit => ({
                                            range: new monaco.Range(
                                                edit.range.start.line + 1,
                                                edit.range.start.character + 1,
                                                edit.range.end.line + 1,
                                                edit.range.end.character + 1
                                            ),
                                            text: edit.newText
                                        })) : undefined
                                    };
                                });

                                // Merge Clangd suggestions at front with custom snippets from base proposals (sorted at the bottom)
                                const customSnippets = baseProposals.suggestions
                                    .filter(s => s.kind === monaco.languages.CompletionItemKind.Snippet)
                                    .map(s => ({
                                        ...s,
                                        sortText: 'zzz_' + (s.label.label || s.label)
                                    }));
                                return {
                                    suggestions: [...mappedClangdItems, ...customSnippets]
                                };
                            }
                        } catch (err) {
                            console.error('[Clangd] completions error:', err);
                        }
                    }
                }

                if (window.electronAPI && window.electronAPI.getSmartSuggestions) {
                    try {
                        const content = model.getValue();
                        const context = await window.electronAPI.getSmartSuggestions(content, position.lineNumber - 1, position.column - 1);

                        if (context && context.available) {
                            if (context.isComment || context.isString) {
                                return { suggestions: [] };
                            }

                            if (context.locals && context.locals.length > 0) {
                                const query = word.word.toLowerCase();
                                const smartVars = context.locals
                                    .filter(l => l.toLowerCase().startsWith(query))
                                    .map(l => {
                                        return {
                                            label: l,
                                            kind: monaco.languages.CompletionItemKind.Variable,
                                            insertText: l,
                                            detail: 'Local / Global Variable',
                                            range: range,
                                            sortText: '000_' + l
                                        };
                                    });
                                baseProposals.suggestions = [...smartVars, ...baseProposals.suggestions];
                            }
                        }
                    } catch (e) {
                        console.warn('[SmartSuggest] Error:', e);
                    }
                }

                return baseProposals;
            }
        });

        // Hover (clangd only)
        monaco.languages.registerHoverProvider(lang, {
            provideHover: async (model, position) => {
                const word = model.getWordAtPosition(position);

                if (window.electronAPI && window.electronAPI.getClangdHover) {
                    {
                        const filePath = clangdFileId(model);
                        const content = model.getValue();
                        const line = position.lineNumber - 1;
                        const character = position.column - 1;

                        try {
                            const clangdHover = await window.electronAPI.getClangdHover(filePath, content, line, character);
                            if (clangdHover && clangdHover.contents) {
                                let formattedContents = [];
                                const mapLspContentToMonaco = (c) => {
                                    if (!c) return null;
                                    if (typeof c === 'string') {
                                        return { value: c };
                                    }
                                    if (typeof c === 'object' && typeof c.value === 'string') {
                                        if (c.kind === 'markdown' || !c.language) {
                                            return { value: c.value };
                                        } else {
                                            return { value: `\`\`\`${c.language}\n${c.value}\n\`\`\`` };
                                        }
                                    }
                                    return null;
                                };

                                if (Array.isArray(clangdHover.contents)) {
                                    clangdHover.contents.forEach(c => {
                                        const mapped = mapLspContentToMonaco(c);
                                        if (mapped) formattedContents.push(mapped);
                                    });
                                } else {
                                    const mapped = mapLspContentToMonaco(clangdHover.contents);
                                    if (mapped) formattedContents.push(mapped);
                                }

                                if (formattedContents.length > 0) {
                                    let range = undefined;
                                    if (clangdHover.range) {
                                        const startLine = clangdHover.range.start.line + 1;
                                        const startCol = clangdHover.range.start.character + 1;
                                        const endLine = clangdHover.range.end.line + 1;
                                        const endCol = clangdHover.range.end.character + 1;
                                        range = new monaco.Range(startLine, startCol, endLine, endCol);
                                    } else if (word) {
                                        range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
                                    }

                                    return {
                                        range: range,
                                        contents: formattedContents
                                    };
                                }
                            }
                        } catch (err) {
                            console.error('[Clangd] hover error:', err);
                        }
                    }
                }

                return null;
            }
        });
    }

    registerFeatures('cpp');
    registerFeatures('c');
};
