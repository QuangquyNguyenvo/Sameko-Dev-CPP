const CppLanguageTools = (() => {
    const punctuation = new Map([
        ['；', ';'], ['，', ','], ['（', '('], ['）', ')'], ['：', ':'],
        ['“', '"'], ['”', '"'], ['‘', "'"], ['’', "'"], ['＂', '"'], ['＇', "'"],
        ['｛', '{'], ['｝', '}'], ['［', '['], ['］', ']'], ['！', '!'], ['？', '?']
    ]);
    const liveVersions = new WeakMap();
    const buildSource = 'build-punctuation';
    const punctuationPattern = new RegExp('[' + [...punctuation.keys()].join('') + ']');

    function toRange(range) {
        if (!range?.start || !range.end) return null;
        const { start, end } = range;
        if (![start.line, start.character, end.line, end.character].every(n => Number.isInteger(n) && n >= 0)) return null;
        if (end.line < start.line || (end.line === start.line && end.character < start.character)) return null;
        return {
            startLineNumber: start.line + 1,
            startColumn: start.character + 1,
            endLineNumber: end.line + 1,
            endColumn: end.character + 1
        };
    }

    function hasPunctuation(line) {
        return punctuationPattern.test(line);
    }

    function punctuationEdits(line, tokens, lineNumber) {
        const edits = [];
        let token = 0;
        for (let offset = 0; offset < line.length; offset++) {
            const replacement = punctuation.get(line[offset]);
            if (!replacement) continue;
            while (tokens[token + 1]?.offset <= offset) token++;
            if (/^(?:string|comment)(?:\.|$)/.test(tokens[token]?.type || '')) continue;
            edits.push({
                range: {
                    startLineNumber: lineNumber, endLineNumber: lineNumber,
                    startColumn: offset + 1, endColumn: offset + 2
                },
                text: replacement
            });
        }
        return edits;
    }

    function setBuildMarkers(model, problems) {
        const lines = new Set();
        const markers = problems.flatMap(p => {
            if (p.line < 1 || p.line > model.getLineCount() || lines.has(p.line)) return [];
            const line = model.getLineContent(p.line);
            if (!hasPunctuation(line)) return [];
            lines.add(p.line);
            return [{
                startLineNumber: p.line, endLineNumber: p.line,
                startColumn: 1, endColumn: line.length + 1,
                message: p.message, severity: monaco.MarkerSeverity.Error, source: buildSource
            }];
        });
        monaco.editor.setModelMarkers(model, buildSource, markers);
    }

    function markLiveDiagnostics(model) {
        liveVersions.set(model, model.getVersionId());
    }

    function makeQuickFix(model, title, edits, preferred = false) {
        return {
            title, kind: 'quickfix', isPreferred: preferred,
            edit: { edits: edits.map(textEdit => ({
                resource: model.uri, versionId: model.getVersionId(), textEdit
            })) }
        };
    }

    /** "'f' was not declared in this scope" on a function defined below main (#78). */
    function prototypeFix(model, errors) {
        if (!window.FunctionPrototypes) return [];
        const names = errors.map(marker => /['‘](\w+)['’] was not declared in this scope|[Uu]se of undeclared identifier ['‘](\w+)['’]/
            .exec(marker.message)).filter(Boolean).map(m => m[1] || m[2]);
        if (!names.length) return [];
        const result = FunctionPrototypes.analyze(model.getValue());
        if (!names.some(name => result.names.includes(name))) return [];
        const line = result.insertLine;
        return [makeQuickFix(model, I18n.t('Add function prototypes above main'), [{
            range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
            text: FunctionPrototypes.insertionText(result, model.getEOL())
        }], true)];
    }

    function localFixes(model, range) {
        const currentLive = liveVersions.get(model) === model.getVersionId();
        const markers = monaco.editor.getModelMarkers({ resource: model.uri });
        const errors = markers.filter(marker => marker.severity === monaco.MarkerSeverity.Error &&
            (marker.source === buildSource || (currentLive && ['clangd', 'g++'].includes(marker.source))) &&
            marker.startLineNumber >= range.startLineNumber && marker.startLineNumber <= range.endLineNumber);
        const prototypes = prototypeFix(model, errors);
        const lines = new Set(errors.map(marker => marker.startLineNumber));
        const candidates = [...lines].filter(line => hasPunctuation(model.getLineContent(line)));
        if (!candidates.length) return prototypes;

        // Keep comments and literals intact, including multi-line ones.
        const lastLine = Math.max(...candidates);
        const prefix = model.getValueInRange({
            startLineNumber: 1, startColumn: 1, endLineNumber: lastLine,
            endColumn: model.getLineMaxColumn(lastLine)
        });
        const tokens = monaco.editor.tokenize(prefix, model.getLanguageId());
        return candidates.flatMap(line => {
            const edits = punctuationEdits(model.getLineContent(line), tokens[line - 1] || [], line);
            return edits.length ? [makeQuickFix(model, I18n.t('Replace full-width punctuation with ASCII'), edits)] : [];
        }).concat(prototypes);
    }

    function register(monaco) {
        const api = window.electronAPI;
        const tabForPath = file => App.tabs.find(tab => tab.path && pathKey(tab.path) === pathKey(file));
        const previews = new Set();
        let previewCleanup;
        const releasePreviewsWhenClosed = () => {
            clearTimeout(previewCleanup);
            previewCleanup = setTimeout(() => {
                if (document.querySelector('.reference-zone-widget')) {
                    releasePreviewsWhenClosed();
                    return;
                }
                for (const model of previews) model.dispose();
                previews.clear();
            }, 1000);
        };

        async function loadPreviews(links, isCurrent) {
            // The standalone peek widget only resolves existing models. Use
            // separate, temporary models so previews do not open real tabs.
            const missing = new Map(links.filter(link => link.uri.scheme === 'file' && !monaco.editor.getModel(link.uri))
                .map(link => [link.uri.toString(), link.uri]));
            const files = [...missing.values()];
            if (!files.length) return;
            // More files still get clickable locations with line numbers.
            const count = Math.max(0, 16 - previews.size);
            const content = await Promise.all(files.slice(0, count).map(uri => {
                const tab = tabForPath(uri.fsPath);
                return tab ? tab.content : api.readFile(uri.fsPath).catch(() => '');
            }));
            if (!isCurrent()) return;
            files.forEach((uri, i) => {
                if (monaco.editor.getModel(uri)) return;
                const text = content[i] || '';
                const preview = monaco.editor.createModel(text.length <= 256 * 1024 ? text : '', languageForFile(uri.fsPath), uri);
                previews.add(preview);
            });
            releasePreviewsWhenClosed();
        }

        const clangdEnabled = () => App.settings.editor.intellisense !== false;
        const locations = (request, isReference) => async (model, position, token, includeDeclaration) => {
            const tab = getTabForModel(model);
            if (!tab || !clangdEnabled() || token.isCancellationRequested) return [];
            const version = model.getVersionId();
            const filePath = tab.path || tab.id;
            const items = await request({
                filePath, content: model.getValue(),
                position: { line: position.lineNumber - 1, character: position.column - 1 },
                includeDeclaration
            }).catch(() => []);
            const isCurrent = () => !token.isCancellationRequested && !model.isDisposed() &&
                model.getVersionId() === version && (tab.path || tab.id) === filePath;
            if (!isCurrent()) return [];
            const links = items.flatMap(item => {
                const range = toRange(item.range);
                if (!range) return [];
                const target = item.current || isReference ? null : tabForPath(item.file)?.model;
                const uri = item.current ? model.uri : target?.uri || monaco.Uri.file(item.file);
                return [{ uri, range }];
            });
            if (isReference || links.length > 1) await loadPreviews(links, isCurrent);
            return isCurrent() ? links : [];
        };

        const documentRequest = (model, position) => {
            const tab = getTabForModel(model);
            if (!tab || !clangdEnabled()) return null;
            return {
                tab, version: model.getVersionId(),
                request: {
                    filePath: tab.path || tab.id, content: model.getValue(),
                    ...(position ? { position: { line: position.lineNumber - 1, character: position.column - 1 } } : {})
                }
            };
        };
        const stillCurrent = (doc, model, token) => !token.isCancellationRequested && !model.isDisposed() &&
            model.getVersionId() === doc.version && (doc.tab.path || doc.tab.id) === doc.request.filePath;
        const lspDoc = value => (value && typeof value === 'object' ? { value: value.value || '' } : value || undefined);
        const toSymbol = symbol => {
            const range = toRange(symbol.range);
            const selectionRange = toRange(symbol.selectionRange) || range;
            if (!range || !symbol.name) return null;
            return {
                name: symbol.name, detail: symbol.detail || '', kind: Math.max(0, (symbol.kind || 1) - 1), tags: [],
                range, selectionRange, children: (symbol.children || []).map(toSymbol).filter(Boolean)
            };
        };
        const renameRefused = reason => ({ edits: [], rejectReason: I18n.t(reason || 'This symbol cannot be renamed.') });

        const definition = locations(api.getClangdDefinition);
        const references = locations(api.getClangdReferences, true);
        for (const language of ['cpp', 'c']) {
            monaco.languages.registerDefinitionProvider(language, { provideDefinition: definition });
            monaco.languages.registerReferenceProvider(language, {
                provideReferences: (model, position, context, token) => references(model, position, token, context.includeDeclaration)
            });
            monaco.languages.registerSignatureHelpProvider(language, {
                signatureHelpTriggerCharacters: ['(', ','],
                signatureHelpRetriggerCharacters: [')'],
                async provideSignatureHelp(model, position, token) {
                    const doc = documentRequest(model, position);
                    if (!doc) return null;
                    const help = await api.getClangdSignatureHelp(doc.request).catch(() => null);
                    if (!stillCurrent(doc, model, token) || !help?.signatures?.length) return null;
                    return {
                        value: {
                            signatures: help.signatures.map(signature => ({
                                label: signature.label,
                                documentation: lspDoc(signature.documentation),
                                parameters: (signature.parameters || []).map(parameter => ({
                                    label: parameter.label, documentation: lspDoc(parameter.documentation)
                                }))
                            })),
                            activeSignature: help.activeSignature || 0,
                            activeParameter: help.activeParameter || 0
                        },
                        dispose() {}
                    };
                }
            });
            monaco.languages.registerDocumentSymbolProvider(language, {
                displayName: 'clangd',
                async provideDocumentSymbols(model, token) {
                    const doc = documentRequest(model);
                    if (!doc) return [];
                    const symbols = await api.getClangdSymbols(doc.request).catch(() => []);
                    return stillCurrent(doc, model, token) ? symbols.map(toSymbol).filter(Boolean) : [];
                }
            });
            monaco.languages.registerRenameProvider(language, {
                async resolveRenameLocation(model, position, token) {
                    const word = model.getWordAtPosition(position);
                    const fallback = new monaco.Range(position.lineNumber, word?.startColumn || position.column,
                        position.lineNumber, word?.endColumn || position.column);
                    const refuse = reason => ({ range: fallback, text: word?.word || '', rejectReason: I18n.t(reason || 'This symbol cannot be renamed.') });
                    const doc = documentRequest(model, position);
                    if (!doc) return refuse('Rename needs IntelliSense to be on.');
                    const result = await api.clangdPrepareRename(doc.request).catch(() => null);
                    const range = toRange(result?.range);
                    if (!stillCurrent(doc, model, token) || !range) return refuse(result?.error);
                    return { range, text: model.getValueInRange(range) };
                },
                async provideRenameEdits(model, position, newName, token) {
                    const doc = documentRequest(model, position);
                    if (!doc) return renameRefused('Rename needs IntelliSense to be on.');
                    const result = await api.clangdRename({ ...doc.request, newName }).catch(() => null);
                    if (!stillCurrent(doc, model, token) || !result?.edits) return renameRefused(result?.error);
                    const edits = result.edits.map(edit => ({ range: toRange(edit.range), text: edit.newText }));
                    if (!edits.every(edit => edit.range)) return renameRefused();
                    return {
                        edits: edits.map(textEdit => ({ resource: model.uri, versionId: doc.version, textEdit }))
                    };
                }
            });
            monaco.languages.registerCodeActionProvider(language, {
                providedCodeActionKinds: ['quickfix'],
                async provideCodeActions(model, range, context, token) {
                    const tab = getTabForModel(model);
                    const list = actions => ({ actions, dispose() {} });
                    if (!tab || token.isCancellationRequested) return list([]);
                    const local = localFixes(model, range);
                    if (!clangdEnabled() ||
                        (context.trigger === monaco.languages.CodeActionTriggerType.Auto &&
                            !context.markers.some(marker => marker.source === 'clangd'))) return list(local);

                    const version = model.getVersionId();
                    const filePath = tab.path || tab.id;
                    const items = await api.getClangdCodeActions({
                        filePath, content: model.getValue(),
                        range: {
                            start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
                            end: { line: range.endLineNumber - 1, character: range.endColumn - 1 }
                        }
                    }).catch(() => []);
                    if (token.isCancellationRequested || model.isDisposed() ||
                        model.getVersionId() !== version || (tab.path || tab.id) !== filePath) return list([]);
                    const fixes = items.flatMap(item => {
                        const edits = item.edits.map(edit => ({ range: toRange(edit.range), text: edit.newText }));
                        if (!edits.every(edit => edit.range && monaco.Range.equalsRange(model.validateRange(edit.range), edit.range))) return [];
                        return [makeQuickFix(model, item.title, edits, item.preferred)];
                    });
                    return list([...local, ...fixes]);
                }
            });
        }

        monaco.editor.registerEditorOpener({
            async openCodeEditor(source, resource, selection) {
                const target = monaco.editor.getModel(resource);
                const file = resource.scheme === 'file' ? resource.fsPath : getTabForModel(target)?.path;
                return file ? openFileAt(file, selection) : false;
            }
        });
    }

    return { register, toRange, punctuationEdits, markLiveDiagnostics, setBuildMarkers, buildSource };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = CppLanguageTools;
else window.CppLanguageTools = CppLanguageTools;
