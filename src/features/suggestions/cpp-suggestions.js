window.registerCppIntellisense = function (monaco) {
    console.log('[Intellisense] Registering C/C++ Provider (Full STL Support)...');

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

            // --- BỔ SUNG VECTOR SNIPPETS ---
            { label: 'vec', doc: 'Vector', text: 'vector<${1:int}> ${2:v};' },
            { label: 'vecn', doc: 'Vector size n', text: 'vector<${1:int}> ${2:v}(${3:n});' },
            { label: 'vecval', doc: 'Vector size n, val', text: 'vector<${1:int}> ${2:v}(${3:n}, ${4:0});' },
            { label: 'vv', doc: 'Vector 2D', text: 'vector<vector<${1:int}>> ${2:v};' },

            // --- FAST IO & UTILS ---
            { label: 'ios', doc: 'Fast I/O', text: 'ios_base::sync_with_stdio(false); cin.tie(NULL);' },
            { label: 'setp', doc: 'Set precision', text: 'cout << fixed << setprecision(${1:number});' }
        ],
        c: [
            { label: 'main', doc: 'Main C', text: 'int main(){\n    ${0}\n    return 0;\n}' },
            { label: 'printf', doc: 'Print', text: 'printf("${1:%d}\\n", ${2});' },
            { label: 'scanf', doc: 'Scan', text: 'scanf("${1:%d}", &${2});' }
        ],
        common: [
            // Loop xuôi (0 -> n-1)
            { label: 'for', doc: 'Loop 0 -> n-1', text: 'for(int ${1:i}=0; ${1:i}<${2:n}; ${1:i}++){\n    ${0}\n}' },
            // Loop xuôi (1 -> n)
            { label: 'for1', doc: 'Loop 1 -> n', text: 'for(int ${1:i}=1; ${1:i}<=${2:n}; ${1:i}++){\n    ${0}\n}' },
            // Loop ngược (n-1 -> 0)
            { label: 'ford', doc: 'Loop n-1 -> 0', text: 'for(int ${1:i}=${2:n}-1; ${1:i}>=0; ${1:i}--){\n    ${0}\n}' },

            { label: 'while', doc: 'While', text: 'while(${1:cond}){\n    ${0}\n}' },
            { label: 'if', doc: 'If', text: 'if(${1:cond}){\n    ${0}\n}' },
            { label: 'ifelse', doc: 'If-Else', text: 'if(${1:cond}){\n    ${2}\n}else{\n    ${0}\n}' }
        ]
    };

    // ========================================================================
    // 2. DATA: STL METHODS & DOCUMENTATION
    // ========================================================================
    const STL_DOCS = {
        // --- Vector / String / Deque Modifications ---
        'push_back': { type: 'Method', detail: 'void push_back(val)', doc: 'Add element to the end.' },
        'emplace_back': { type: 'Method', detail: 'void emplace_back(args...)', doc: 'Construct and add element to the end.' },
        'pop_back': { type: 'Method', detail: 'void pop_back()', doc: 'Remove the last element.' },
        'resize': { type: 'Method', detail: 'void resize(n, val)', doc: 'Resize container to contain n elements.' },
        'assign': { type: 'Method', detail: 'void assign(n, val)', doc: 'Assign new content to container.' },
        'clear': { type: 'Method', detail: 'void clear()', doc: 'Remove all elements.' },

        // --- Insert / Erase ---
        'erase': { type: 'Method', detail: 'iterator erase(pos)', doc: 'Remove element at position/range.\nEx: v.erase(v.begin() + 1);' },
        'insert': { type: 'Method', detail: 'iterator insert(pos, val)', doc: 'Insert element before pos.' },

        // --- Access ---
        'front': { type: 'Method', detail: 'T& front()', doc: 'Access first element.' },
        'back': { type: 'Method', detail: 'T& back()', doc: 'Access last element.' },
        'at': { type: 'Method', detail: 'T& at(idx)', doc: 'Access element with bounds checking.' },

        // --- String Specific ---
        'substr': { type: 'Method', detail: 'string substr(pos, len)', doc: 'Generate substring.' },
        'length': { type: 'Method', detail: 'size_t length()', doc: 'Return string length.' },
        'c_str': { type: 'Method', detail: 'const char* c_str()', doc: 'Return C-style string array.' },
        'append': { type: 'Method', detail: 'string& append(str)', doc: 'Append to string.' },

        // --- Map / Set / Finders ---
        'find': { type: 'Method', detail: 'iterator find(key)', doc: 'Search for an element.' },
        'count': { type: 'Method', detail: 'size_t count(key)', doc: 'Count elements with key (1 or 0 for set).' },
        'lower_bound': { type: 'Method', detail: 'iterator lower_bound(key)', doc: 'First element NOT less than key (>=).' },
        'upper_bound': { type: 'Method', detail: 'iterator upper_bound(key)', doc: 'First element greater than key (>).' },

        // --- Stack / Queue / PQ ---
        'push': { type: 'Method', detail: 'void push(val)', doc: 'Insert element.' },
        'pop': { type: 'Method', detail: 'void pop()', doc: 'Remove top element.' },
        'top': { type: 'Method', detail: 'T& top()', doc: 'Access top element.' },
        'empty': { type: 'Method', detail: 'bool empty()', doc: 'Check if container is empty.' },

        // --- Algorithms & Utils ---
        'sort': { type: 'Func', detail: 'sort(begin, end)', doc: 'Sort range.' },
        'reverse': { type: 'Func', detail: 'reverse(begin, end)', doc: 'Reverse range.' },
        'memset': { type: 'Func', detail: 'memset(ptr, val, size)', doc: 'Fill memory.' },
        'memcpy': { type: 'Func', detail: 'memcpy(dest, src, size)', doc: 'Copy memory.' },
        '__gcd': { type: 'Func', detail: '__gcd(a, b)', doc: 'Greatest Common Divisor.' },
        'min': { type: 'Func', detail: 'min(a, b)', doc: 'Return smaller value.' },
        'max': { type: 'Func', detail: 'max(a, b)', doc: 'Return larger value.' },
        'swap': { type: 'Func', detail: 'swap(a, b)', doc: 'Swap two values.' },

        // --- String Conversions ---
        'to_string': { type: 'Func', detail: 'to_string(val)', doc: 'Convert numerical value to string.' },
        'stoi': { type: 'Func', detail: 'stoi(str)', doc: 'Convert string to integer.' },
        'stoll': { type: 'Func', detail: 'stoll(str)', doc: 'Convert string to long long.' },
        'stod': { type: 'Func', detail: 'stod(str)', doc: 'Convert string to double.' },
        'itoa': { type: 'Func', detail: 'itoa(val, buffer, radix)', doc: 'Convert integer to string (Non-standard).' }
    };

    const STL_KEYWORDS = Object.keys(STL_DOCS);

    // Headers
    const HEADERS = {
        c: ['stdio.h', 'stdlib.h', 'string.h', 'math.h', 'windows.h', 'conio.h'],
        cpp: ['bits/stdc++.h', 'iostream', 'vector', 'algorithm', 'map', 'set', 'string', 'queue', 'stack', 'iomanip']
    };

    // ========================================================================
    // 3. LOGIC PROVIDER
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

        if (afterDot) {
            STL_KEYWORDS.forEach(k => {
                const info = STL_DOCS[k];
                if (info.type === 'Method') {
                    suggestions.push({
                        label: k, kind: monaco.languages.CompletionItemKind.Method,
                        insertText: k, documentation: info.doc, detail: info.detail, range: range
                    });
                }
            });
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
            STL_KEYWORDS.forEach(k => {
                const info = STL_DOCS[k];
                if (info.type === 'Func') {
                    suggestions.push({
                        label: k, kind: monaco.languages.CompletionItemKind.Function,
                        insertText: k, documentation: info.doc, detail: info.detail, range: range
                    });
                }
            });
        }

        return { suggestions };
    };

    // ========================================================================
    // 4. REGISTRATION (HOVER & SIGNATURE)
    // ========================================================================
    const registerFeatures = (lang) => {
        monaco.languages.registerCompletionItemProvider(lang, {
            triggerCharacters: ['<', '/', '"', '#', '.'],
            provideCompletionItems: async (model, position) => {
                const word = model.getWordUntilPosition(position);
                const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
                const textUntilPosition = model.getValueInRange({ startLineNumber: position.lineNumber, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column });

                if (/[<>]{2}\s*$/.test(textUntilPosition)) {
                    return { suggestions: [] };
                }

                // 1. Get Base Proposals (from Dict/Regex)
                let baseProposals = createProposals(range, lang, textUntilPosition);

                // 2. Call Tree-sitter (IPC) to get smart context
                if (window.electronAPI && window.electronAPI.getSmartSuggestions) {
                    try {
                        const content = model.getValue();
                        const context = await window.electronAPI.getSmartSuggestions(content, position.lineNumber - 1, position.column - 1);

                        if (context && context.available) {
                            // If we are deep inside a string or comment, shut off keywords!
                            if (context.isComment || context.isString) {
                                return { suggestions: [] };
                            }

                            // Add discovered local variables/functions to autocomplete!
                            if (context.locals && context.locals.length > 0) {
                                // Filter out anything that matches current word to avoid duplicating what user just typed
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
                                            // Make variables rank higher
                                            sortText: '000_' + l
                                        };
                                    });
                                // Merge smart variables with base proposals
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

        // Hover
        monaco.languages.registerHoverProvider(lang, {
            provideHover: (model, position) => {
                const word = model.getWordAtPosition(position);
                if (!word) return null;
                const item = STL_DOCS[word.word];
                if (item) {
                    return {
                        range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
                        contents: [{ value: `**${item.type}:** \`${item.detail}\`` }, { value: item.doc }]
                    };
                }
                return null;
            }
        });

        // Signature Help
        monaco.languages.registerSignatureHelpProvider(lang, {
            signatureHelpTriggerCharacters: ['(', ','],
            provideSignatureHelp: (model, position) => {
                const textUntilPosition = model.getValueInRange({ startLineNumber: position.lineNumber, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column });
                const match = textUntilPosition.match(/([a-zA-Z0-9_]+)\s*\($|([a-zA-Z0-9_]+)\s*\([^)]*,/);
                if (!match) return null;
                const funcName = match[1] || match[2];
                const info = STL_DOCS[funcName];
                if (info) {
                    return {
                        value: {
                            signatures: [{ label: info.detail, documentation: info.doc, parameters: [] }],
                            activeSignature: 0, activeParameter: 0
                        },
                        dispose: () => { }
                    };
                }
                return null;
            }
        });
    }

    registerFeatures('cpp');
    registerFeatures('c');
};