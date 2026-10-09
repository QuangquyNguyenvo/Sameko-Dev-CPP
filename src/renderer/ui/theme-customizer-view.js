/*
 * Theme customizer view
 *
 * This module is deliberately only a view.  ThemeCustomizer (the controller)
 * owns drafts, history, persistence and preview updates.  Keeping the view
 * mounted while those values change avoids the Monaco/innerHTML lifecycle
 * failures of the previous customizer.
 */
(function () {
    'use strict';

    var PANEL_ORDER = ['colors', 'syntax', 'backgrounds', 'advanced'];
    var PANEL_HELP = {
        colors: 'Colors of surfaces, text and states. Click a part of the preview to jump to its color. ↺ on a row puts that color back; Ctrl+Z / Ctrl+Y undo and redo. Edits show in the preview only until you save.',
        syntax: 'Colors of the C++ code in the editor. ↺ on a row puts that color back.',
        backgrounds: 'Images, videos and their effects. Undo and Reset restore them too.',
        advanced: 'Base theme, import, export and the theme JSON. Ctrl+Enter applies the JSON.'
    };
    var GROUP_ORDER = ['main', 'background', 'surface', 'accent', 'text', 'border', 'status', 'button', 'welcome', 'terminal', 'other'];
    var SYNTAX_KEYS = ['keyword', 'string', 'number', 'type', 'function', 'variable', 'comment', 'operator', 'bracket'];
    var BACKGROUND_FIELDS = [
        { key: 'bgOpacity', label: 'Opacity', min: 0, max: 100, step: 1, suffix: '%' },
        { key: 'bgBrightness', label: 'Brightness', min: 0, max: 200, step: 1, suffix: '%' },
        { key: 'bgBlur', label: 'Blur', min: 0, max: 30, step: 1, suffix: 'px' },
        { key: 'bgPosition', label: 'Position', type: 'text', fallback: 'center center' }
    ];
    var EDITOR_BACKGROUND_FIELDS = [
        { key: 'editorBgOpacity', label: 'Opacity', min: 0, max: 100, step: 1, suffix: '%' },
        { key: 'editorBgBrightness', label: 'Brightness', min: 0, max: 200, step: 1, suffix: '%' },
        { key: 'editorBgBlur', label: 'Blur', min: 0, max: 30, step: 1, suffix: 'px' },
        { key: 'editorBgPosition', label: 'Position', type: 'text', fallback: 'center center' }
    ];
    var EFFECT_FIELDS = [
        { key: 'terminalOpacity', label: 'Terminal opacity', min: 0, max: 100, step: 1, suffix: '%' },
        { key: 'panelOpacity', label: 'Panel opacity', min: 0, max: 100, step: 1, suffix: '%' },
        { key: 'terminalBgBlur', label: 'Terminal blur', min: 0, max: 30, step: 1, suffix: 'px' },
        { key: 'welcomeBoxOpacity', label: 'Welcome card opacity', min: 0, max: 100, step: 1, suffix: '%' }
    ];
    var FALLBACK_DEFINITIONS = {
        bgBase: { type: 'color', group: 'background', cssVar: '--bg-base' },
        editorBg: { type: 'color', group: 'background', cssVar: '--editor-bg' },
        bgPanel: { type: 'color', group: 'surface', cssVar: '--bg-panel' },
        bgHeader: { type: 'color', group: 'surface', cssVar: '--bg-header' },
        accent: { type: 'color', group: 'main', cssVar: '--accent' },
        textPrimary: { type: 'color', group: 'main', cssVar: '--text-primary' },
        textSecondary: { type: 'color', group: 'text', cssVar: '--text-secondary' },
        textMuted: { type: 'color', group: 'text', cssVar: '--text-muted' },
        border: { type: 'color', group: 'border', cssVar: '--border' },
        success: { type: 'color', group: 'status', cssVar: '--success' },
        error: { type: 'color', group: 'status', cssVar: '--error' },
        warning: { type: 'color', group: 'status', cssVar: '--warning' },
        appBackground: { type: 'image', cssVar: '--app-bg-image' },
        editorBackground: { type: 'image', cssVar: '--editor-bg-image' },
        bgOpacity: { type: 'opacity', cssVar: '--app-bg-opacity' },
        bgBrightness: { type: 'brightness', cssVar: '--app-bg-brightness' },
        bgBlur: { type: 'blur', cssVar: '--app-bg-blur' },
        bgPosition: { type: 'position', cssVar: '--app-bg-position' },
        editorBgOpacity: { type: 'opacity', cssVar: '--editor-bg-opacity' },
        editorBgBrightness: { type: 'brightness', cssVar: '--editor-bg-brightness' },
        editorBgBlur: { type: 'blur', cssVar: '--editor-bg-blur' },
        editorBgPosition: { type: 'position', cssVar: '--editor-bg-position' },
        terminalOpacity: { type: 'opacity', cssVar: '--terminal-opacity' },
        panelOpacity: { type: 'opacity', cssVar: '--panel-opacity' },
        terminalBgBlur: { type: 'blur', cssVar: '--terminal-bg-blur' },
        welcomeBoxOpacity: { type: 'opacity', cssVar: '--welcome-box-opacity' },
        syntaxKeyword: { type: 'color', group: 'syntax', cssVar: '--syntax-keyword' },
        syntaxString: { type: 'color', group: 'syntax', cssVar: '--syntax-string' },
        syntaxNumber: { type: 'color', group: 'syntax', cssVar: '--syntax-number' },
        syntaxType: { type: 'color', group: 'syntax', cssVar: '--syntax-type' },
        syntaxFunction: { type: 'color', group: 'syntax', cssVar: '--syntax-function' },
        syntaxVariable: { type: 'color', group: 'syntax', cssVar: '--syntax-variable' },
        syntaxComment: { type: 'color', group: 'syntax', cssVar: '--syntax-comment' },
        syntaxOperator: { type: 'color', group: 'syntax', cssVar: '--syntax-operator' },
        syntaxBracket: { type: 'color', group: 'syntax', cssVar: '--syntax-bracket' }
    };

    function definitions() {
        if (typeof window !== 'undefined' && window.ThemeTokens && window.ThemeTokens.definitions) {
            return window.ThemeTokens.definitions;
        }
        return FALLBACK_DEFINITIONS;
    }

    function asString(value, fallback) {
        return value === undefined || value === null ? (fallback || '') : String(value);
    }

    function themeColors(theme) {
        return theme && theme.colors && typeof theme.colors === 'object' ? theme.colors : {};
    }

    function syntaxData(theme, name) {
        var syntax = theme && theme.editor && theme.editor.syntax;
        if (!syntax || typeof syntax !== 'object') return '';
        var value = syntax[name];
        if (value && typeof value === 'object') return asString(value.color, '');
        return asString(value, '');
    }

    function tokenValue(theme, key) {
        var colors = themeColors(theme);
        if (colors[key] !== undefined && colors[key] !== null) return colors[key];
        var tokenApi = typeof window !== 'undefined' ? window.ThemeTokens : null;
        var parent = tokenApi && tokenApi.inheritance && tokenApi.inheritance[key];
        if (parent && colors[parent] !== undefined && colors[parent] !== null) return colors[parent];
        return '';
    }

    function labelForKey(key) {
        return String(key || '')
            .replace(/[-_]/g, ' ')
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/\s+/g, ' ')
            .replace(/^./, function (value) { return value.toUpperCase(); });
    }

    var FRIENDLY_TOKEN_LABELS = {
        bgBase: 'Main background',
        bgOceanDark: 'Main background',
        bgOceanMedium: 'Secondary background',
        bgOceanLight: 'Surface',
        bgSurface: 'Surface',
        editorBg: 'Editor background',
        bgPanel: 'Panels',
        'bgPanel-problems': 'Problems panel',
        'bgPanel-input': 'Input',
        'bgPanel-expected': 'Expected',
        bgHeader: 'Header',
        'bgHeader-main': 'Header',
        'bgHeader-statusbar': 'Status bar',
        bgInput: 'Input fields',
        terminalBg: 'Terminal',
        accent: 'Accent',
        accentHover: 'Accent hover',
        textPrimary: 'Primary text',
        textSecondary: 'Secondary text',
        textMuted: 'Muted text',
        border: 'Borders',
        bgGlass: 'Glass surfaces',
        bgGlassHeavy: 'Heavy glass',
        bgButton: 'Buttons',
        bgButtonHover: 'Button hover',
        success: 'Success',
        error: 'Error',
        warning: 'Warning'
    };

    function friendlyTokenLabel(key) {
        return FRIENDLY_TOKEN_LABELS[key] || labelForKey(key);
    }

    function isSafeCssValue(value) {
        var text = asString(value, '').trim();
        if (!text || /[<>{};]/.test(text)) return false;
        if (/(?:url|javascript|expression)\s*\(/i.test(text)) return false;
        return /^(?:#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)|color-mix\([^)]*\)|[a-z]+)$/i.test(text);
    }

    function swatchColor(value) {
        var text = asString(value, '').trim();
        /* Monaco token colours are stored without the '#'. */
        if (/^(?:[\da-f]{6}|[\da-f]{8})$/i.test(text)) text = '#' + text;
        if (/^#[\da-f]{6}$/i.test(text)) return text;
        if (/^#[\da-f]{3}$/i.test(text)) {
            return '#' + text.slice(1).split('').map(function (part) { return part + part; }).join('');
        }
        if (/^#[\da-f]{8}$/i.test(text)) return text.slice(0, 7);
        if (/^#[\da-f]{4}$/i.test(text)) {
            return '#' + text.slice(1, 4).split('').map(function (part) { return part + part; }).join('');
        }
        return '#000000';
    }

    function sameColor(a, b) {
        var norm = function (value) { return asString(value, '').trim().replace(/^#/, '').toLowerCase(); };
        return norm(a) === norm(b);
    }

    function createRevertButton(key, label) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'tcf-revert';
        button.hidden = true;
        button.setAttribute('data-tcf-action', 'revert');
        button.setAttribute('data-key', key);
        button.setAttribute('aria-label', 'Revert ' + label);
        button.innerHTML = '<svg class="ico" width="14" height="14" aria-hidden="true"><use href="#i-arrows-clockwise"/></svg>';
        return button;
    }

    /* A changed row gets a revert button showing the saved value. */
    function markChanged(row, changed, saved) {
        row.classList.toggle('tcf-changed', changed);
        var revert = row.querySelector('[data-tcf-action="revert"]');
        if (!revert) return;
        revert.hidden = !changed;
        revert.title = 'Revert to ' + (asString(saved, '') || 'the default');
    }

    function escapeHtml(text) {
        return String(text).replace(/[&<>"']/g, function (ch) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
        });
    }

    /* JSON tokens for the highlight layer under the JSON textarea.  Only spans
     * are added, never characters, so the layer lines up with the text. */
    var JSON_TOKEN = /("(?:\x5c.|[^"\x5c\n])*")(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\],:]/g;

    function highlightJson(text) {
        var out = '';
        var last = 0;
        text.replace(JSON_TOKEN, function (match, string, colon, offset) {
            out += escapeHtml(text.slice(last, offset));
            last = offset + match.length;
            if (string && colon) {
                out += '<span class="tcf-json-key">' + escapeHtml(string) + '</span>' + escapeHtml(colon);
            } else if (string) {
                var hex = /^"(#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8}))"$/i.exec(string);
                /* A colour value is underlined in its own colour. */
                out += '<span class="tcf-json-string' + (hex ? ' tcf-json-color" style="text-decoration-color:' + hex[1] : '') + '">' + escapeHtml(string) + '</span>';
            } else if (/^[{}\[\],:]$/.test(match)) {
                out += '<span class="tcf-json-punct">' + match + '</span>';
            } else {
                out += '<span class="' + (/^-?\d/.test(match) ? 'tcf-json-number' : 'tcf-json-literal') + '">' + match + '</span>';
            }
            return match;
        });
        /* The trailing newline keeps the layer as tall as a textarea ending in one. */
        return out + escapeHtml(text.slice(last)) + '\n';
    }

    function numericValue(theme, key, fallback) {
        var value = parseFloat(tokenValue(theme, key));
        return Number.isFinite(value) ? value : fallback;
    }

    function unwrapAssetValue(value) {
        var text = asString(value, '').trim();
        if (!text || text === 'none') return '';
        var match = /^url\(\s*(['"]?)(.*?)\1\s*\)$/i.exec(text);
        return match ? match[2].trim() : text;
    }

    function previewAssetUrl(value) {
        var raw = unwrapAssetValue(value);
        if (!raw || /[\u0000-\u001f<>"']/.test(raw) || /\\/.test(raw)) return '';
        if (/^data:(?:video|image)\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(raw)) return raw;
        if (/^(?:https?|file|app):\/\//i.test(raw) || /^blob:/i.test(raw)) return raw;
        if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return '';
        try {
            return new URL(raw, document.baseURI).href;
        } catch (_) {
            return '';
        }
    }

    function isVideoAsset(value) {
        var url = previewAssetUrl(value);
        return !!url && (/^data:video\//i.test(url) || /\.(?:webm|mp4)(?:[?#].*)?$/i.test(url));
    }

    function normalizePanel(panel) {
        if (panel === 'ui') return 'colors';
        if (panel === 'json') return 'advanced';
        return PANEL_ORDER.includes(panel) ? panel : 'colors';
    }

    function findValue(target, selector) {
        var node = target && target.querySelector ? target.querySelector(selector) : null;
        return node ? node.value : '';
    }

    /* The preview is a small copy of the real window: the same floating
     * islands (header groups, explorer, editor, bottom panel, I/O column,
     * status bar) with the sizes and token mapping of islands.css.  It is laid
     * out at desktop size (PREVIEW_WIDTH) and scaled down as a whole, so
     * proportions, radii and type match the IDE instead of a squeezed mock-up.
     * The app stylesheets are not linked: their selectors assume the live
     * document, so the rules the preview needs are restated here. */
    var PREVIEW_WIDTH = 1000;
    var PREVIEW_MIN_HEIGHT = 560;
    var PREVIEW_ICONS = ['i-folder-simple-duo', 'i-folder-simple-fill', 'i-notepad-duo', 'i-notepad-fill',
        'i-terminal-window-duo', 'i-terminal-window-fill', 'i-warning-circle-duo', 'i-warning-circle-fill',
        'i-cloud-arrow-down-duo', 'i-play-fill', 'i-caret-down', 'i-caret-right', 'i-gear-six-duo', 'i-plus',
        'i-minus', 'i-square', 'i-x', 'i-file-text-duo', 'i-folder-open-duo', 'i-magnifying-glass'];

    function previewStyles() {
        return [
            ':host{display:block;position:relative;min-height:0;height:100%;overflow:hidden;}',
            '*{box-sizing:border-box;}',
            '.tcf-stage{position:absolute;left:0;top:0;width:' + PREVIEW_WIDTH + 'px;height:' + PREVIEW_MIN_HEIGHT + 'px;transform-origin:0 0;}',
            '.ico{width:20px;height:20px;fill:currentColor;flex-shrink:0;overflow:visible;}.ico .ico-alt{display:none;}.active>.ico>use:not(.ico-alt){display:none;}.active>.ico>.ico-alt{display:inline;}',
            '.app-container{--tcf-island-bg:linear-gradient(var(--bg-panel),var(--bg-panel)),var(--editor-bg);--tcf-line:1.5px solid var(--border);position:relative;display:flex;flex-direction:column;width:100%;height:100%;overflow:hidden;background:var(--tcf-app-base,#1a2530);color:var(--text-primary);font:14px Nunito,"Segoe UI",sans-serif;cursor:default;user-select:none;}',
            '.tcf-app-background{position:absolute;inset:calc(-1 * var(--app-bg-blur,0px));z-index:0;background-image:var(--app-bg-image,none);background-position:var(--app-bg-position,center center);background-size:cover;background-repeat:no-repeat;opacity:var(--app-bg-opacity,.5);filter:blur(var(--app-bg-blur,0px)) brightness(var(--app-bg-brightness,1));pointer-events:none;}',
            '.tcf-app-background.has-video{opacity:1;}',
            '.tcf-app-background>.tcf-preview-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:var(--app-bg-position,center center);pointer-events:none;}',
            '.tcf-app-overlay{position:absolute;inset:0;z-index:0;background:var(--tcf-app-overlay,transparent);pointer-events:none;}',
            '.header-bar,.content-wrapper,.status-bar{position:relative;z-index:1;}',
            /* Header: three islands */
            '.header-bar{display:flex;align-items:center;flex:0 0 60px;height:60px;padding:0 8px 0 12px;gap:10px;}',
            '.header-island{display:flex;align-items:center;gap:4px;height:46px;padding:0 6px;border-radius:20px;background:var(--tcf-island-bg);flex-shrink:0;}',
            '.logo{margin-right:2px;padding:4px 14px;border-radius:999px;background:var(--btn-primary-bg,var(--accent));color:var(--btn-primary-text,var(--button-text-on-accent,#fff));font:700 18px/22px Fredoka,sans-serif;}',
            '.toggle-btn{display:flex;align-items:center;justify-content:center;width:36px;height:34px;border-radius:12px;color:var(--text-secondary);}',
            '.toggle-btn.active{background:color-mix(in srgb,var(--accent) 18%,transparent);color:var(--accent);}',
            '.menu-btn{padding:6px 14px;border-radius:999px;color:var(--text-secondary);font-weight:800;}',
            '.tabs-wrap{flex:1 1 auto;min-width:0;}',
            '.tab{display:flex;align-items:center;gap:6px;height:32px;padding:0 8px 0 14px;border-radius:999px;color:var(--text-secondary);font-size:13px;font-weight:800;white-space:nowrap;}',
            '.tab.active{background:var(--btn-primary-bg,var(--accent));color:var(--btn-primary-text,#fff);}',
            '.tab-x{display:flex;width:16px;height:16px;align-items:center;justify-content:center;opacity:.75;}.tab-x .ico{width:11px;height:11px;}',
            '.tab-add{display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:999px;color:var(--text-secondary);}',
            '.header-actions{gap:6px;}',
            '.tool-group{display:flex;align-items:center;gap:4px;}.tool-group::after{content:"";width:1px;height:20px;margin-left:4px;background:var(--border);}',
            '.run-split{display:flex;align-items:stretch;height:34px;border-radius:999px;overflow:hidden;background:var(--btn-primary-bg,var(--accent));color:var(--btn-primary-text,#fff);}',
            '.run-main{display:flex;align-items:center;gap:6px;padding:0 12px 0 16px;font-size:15px;font-weight:800;}.run-main .ico{width:18px;height:18px;}',
            '.run-caret{display:flex;align-items:center;justify-content:center;width:32px;box-shadow:inset 1px 0 0 color-mix(in srgb,var(--btn-primary-text,#000) 22%,transparent);}.run-caret .ico{width:14px;height:14px;}',
            '.win-btns{display:flex;gap:2px;margin-left:auto;}.win-btn{display:flex;align-items:center;justify-content:center;width:40px;height:32px;color:var(--text-secondary);}.win-btn .ico{width:16px;height:16px;}',
            /* Explorer, editor, bottom panel, I/O column */
            '.content-wrapper{display:flex;flex:1 1 auto;min-height:0;}',
            '.explorer-sidebar{display:flex;flex-direction:column;flex:0 0 196px;margin:2px 0 12px 12px;border:var(--tcf-line);border-radius:22px;background:var(--tcf-island-bg);overflow:hidden;}',
            '.explorer-header{display:flex;align-items:center;justify-content:space-between;padding:12px 12px 8px 16px;}',
            '.explorer-title{font-size:15px;font-weight:800;color:var(--text-primary);}',
            '.explorer-more{color:var(--text-secondary);font-weight:800;letter-spacing:1px;}',
            '.explorer-filter{display:flex;align-items:center;gap:7px;height:32px;margin:0 10px 4px;padding:0 12px;border-radius:999px;background:color-mix(in srgb,var(--text-primary) 7%,transparent);color:var(--text-muted);font-size:12.5px;font-weight:600;}.explorer-filter .ico{width:15px;height:15px;}',
            '.cat-title{margin:8px 0 2px;padding:4px 12px 4px 16px;color:var(--text-secondary);font-size:11px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;}',
            '.explorer-item{display:flex;align-items:center;gap:7px;margin:1px 8px;padding:6px 10px;border-radius:999px;color:var(--text-primary);font-size:13px;font-weight:700;white-space:nowrap;}',
            '.explorer-item .ico{width:17px;height:17px;color:var(--text-secondary);}.explorer-item .folder{color:var(--folder-icon-open,var(--accent));}',
            '.explorer-item.child{margin-left:26px;}',
            '.explorer-item.active{background:var(--btn-primary-bg,var(--accent));color:var(--btn-primary-text,#fff);}.explorer-item.active .ico{color:inherit;}',
            '.main{display:flex;flex:1 1 auto;min-width:0;gap:10px;padding:2px 12px 12px 10px;}',
            '.editor-section{display:flex;flex-direction:column;flex:1 1 auto;min-width:0;}',
            '.editors-container{position:relative;flex:1 1 auto;min-height:0;border:var(--tcf-line);border-radius:22px;background:var(--editor-bg);overflow:hidden;}',
            '.editor-bg-layer{position:absolute;inset:calc(-1 * var(--editor-bg-blur,0px));z-index:0;background-image:var(--editor-bg-image,none);background-size:cover;background-position:var(--editor-bg-position,center center);background-repeat:no-repeat;opacity:var(--editor-bg-opacity,.15);filter:blur(var(--editor-bg-blur,0px)) brightness(var(--editor-bg-brightness,1));pointer-events:none;}',
            '.editor-bg-layer.has-video{background-image:none;}.editor-bg-layer>.tcf-preview-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:var(--editor-bg-position,center center);}',
            '.code{position:relative;z-index:1;padding-top:10px;font:14px/19px "JetBrains Mono",Consolas,monospace;color:var(--tcf-editor-fg,var(--text-primary));}',
            '.code-line{display:flex;height:19px;white-space:pre;}.code-line.current{background:var(--tcf-line-highlight,transparent);}',
            '.ln{flex:0 0 64px;padding-right:26px;text-align:right;color:var(--tcf-line-number,var(--text-muted));}.code-line.current .ln{color:var(--tcf-line-number-active,var(--text-primary));}',
            '.syntax-keyword{color:var(--syntax-keyword);}.syntax-string{color:var(--syntax-string);}.syntax-number{color:var(--syntax-number);}.syntax-type{color:var(--syntax-type);}.syntax-function{color:var(--syntax-function);}.syntax-variable{color:var(--syntax-variable);}.syntax-comment{color:var(--syntax-comment);font-style:italic;}.syntax-operator{color:var(--syntax-operator);}.syntax-bracket{color:var(--syntax-bracket);}',
            '.resizer{position:relative;flex:0 0 10px;}.resizer::before{content:"";position:absolute;left:50%;top:50%;width:40px;height:5px;margin:-2px 0 0 -20px;border-radius:999px;background:color-mix(in srgb,var(--text-primary) 28%,transparent);}',
            '.problems-panel{display:flex;flex-direction:column;flex:0 0 34%;min-height:0;border:var(--tcf-line);border-radius:22px;background:var(--bg-glass-heavy);overflow:hidden;}',
            '.problems-panel>.panel-head{display:flex;align-items:center;gap:2px;padding:4px 10px 0;border-bottom:1.5px solid color-mix(in srgb,var(--border) 70%,transparent);}',
            '.panel-tab{position:relative;padding:7px 12px 9px;color:var(--text-muted);font-size:12px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;}',
            '.panel-tab.active{color:var(--text-primary);}.panel-tab.active::after{content:"";position:absolute;left:10px;right:10px;bottom:0;height:3px;border-radius:3px 3px 0 0;background:var(--accent);}',
            '.panel-actions{display:flex;gap:4px;margin-left:auto;color:var(--text-secondary);}.panel-actions .ico{width:14px;height:14px;}',
            '.terminal-body{flex:1 1 auto;min-height:0;padding:10px 14px;background:var(--terminal-bg);color:var(--terminal-text,var(--text-secondary));font:13px/1.6 "JetBrains Mono",Consolas,monospace;white-space:pre;}',
            '.term-system{color:var(--term-line-system,var(--text-muted));}.term-success{color:var(--term-line-success,var(--success));}.term-info{color:var(--term-line-info,var(--accent));}.term-warning{color:var(--term-line-warning,var(--warning));}.term-input{color:var(--term-line-input,var(--text-primary));}',
            '.io-section{display:flex;flex-direction:column;flex:0 0 200px;gap:10px;min-height:0;}',
            '.io-panel{display:flex;flex-direction:column;flex:1 1 0;min-height:0;border:var(--tcf-line);border-radius:22px;background:var(--editor-bg);overflow:hidden;}',
            '.io-panel-input{--io-dot:var(--accent);}.io-panel-output{--io-dot:var(--warning,#f5a23a);}.io-panel-expected{--io-dot:var(--success,#4cc38a);}',
            '.io-panel>.panel-head{display:flex;align-items:center;gap:7px;padding:11px 10px 4px 14px;}',
            '.io-title{color:var(--text-primary);font-size:12px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;}',
            '.io-dot{width:9px;height:9px;border-radius:50%;background:var(--io-dot);box-shadow:0 0 0 3px color-mix(in srgb,var(--io-dot) 22%,transparent);}',
            '.io-verdict{margin-left:auto;padding:2px 9px;border-radius:999px;background:color-mix(in srgb,var(--success,#4cc38a) 22%,transparent);color:var(--success,#4cc38a);font-size:11px;font-weight:800;}',
            '.io-text{padding:6px 14px 12px;color:var(--text-primary);font:13px/1.6 "JetBrains Mono",Consolas,monospace;white-space:pre;}',
            '.status-bar{display:flex;align-items:center;justify-content:space-between;flex:0 0 30px;height:30px;margin:0 12px 10px;padding:0 14px;border-radius:999px;background:var(--tcf-island-bg);color:var(--text-secondary);font-size:12px;font-weight:800;}',
            '.status-item,.status-right{display:flex;align-items:center;gap:6px;}.status-right{gap:14px;}',
            '.status-dot{width:7px;height:7px;border-radius:50%;background:var(--success);}',
            '.status-zero{color:var(--text-muted);opacity:.75;}',
            '.status-std{padding:1px 10px;border-radius:999px;background:var(--btn-primary-bg,var(--accent));color:var(--btn-primary-text,#fff);}',
            /* Click-to-edit targets */
            '[data-preview-token]{cursor:pointer;}',
            '[data-preview-token]:hover{outline:2px dashed color-mix(in srgb,var(--accent) 70%,transparent);outline-offset:-2px;}',
            '[data-preview-token]:focus-visible{outline:2px solid var(--accent);outline-offset:-2px;}',
            '[data-preview-token].tcf-preview-selected{outline:3px solid var(--accent);outline-offset:-3px;box-shadow:0 0 0 5px color-mix(in srgb,var(--accent) 25%,transparent);}'
        ].join('');
    }

    function icon(id, altId) {
        return '<svg class="ico" aria-hidden="true"><use href="#' + id + '"/>' + (altId ? '<use class="ico-alt" href="#' + altId + '"/>' : '') + '</svg>';
    }

    function target(token, label) {
        return ' data-preview-token="' + token + '" tabindex="0" role="button" aria-label="' + label + '"';
    }

    function previewMarkup() {
        var code = [
            ['<span class="syntax-keyword">#include</span> <span class="syntax-string">&lt;bits/stdc++.h&gt;</span>', true],
            ['<span class="syntax-keyword">using namespace</span> <span class="syntax-type">std</span><span class="syntax-operator">;</span>'],
            [''],
            ['<span class="syntax-comment">// Sum of the first n numbers</span>'],
            ['<span class="syntax-keyword">int</span> <span class="syntax-function">main</span><span class="syntax-bracket">()</span> <span class="syntax-bracket">{</span>'],
            ['    <span class="syntax-type">long long</span> <span class="syntax-variable">n</span><span class="syntax-operator">,</span> <span class="syntax-variable">sum</span> <span class="syntax-operator">=</span> <span class="syntax-number">0</span><span class="syntax-operator">;</span>'],
            ['    <span class="syntax-variable">cin</span> <span class="syntax-operator">&gt;&gt;</span> <span class="syntax-variable">n</span><span class="syntax-operator">;</span>'],
            ['    <span class="syntax-keyword">for</span> <span class="syntax-bracket">(</span><span class="syntax-keyword">int</span> <span class="syntax-variable">i</span> <span class="syntax-operator">=</span> <span class="syntax-number">1</span><span class="syntax-operator">;</span> <span class="syntax-variable">i</span> <span class="syntax-operator">&lt;=</span> <span class="syntax-variable">n</span><span class="syntax-operator">;</span> <span class="syntax-operator">++</span><span class="syntax-variable">i</span><span class="syntax-bracket">)</span> <span class="syntax-variable">sum</span> <span class="syntax-operator">+=</span> <span class="syntax-variable">i</span><span class="syntax-operator">;</span>'],
            ['    <span class="syntax-variable">cout</span> <span class="syntax-operator">&lt;&lt;</span> <span class="syntax-string">"Sum: "</span> <span class="syntax-operator">&lt;&lt;</span> <span class="syntax-variable">sum</span> <span class="syntax-operator">&lt;&lt;</span> <span class="syntax-string">\'\\n\'</span><span class="syntax-operator">;</span>'],
            ['    <span class="syntax-keyword">return</span> <span class="syntax-number">0</span><span class="syntax-operator">;</span>'],
            ['<span class="syntax-bracket">}</span>']
        ].map(function (line, index) {
            return '<div class="code-line' + (line[1] ? ' current' : '') + '"><span class="ln">' + (index + 1) + '</span><span>' + line[0] + '</span></div>';
        }).join('');
        return [
            '<div class="app-container" data-theme-variant="dark">',
            '<div class="tcf-app-background" aria-hidden="true"></div><div class="tcf-app-overlay" aria-hidden="true"></div>',
            '<div class="header-bar">',
            '<div class="header-island island-nav"' + target('bgPanel', 'Edit header island color') + '>',
            '<div class="logo"' + target('accent', 'Edit accent color') + '>C++</div>',
            '<span class="toggle-btn active">' + icon('i-folder-simple-duo', 'i-folder-simple-fill') + '</span>',
            '<span class="menu-btn"' + target('textSecondary', 'Edit secondary text color') + '>File</span><span class="menu-btn">Edit</span><span class="menu-btn">View</span><span class="menu-btn">Run</span>',
            '</div>',
            '<div class="header-island tabs-wrap"' + target('bgPanel', 'Edit tab island color') + '>',
            '<span class="tab active"' + target('btnPrimaryBg', 'Edit active tab color') + '>main.cpp<span class="tab-x">' + icon('i-x') + '</span></span>',
            '<span class="tab-add">' + icon('i-plus') + '</span>',
            '</div>',
            '<div class="header-island header-actions">',
            '<div class="tool-group"><span class="toggle-btn active">' + icon('i-notepad-duo', 'i-notepad-fill') + '</span><span class="toggle-btn active">' + icon('i-terminal-window-duo', 'i-terminal-window-fill') + '</span><span class="toggle-btn">' + icon('i-warning-circle-duo', 'i-warning-circle-fill') + '</span><span class="toggle-btn">' + icon('i-cloud-arrow-down-duo') + '</span></div>',
            '<div class="run-split"' + target('btnPrimaryBg', 'Edit primary button color') + '><span class="run-main">' + icon('i-play-fill') + 'Run</span><span class="run-caret">' + icon('i-caret-down') + '</span></div>',
            '<span class="toggle-btn">' + icon('i-gear-six-duo') + '</span>',
            '</div>',
            '<div class="win-btns"><span class="win-btn">' + icon('i-minus') + '</span><span class="win-btn">' + icon('i-square') + '</span><span class="win-btn">' + icon('i-x') + '</span></div>',
            '</div>',
            '<div class="content-wrapper">',
            '<div class="explorer-sidebar"' + target('bgPanel', 'Edit explorer color') + '>',
            '<div class="explorer-header"><span class="explorer-title">contest</span><span class="explorer-more">···</span></div>',
            '<div class="explorer-filter">' + icon('i-magnifying-glass') + 'Filter files</div>',
            '<div class="cat-title">Files</div>',
            '<div class="explorer-item">' + icon('i-caret-down') + '<span class="folder">' + icon('i-folder-open-duo') + '</span>src</div>',
            '<div class="explorer-item child active"' + target('btnPrimaryBg', 'Edit selected file color') + '>' + icon('i-file-text-duo') + 'main.cpp</div>',
            '<div class="explorer-item child">' + icon('i-file-text-duo') + 'utils.h</div>',
            '<div class="explorer-item">' + icon('i-caret-right') + '<span class="folder">' + icon('i-folder-simple-duo') + '</span>tests</div>',
            '<div class="explorer-item">' + icon('i-file-text-duo') + 'input.txt</div>',
            '</div>',
            '<div class="main">',
            '<div class="editor-section">',
            '<div class="editors-container"' + target('editorBg', 'Edit editor background color') + '><div class="editor-bg-layer" aria-hidden="true"></div><div class="code">' + code + '</div></div>',
            '<div class="resizer"></div>',
            '<div class="problems-panel"' + target('bgGlassHeavy', 'Edit bottom panel color') + '>',
            '<div class="panel-head"><span class="panel-tab">Problems</span><span class="panel-tab active">Terminal</span><span class="panel-tab">Tests</span><span class="panel-actions">' + icon('i-caret-down') + icon('i-x') + '</span></div>',
            '<div class="terminal-body"' + target('terminalBg', 'Edit terminal color') + '><div class="term-system">&gt; g++ -std=c++20 -O2 main.cpp -o main</div><div class="term-success">✓ Build succeeded in 1.2s</div><div class="term-input">5</div><div>Sum: 15</div><div class="term-info">Process exited with code 0</div></div>',
            '</div>',
            '</div>',
            '<div class="io-section">',
            '<div class="io-panel io-panel-input"' + target('editorBg', 'Edit input panel color') + '><div class="panel-head"><span class="io-dot"></span><span class="io-title">Input</span></div><div class="io-text">5</div></div>',
            '<div class="io-panel io-panel-output"' + target('editorBg', 'Edit output panel color') + '><div class="panel-head"><span class="io-dot"></span><span class="io-title">Output</span><span class="io-verdict">AC</span></div><div class="io-text">Sum: 15</div></div>',
            '<div class="io-panel io-panel-expected"' + target('editorBg', 'Edit expected panel color') + '><div class="panel-head"><span class="io-dot"></span><span class="io-title">Expected</span></div><div class="io-text">Sum: 15</div></div>',
            '</div>',
            '</div>',
            '</div>',
            '<div class="status-bar"' + target('bgPanel', 'Edit status bar color') + '><span class="status-item"><span class="status-dot"></span>Ready</span><span class="status-right"><span class="status-zero">0 errors</span><span class="status-zero">0 warnings</span><span>Ln 1, Col 1</span><span class="status-std">C++20</span></span></div>',
            '</div>'
        ].join('');
    }

    function CustomizerView(controller) {
        this.controller = controller || {};
        this._legacyPanels = this.controller.activePanel === 'ui' || this.controller.activePanel === 'json';
        this.element = null;
        this._dialog = null;
        this._theme = null;
        this._options = {};
        this._searchQuery = '';
        this._jsonDirty = false;
        this._colorSignature = '';
        this._syntaxSignature = '';
        this._baseOptionsSignature = '';
        this._backgroundBuilt = false;
        this._advancedBuilt = false;
        this._previewHost = null;
        this._previewRoot = null;
        this._previewApp = null;
        this._previewVideo = null;
        this._previewVideoParent = null;
        this._previewVideoUrl = '';
        this._previewVideoKey = '';
        this._unsubscribe = null;
        this._statusMessage = '';
        this._statusTone = '';
        this._bound = {};
        this._build();
        this._subscribe();
    }

    CustomizerView.prototype._build = function () {
        var doc = typeof document !== 'undefined' ? document : null;
        if (!doc) return;

        this.element = doc.createElement('div');
        this.element.className = 'theme-customizer-view settings-overlay show';
        this.element.setAttribute('role', 'dialog');
        this.element.setAttribute('aria-modal', 'true');
        this.element.setAttribute('aria-labelledby', 'tcf-dialog-title');
        this.element.setAttribute('aria-busy', 'false');
        this.element.innerHTML = [
            '<div class="settings-popup tcf-dialog">',
            '<div class="settings-header tcf-header">',
            '<div class="tcf-heading"><h2 id="tcf-dialog-title"><svg class="ico" width="20" height="20" aria-hidden="true"><use href="#i-palette-duo"/></svg>Theme Customizer</h2><span class="tcf-dirty" data-tcf-dirty aria-live="polite"></span></div>',
            '<div class="tcf-header-fields"><label class="tcf-field"><span>Name</span><input type="text" data-tcf-name maxlength="80" autocomplete="off"></label><label class="tcf-field"><span>Variant</span><select data-tcf-type><option value="dark">Dark</option><option value="light">Light</option></select></label></div>',
            '<button type="button" class="settings-close" data-tcf-action="close" aria-label="Close theme customizer">×</button>',
            '</div>',
            '<div class="settings-container tcf-body">',
            '<div class="settings-sidebar tcf-sidebar" role="tablist" aria-label="Customizer sections">',
            '<button type="button" class="settings-tab" role="tab" data-tcf-panel="colors" aria-controls="tcf-panel-colors"><svg class="ico" width="16" height="16" aria-hidden="true"><use href="#i-palette-duo"/><use class="ico-alt" href="#i-palette-fill"/></svg>UI Colors</button>',
            '<button type="button" class="settings-tab" role="tab" data-tcf-panel="syntax" aria-controls="tcf-panel-syntax"><svg class="ico" width="16" height="16" aria-hidden="true"><use href="#i-code-duo"/><use class="ico-alt" href="#i-code-fill"/></svg>Syntax</button>',
            '<button type="button" class="settings-tab" role="tab" data-tcf-panel="backgrounds" aria-controls="tcf-panel-backgrounds"><svg class="ico" width="16" height="16" aria-hidden="true"><use href="#i-drop-duo"/><use class="ico-alt" href="#i-drop-duo"/></svg>Backgrounds</button>',
            '<button type="button" class="settings-tab" role="tab" data-tcf-panel="advanced" aria-controls="tcf-panel-advanced"><svg class="ico" width="16" height="16" aria-hidden="true"><use href="#i-wrench-duo"/><use class="ico-alt" href="#i-wrench-fill"/></svg>Advanced</button>',
            '</div>',
            '<div class="settings-content tcf-main">',
            '<div class="tcf-panel-toolbar"><label class="tcf-search" data-tcf-search-wrap><svg class="ico" width="15" height="15" aria-hidden="true"><use href="#i-magnifying-glass"/></svg><input type="search" data-tcf-search placeholder="Search colors" autocomplete="off"><button type="button" data-tcf-action="clear-search" aria-label="Clear search">×</button></label><span class="tcf-panel-hint"><span class="tcf-panel-name" data-tcf-panel-name></span><span class="tooltip" data-tcf-panel-hint>?</span></span></div>',
            '<div class="tcf-scroll">',
            '<section class="settings-panel active tcf-panel" id="tcf-panel-colors" data-tcf-panel-view="colors" role="tabpanel"><div class="tcf-token-list" data-tcf-color-list></div></section>',
            '<section class="settings-panel active tcf-panel" id="tcf-panel-syntax" data-tcf-panel-view="syntax" role="tabpanel"><div class="tcf-token-list" data-tcf-syntax-list></div></section>',
            '<section class="settings-panel active tcf-panel" id="tcf-panel-backgrounds" data-tcf-panel-view="backgrounds" role="tabpanel"><div data-tcf-background-list></div></section>',
            '<section class="settings-panel active tcf-panel" id="tcf-panel-advanced" data-tcf-panel-view="advanced" role="tabpanel"><div data-tcf-advanced-content></div></section>',
            '</div>',
            '</div>',
            '<div class="tcf-preview-pane"><div class="tcf-preview-heading"><h3>Live preview</h3><span class="tcf-preview-help">Click any part to edit its color</span></div><div class="tcf-preview-host" data-tcf-preview></div></div>',
            '</div>',
            '<div class="settings-footer tcf-footer"><div class="tcf-footer-left"><span class="tcf-status" data-tcf-status role="status" aria-live="polite">Ready</span><button type="button" class="tcf-danger-link" data-tcf-action="delete">Delete theme</button></div><div class="tcf-footer-actions"><button type="button" class="btn-reset" data-tcf-action="undo" title="Undo the last change (Ctrl+Z)">Undo</button><button type="button" class="btn-reset" data-tcf-action="redo" title="Redo (Ctrl+Y)">Redo</button><button type="button" class="btn-reset" data-tcf-action="reset" title="Reset the whole theme">Reset all</button><button type="button" class="btn-reset" data-tcf-action="close">Cancel</button><button type="button" class="btn-reset tcf-secondary" data-tcf-action="save-background">Save background</button><button type="button" class="btn-reset tcf-secondary" data-tcf-action="save-as">Save as new</button><button type="button" class="btn-save" data-tcf-action="save">Save</button></div></div>',
            '</div>'
        ].join('');

        this._dialog = this.element.querySelector('.tcf-dialog');
        this._previewHost = this.element.querySelector('[data-tcf-preview]');
        this._bindEvents();
        this._buildPreview();
    };

    CustomizerView.prototype._bindEvents = function () {
        if (!this.element) return;
        var self = this;
        this._bound.click = function (event) {
            var action = event.target.closest ? event.target.closest('[data-tcf-action]') : null;
            if (action && self.element.contains(action)) {
                self._handleAction(action.getAttribute('data-tcf-action'), action, event);
                return;
            }
            var panel = event.target.closest ? event.target.closest('[data-tcf-panel]') : null;
            if (panel && self.element.contains(panel)) {
                var selectedPanel = panel.getAttribute('data-tcf-panel');
                self._invoke('selectPanel', self._controllerPanel(selectedPanel));
                self._setPanelImmediately(selectedPanel);
            }
        };
        this._bound.input = function (event) { self._handleInput(event, false); };
        this._bound.change = function (event) { self._handleInput(event, true); };
        this._bound.focusout = function (event) { self._handleInput(event, true); };
        this._bound.keydown = function (event) {
            if (event.key === 'Escape') {
                event.preventDefault();
                self._invoke('close');
                return;
            }
            if (event.key === 'Tab' && self._dialog) {
                var focusable = Array.prototype.filter.call(self._dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])'), function (node) {
                    return !node.hidden && node.getAttribute('aria-hidden') !== 'true' && node.offsetParent !== null;
                });
                if (focusable.length) {
                    var first = focusable[0];
                    var last = focusable[focusable.length - 1];
                    if (event.shiftKey && event.target === first) {
                        event.preventDefault();
                        last.focus();
                        return;
                    }
                    if (!event.shiftKey && event.target === last) {
                        event.preventDefault();
                        first.focus();
                        return;
                    }
                }
            }
            var json = event.target.closest ? event.target.closest('[data-tcf-json]') : null;
            if (json && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                self._handleAction('apply-json', json, event);
                return;
            }
            if ((event.key === 'Enter' || event.key === 'Tab') && event.target.matches && event.target.matches('[data-tcf-token-input],[data-tcf-bg-url],[data-tcf-position]')) {
                self._handleInput(event, true);
            }
        };
        this.element.addEventListener('click', this._bound.click);
        this.element.addEventListener('input', this._bound.input);
        this.element.addEventListener('change', this._bound.change);
        this.element.addEventListener('focusout', this._bound.focusout);
        this.element.addEventListener('keydown', this._bound.keydown);
    };

    CustomizerView.prototype._subscribe = function () {
        var self = this;
        if (typeof this.controller.subscribe === 'function') {
            this._unsubscribe = this.controller.subscribe(function (state) { self.notify(state); });
        } else if (typeof this.controller.onChange === 'function') {
            this._unsubscribe = this.controller.onChange(function (state) { self.notify(state); });
        }
    };

    CustomizerView.prototype._state = function () {
        var state = this.controller.state || {};
        var getter = typeof this.controller.getState === 'function' ? this.controller.getState() || {} : {};
        return {
            theme: this.controller.workingTheme || state.workingTheme || getter.workingTheme || this._theme || {},
            panel: normalizePanel(this.controller.activePanel || state.activePanel || getter.activePanel || 'colors'),
            dirty: this.controller.dirty !== undefined ? this.controller.dirty : (state.dirty !== undefined ? state.dirty : !!getter.dirty),
            busy: this.controller.busy !== undefined ? this.controller.busy : (state.busy !== undefined ? state.busy : !!getter.busy),
            canUndo: this.controller.canUndo !== undefined ? this.controller.canUndo : (state.canUndo !== undefined ? state.canUndo : getter.canUndo),
            canRedo: this.controller.canRedo !== undefined ? this.controller.canRedo : (state.canRedo !== undefined ? state.canRedo : getter.canRedo),
            isBuiltin: this.controller.isBuiltin !== undefined ? this.controller.isBuiltin : (state.isBuiltin !== undefined ? state.isBuiltin : !!getter.isBuiltin),
            force: false
        };
    };

    CustomizerView.prototype._controllerPanel = function (panel) {
        var selected = normalizePanel(panel);
        /* Support the temporary ui/json controller names during migration. */
        if (this._legacyPanels && selected === 'colors') return 'ui';
        if (this._legacyPanels && selected === 'advanced') return 'json';
        return selected;
    };

    CustomizerView.prototype._invoke = function (method) {
        var args = Array.prototype.slice.call(arguments, 1);
        var fn = this.controller && this.controller[method];
        if (typeof fn !== 'function') {
            this._setStatus('Action unavailable: ' + method, 'error');
            return undefined;
        }
        try {
            var result = fn.apply(this.controller, args);
            if (result && typeof result.catch === 'function') {
                result.catch(function (error) { console.error('[ThemeCustomizerView]', error); });
            }
            return result;
        } catch (error) {
            console.error('[ThemeCustomizerView]', error);
            this._setStatus(error && error.message ? error.message : 'Unable to apply change', 'error');
            return undefined;
        }
    };

    CustomizerView.prototype._setStatus = function (message, tone) {
        if (!this.element) return;
        this._statusMessage = message || '';
        this._statusTone = tone || '';
        var status = this.element.querySelector('[data-tcf-status]');
        if (!status) return;
        status.textContent = message || '';
        status.dataset.tone = tone || '';
        status.dataset.type = tone || '';
    };

    CustomizerView.prototype._handleAction = function (action, node) {
        if (!action) return;
        if (action === 'close') return this._invoke('close');
        if (action === 'panel') return this._invoke('selectPanel', node.getAttribute('data-panel'));
        if (action === 'undo') return this._invoke('undo');
        if (action === 'redo') return this._invoke('redo');
        if (action === 'reset') return this._invoke('reset');
        if (action === 'revert') return this._invoke('revertToken', node.getAttribute('data-key'));
        if (action === 'clear-background') return this._invoke('clearBackground', node.getAttribute('data-key'));
        if (action === 'delete') return this._invoke('deleteTheme');
        if (action === 'save') return this._invoke('save', { asNew: false, backgroundOnly: false });
        if (action === 'save-as') return this._invoke('save', { asNew: true, backgroundOnly: false });
        if (action === 'save-background') return this._invoke('save', { asNew: false, backgroundOnly: true });
        if (action === 'export') return this._invoke('exportTheme');
        if (action === 'import') {
            var input = this.element.querySelector('[data-tcf-import-file]');
            if (input) input.click();
            return;
        }
        if (action === 'apply-json') {
            var json = this.getJsonText();
            var result = this._invoke('applyJson', json);
            if (result !== undefined) this._jsonDirty = false;
            return result;
        }
        if (action === 'clear-search') {
            var search = this.element.querySelector('[data-tcf-search]');
            if (search) search.value = '';
            this._searchQuery = '';
            return this.render(this._theme, Object.assign({}, this._options, { force: true }));
        }
    };

    CustomizerView.prototype._handleInput = function (event, commit) {
        var target = event.target;
        if (!target || !target.matches) return;
        if (target.matches('[data-tcf-name]')) {
            this._invoke('setName', target.value);
            return;
        }
        if (target.matches('[data-tcf-type]')) {
            this._invoke('setType', target.value);
            return;
        }
        if (target.matches('[data-tcf-base-theme]')) {
            this._invoke('setBaseTheme', target.value);
            return;
        }
        if (target.matches('[data-tcf-search]')) {
            this._searchQuery = target.value.trim().toLowerCase();
            this._renderTokenPanels();
            return;
        }
        if (target.matches('[data-tcf-json]')) {
            this._jsonDirty = true;
            this._highlightJson();
            return;
        }
        if (target.matches('[data-tcf-token-input]')) {
            var key = target.getAttribute('data-key');
            if (!isSafeCssValue(target.value)) {
                target.setAttribute('aria-invalid', 'true');
                return;
            }
            target.removeAttribute('aria-invalid');
            this._dispatchToken(key, target.value, commit);
            return;
        }
        if (target.matches('[data-tcf-color-picker]')) {
            this._dispatchToken(target.getAttribute('data-key'), target.value, commit);
            return;
        }
        if (target.matches('[data-tcf-syntax-input]')) {
            var syntaxInput = target.getAttribute('data-syntax-key');
            if (!isSafeCssValue(target.value)) {
                target.setAttribute('aria-invalid', 'true');
                return;
            }
            target.removeAttribute('aria-invalid');
            this._invoke('setSyntax', syntaxInput, target.value);
            return;
        }
        if (target.matches('[data-tcf-syntax-picker]')) {
            this._invoke('setSyntax', target.getAttribute('data-syntax-key'), target.value);
            return;
        }
        if (target.matches('[data-tcf-range]')) {
            var rangeKey = target.getAttribute('data-key');
            var output = target.parentElement && target.parentElement.querySelector('[data-tcf-range-value]');
            if (output) output.textContent = this._formatRange(rangeKey, target.value);
            this._dispatchToken(rangeKey, Number(target.value), commit);
            return;
        }
        if (target.matches('[data-tcf-position]')) {
            var position = target.getAttribute('data-key');
            if (target.value.trim()) this._dispatchToken(position, target.value.trim(), commit);
            return;
        }
        if (target.matches('[data-tcf-bg-url]')) {
            var backgroundKey = target.getAttribute('data-key');
            var value = target.value.trim();
            if (value && !/^(?:https?:|file:|data:|assets[/\\]|[/\\]|none$)/i.test(value)) {
                target.setAttribute('aria-invalid', 'true');
                return;
            }
            target.removeAttribute('aria-invalid');
            this._dispatchToken(backgroundKey, value || 'none', commit);
            return;
        }
        if (target.matches('[data-tcf-bg-file]')) {
            var file = target.files && target.files[0];
            if (file) this._invoke('setBackgroundFile', file, target.getAttribute('data-key'));
            target.value = '';
            return;
        }
        if (target.matches('[data-tcf-import-file]')) {
            var importFile = target.files && target.files[0];
            if (importFile) this._invoke('importFile', importFile);
            target.value = '';
        }
    };

    CustomizerView.prototype._dispatchToken = function (key, value, commit) {
        if (!key) return;
        this._invoke('setToken', key, value, { commit: !!commit });
    };

    CustomizerView.prototype._setPanelImmediately = function (panel) {
        if (!PANEL_ORDER.includes(panel)) return;
        this._options.panel = panel;
        this._renderPanelState(panel);
        this._renderTokenPanels();
    };

    CustomizerView.prototype._renderPanelState = function (panel) {
        if (!this.element) return;
        var tabs = this.element.querySelectorAll('[data-tcf-panel]');
        var views = this.element.querySelectorAll('[data-tcf-panel-view]');
        Array.prototype.forEach.call(tabs, function (tab) {
            var selected = tab.getAttribute('data-tcf-panel') === panel;
            tab.classList.toggle('active', selected);
            tab.setAttribute('aria-selected', selected ? 'true' : 'false');
            tab.setAttribute('tabindex', selected ? '0' : '-1');
        });
        Array.prototype.forEach.call(views, function (view) {
            var active = view.getAttribute('data-tcf-panel-view') === panel;
            view.hidden = !active;
            view.setAttribute('aria-hidden', active ? 'false' : 'true');
        });
        var searchWrap = this.element.querySelector('[data-tcf-search-wrap]');
        if (searchWrap) searchWrap.hidden = panel !== 'colors' && panel !== 'syntax';
        /* Panels without search show their name in the toolbar; the help is in the ? tooltip. */
        var name = this.element.querySelector('[data-tcf-panel-name]');
        if (name) name.textContent = panel === 'backgrounds' ? 'Backgrounds' : panel === 'advanced' ? 'Advanced' : '';
        var hint = this.element.querySelector('[data-tcf-panel-hint]');
        if (hint) hint.title = PANEL_HELP[panel] || '';
    };

    CustomizerView.prototype._renderTokenPanels = function () {
        if (!this.element || !this._theme) return;
        this._renderColors();
        this._renderSyntax();
        this._renderBackgrounds();
        this._renderAdvanced();
    };

    CustomizerView.prototype._captureFocus = function () {
        if (!this.element || !this.element.ownerDocument) return null;
        var active = this.element.ownerDocument.activeElement;
        if (!active || !this.element.contains(active)) return null;
        var key = active.getAttribute && (active.getAttribute('data-key') || active.getAttribute('data-syntax-key'));
        if (!key) return null;
        return { key: key, kind: active.getAttribute('data-tcf-token-input') !== null ? 'token' : active.getAttribute('data-tcf-color-picker') !== null ? 'picker' : active.getAttribute('data-tcf-syntax-input') !== null ? 'syntax' : active.getAttribute('data-tcf-syntax-picker') !== null ? 'syntax-picker' : active.getAttribute('data-tcf-range') !== null ? 'range' : active.getAttribute('data-tcf-bg-url') !== null ? 'bg-url' : active.getAttribute('data-tcf-position') !== null ? 'position' : '', start: active.selectionStart, end: active.selectionEnd };
    };

    CustomizerView.prototype._restoreFocus = function (snapshot) {
        if (!snapshot || !this.element) return;
        var selector = snapshot.kind === 'token' ? '[data-tcf-token-input]' : snapshot.kind === 'picker' ? '[data-tcf-color-picker]' : snapshot.kind === 'syntax' ? '[data-tcf-syntax-input]' : snapshot.kind === 'syntax-picker' ? '[data-tcf-syntax-picker]' : snapshot.kind === 'range' ? '[data-tcf-range]' : snapshot.kind === 'bg-url' ? '[data-tcf-bg-url]' : snapshot.kind === 'position' ? '[data-tcf-position]' : '';
        if (!selector) return;
        var nodes = this.element.querySelectorAll(selector);
        var target = Array.prototype.find.call(nodes, function (node) {
            return node.getAttribute('data-key') === snapshot.key || node.getAttribute('data-syntax-key') === snapshot.key;
        });
        if (!target || typeof target.focus !== 'function') return;
        target.focus();
        if (snapshot.start !== undefined && target.setSelectionRange) {
            try { target.setSelectionRange(snapshot.start, snapshot.end); } catch (_) { }
        }
    };

    CustomizerView.prototype._groupRank = function (group) {
        var index = GROUP_ORDER.indexOf(group || 'other');
        return index < 0 ? GROUP_ORDER.length : index;
    };

    CustomizerView.prototype._renderColors = function () {
        var list = this.element && this.element.querySelector('[data-tcf-color-list]');
        if (!list) return;
        var defs = definitions();
        var query = this._searchQuery;
        var entries = Object.keys(defs).filter(function (key) {
            var def = defs[key] || {};
            if (def.type !== 'color' || def.group === 'syntax' || key.indexOf('syntax') === 0) return false;
            var searchable = (key + ' ' + labelForKey(key) + ' ' + asString(def.group, '')).toLowerCase();
            return !query || searchable.indexOf(query) >= 0;
        }.bind(this)).sort(function (a, b) {
            var ag = defs[a] && defs[a].group || 'other';
            var bg = defs[b] && defs[b].group || 'other';
            return this._groupRank(ag) - this._groupRank(bg) || labelForKey(a).localeCompare(labelForKey(b));
        }.bind(this));
        var signature = entries.join('|') + '|' + query;
        var snapshot = this._captureFocus();
        if (signature !== this._colorSignature) {
            list.replaceChildren();
            var groups = {};
            entries.forEach(function (key) {
                var group = defs[key] && defs[key].group || 'other';
                if (!groups[group]) {
                    var wrapper = document.createElement('section');
                    wrapper.className = 'tcf-token-group';
                    var heading = document.createElement('h3');
                    heading.className = 'tcf-token-group-title';
                    heading.textContent = labelForKey(group);
                    wrapper.appendChild(heading);
                    var rows = document.createElement('div');
                    rows.className = 'tcf-token-group-rows';
                    wrapper.appendChild(rows);
                    groups[group] = rows;
                    list.appendChild(wrapper);
                }
                groups[group].appendChild(this._createColorRow(key, defs[key]));
            }.bind(this));
            if (!entries.length) {
                var empty = document.createElement('p');
                empty.className = 'tcf-empty';
                empty.textContent = query ? 'No matching color tokens.' : 'No editable color tokens are available.';
                list.appendChild(empty);
            }
            this._colorSignature = signature;
        }
        this._syncColorRows();
        this._restoreFocus(snapshot);
    };

    CustomizerView.prototype._createColorRow = function (key, def) {
        var row = document.createElement('div');
        row.className = 'setting-row tcf-token-row';
        row.setAttribute('data-tcf-token-row', 'true');
        row.setAttribute('data-key', key);
        var label = document.createElement('div');
        label.className = 'tcf-token-label';
        var name = document.createElement('span');
        name.className = 'tcf-token-name';
        name.textContent = friendlyTokenLabel(key);
        var variable = document.createElement('code');
        variable.className = 'tcf-token-var';
        variable.textContent = asString(def && def.cssVar, '');
        label.appendChild(name);
        label.appendChild(variable);
        var editor = document.createElement('div');
        editor.className = 'tcf-token-editor';
        var picker = document.createElement('input');
        picker.type = 'color';
        picker.className = 'tcf-color-picker';
        picker.setAttribute('data-tcf-color-picker', 'true');
        picker.setAttribute('data-key', key);
        picker.setAttribute('aria-label', friendlyTokenLabel(key) + ' color swatch');
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'tcf-token-input';
        input.setAttribute('data-tcf-token-input', 'true');
        input.setAttribute('data-key', key);
        input.setAttribute('aria-label', friendlyTokenLabel(key) + ' CSS value');
        input.spellcheck = false;
        editor.appendChild(createRevertButton(key, friendlyTokenLabel(key)));
        editor.appendChild(picker);
        editor.appendChild(input);
        row.appendChild(label);
        row.appendChild(editor);
        return row;
    };

    CustomizerView.prototype._syncColorRows = function () {
        var self = this;
        var rows = this.element.querySelectorAll('[data-tcf-token-row]');
        Array.prototype.forEach.call(rows, function (row) {
            var key = row.getAttribute('data-key');
            var value = asString(tokenValue(self._theme, key), '');
            var input = row.querySelector('[data-tcf-token-input]');
            var picker = row.querySelector('[data-tcf-color-picker]');
            var active = self.element.ownerDocument && self.element.ownerDocument.activeElement;
            if (input && (input !== active || self._options.force)) input.value = value;
            if (picker && (picker !== active || self._options.force)) picker.value = swatchColor(value);
            if (input) input.title = value;
            if (typeof self.controller.savedValue === 'function') {
                var saved = self.controller.savedValue(key);
                markChanged(row, !sameColor(themeColors(self._theme)[key], saved), saved);
            }
        });
    };

    CustomizerView.prototype._renderSyntax = function () {
        var list = this.element && this.element.querySelector('[data-tcf-syntax-list]');
        if (!list) return;
        var defs = definitions();
        var query = this._searchQuery;
        var entries = SYNTAX_KEYS.filter(function (name) {
            var key = 'syntax' + name.charAt(0).toUpperCase() + name.slice(1);
            var def = defs[key] || {};
            var searchable = (name + ' ' + labelForKey(name)).toLowerCase();
            return (def.type === 'color' || !Object.keys(def).length) && (!query || searchable.indexOf(query) >= 0);
        });
        var signature = entries.join('|') + '|' + query;
        var snapshot = this._captureFocus();
        if (signature !== this._syntaxSignature) {
            list.replaceChildren();
            entries.forEach(function (name) { list.appendChild(this._createSyntaxRow(name)); }.bind(this));
            if (!entries.length) {
                var empty = document.createElement('p');
                empty.className = 'tcf-empty';
                empty.textContent = query ? 'No matching syntax tokens.' : 'No syntax tokens are available.';
                list.appendChild(empty);
            }
            this._syntaxSignature = signature;
        }
        this._syncSyntaxRows();
        this._restoreFocus(snapshot);
    };

    CustomizerView.prototype._createSyntaxRow = function (name) {
        var row = document.createElement('div');
        row.className = 'setting-row tcf-token-row';
        row.setAttribute('data-tcf-syntax-row', 'true');
        row.setAttribute('data-syntax-key', name);
        var label = document.createElement('div');
        label.className = 'tcf-token-label';
        var title = document.createElement('span');
        title.className = 'tcf-token-name';
        title.textContent = labelForKey(name);
        var variable = document.createElement('code');
        variable.className = 'tcf-token-var';
        variable.textContent = '--syntax-' + name;
        label.appendChild(title);
        label.appendChild(variable);
        var editor = document.createElement('div');
        editor.className = 'tcf-token-editor';
        var picker = document.createElement('input');
        picker.type = 'color';
        picker.className = 'tcf-color-picker';
        picker.setAttribute('data-tcf-syntax-picker', 'true');
        picker.setAttribute('data-syntax-key', name);
        picker.setAttribute('aria-label', labelForKey(name) + ' syntax swatch');
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'tcf-token-input';
        input.setAttribute('data-tcf-syntax-input', 'true');
        input.setAttribute('data-syntax-key', name);
        input.setAttribute('aria-label', labelForKey(name) + ' syntax CSS value');
        input.spellcheck = false;
        editor.appendChild(createRevertButton('syntax' + name.charAt(0).toUpperCase() + name.slice(1), labelForKey(name)));
        editor.appendChild(picker);
        editor.appendChild(input);
        row.appendChild(label);
        row.appendChild(editor);
        return row;
    };

    CustomizerView.prototype._syncSyntaxRows = function () {
        var self = this;
        var rows = this.element.querySelectorAll('[data-tcf-syntax-row]');
        Array.prototype.forEach.call(rows, function (row) {
            var name = row.getAttribute('data-syntax-key');
            var value = syntaxData(self._theme, name);
            var input = row.querySelector('[data-tcf-syntax-input]');
            var picker = row.querySelector('[data-tcf-syntax-picker]');
            var active = self.element.ownerDocument && self.element.ownerDocument.activeElement;
            if (input && (input !== active || self._options.force)) input.value = value;
            if (picker && (picker !== active || self._options.force)) picker.value = swatchColor(value);
            if (typeof self.controller.savedSyntax === 'function') {
                var saved = self.controller.savedSyntax(name);
                markChanged(row, !sameColor(value, saved), saved);
            }
        });
    };

    CustomizerView.prototype._buildBackgrounds = function () {
        if (this._backgroundBuilt) return;
        var list = this.element.querySelector('[data-tcf-background-list]');
        if (!list) return;
        list.appendChild(this._createBackgroundCard('app', 'Application background', 'appBackground', BACKGROUND_FIELDS));
        list.appendChild(this._createBackgroundCard('editor', 'Editor background', 'editorBackground', EDITOR_BACKGROUND_FIELDS));
        var effects = document.createElement('section');
        effects.className = 'setting-row tcf-background-card';
        var heading = document.createElement('h4');
        heading.className = 'tcf-card-title';
        heading.textContent = 'Shared effects';
        effects.appendChild(heading);
        effects.appendChild(this._createRangeGrid(EFFECT_FIELDS));
        list.appendChild(effects);
        this._backgroundBuilt = true;
    };

    CustomizerView.prototype._createBackgroundCard = function (kind, title, imageKey, fields) {
        var card = document.createElement('section');
        card.className = 'setting-row tcf-background-card';
        card.setAttribute('data-background-card', kind);
        var heading = document.createElement('div');
        heading.className = 'tcf-card-heading';
        var titleNode = document.createElement('h4');
        titleNode.className = 'tcf-card-title';
        titleNode.textContent = title;
        var clear = document.createElement('button');
        clear.type = 'button';
        clear.className = 'btn-theme-action tcf-small-button';
        clear.setAttribute('data-tcf-action', 'clear-background');
        clear.setAttribute('data-key', imageKey);
        clear.textContent = 'Clear';
        heading.appendChild(titleNode);
        heading.appendChild(clear);
        card.appendChild(heading);
        var url = document.createElement('input');
        url.type = 'text';
        url.className = 'tcf-background-url';
        url.setAttribute('data-tcf-bg-url', 'true');
        url.setAttribute('data-key', imageKey);
        url.placeholder = 'Image or video URL';
        url.setAttribute('aria-label', title + ' URL');
        url.spellcheck = false;
        var source = document.createElement('div');
        source.className = 'tcf-source-row';
        source.appendChild(url);
        card.appendChild(source);
        var fileLabel = document.createElement('label');
        fileLabel.className = 'btn-theme-action tcf-file-button';
        fileLabel.textContent = 'Choose file…';
        var file = document.createElement('input');
        file.type = 'file';
        file.accept = 'image/*,video/*';
        file.setAttribute('data-tcf-bg-file', 'true');
        file.setAttribute('data-key', imageKey);
        fileLabel.appendChild(file);
        source.appendChild(fileLabel);
        card.appendChild(this._createRangeGrid(fields));
        return card;
    };

    CustomizerView.prototype._createRangeGrid = function (fields) {
        var grid = document.createElement('div');
        grid.className = 'tcf-range-grid';
        fields.forEach(function (field) {
            var row = document.createElement('label');
            row.className = 'tcf-range-row';
            var title = document.createElement('span');
            title.className = 'tcf-range-label';
            title.textContent = field.label;
            row.appendChild(title);
            if (field.type === 'text') {
                var position = document.createElement('input');
                position.type = 'text';
                position.className = 'tcf-position-input';
                position.setAttribute('data-tcf-position', 'true');
                position.setAttribute('data-key', field.key);
                position.setAttribute('data-fallback', field.fallback || '');
                position.setAttribute('aria-label', field.label);
                row.appendChild(position);
            } else {
                var range = document.createElement('input');
                range.type = 'range';
                range.min = String(field.min);
                range.max = String(field.max);
                range.step = String(field.step || 1);
                range.setAttribute('data-tcf-range', 'true');
                range.setAttribute('data-key', field.key);
                range.setAttribute('aria-label', field.label);
                var output = document.createElement('output');
                output.setAttribute('data-tcf-range-value', 'true');
                output.textContent = field.min + (field.suffix || '');
                row.appendChild(range);
                row.appendChild(output);
            }
            grid.appendChild(row);
        });
        return grid;
    };

    CustomizerView.prototype._renderBackgrounds = function () {
        this._buildBackgrounds();
        if (!this.element || !this._theme) return;
        var self = this;
        Array.prototype.forEach.call(this.element.querySelectorAll('[data-tcf-bg-url]'), function (input) {
            var active = self.element.ownerDocument && self.element.ownerDocument.activeElement;
            if (input !== active || self._options.force) input.value = asString(tokenValue(self._theme, input.getAttribute('data-key')), '').replace(/^url\(['"]?|['"]?\)$/g, '');
        });
        Array.prototype.forEach.call(this.element.querySelectorAll('[data-tcf-range]'), function (range) {
            var active = self.element.ownerDocument && self.element.ownerDocument.activeElement;
            var key = range.getAttribute('data-key');
            var fallback = key.indexOf('Brightness') >= 0 ? 100 : key === 'bgOpacity' ? 50 : key === 'editorBgOpacity' ? 15 : key === 'terminalOpacity' || key === 'panelOpacity' || key === 'welcomeBoxOpacity' ? 100 : 0;
            if (range !== active || self._options.force) range.value = String(numericValue(self._theme, key, fallback));
            var output = range.parentElement && range.parentElement.querySelector('[data-tcf-range-value]');
            if (output) output.textContent = self._formatRange(key, range.value);
        });
        Array.prototype.forEach.call(this.element.querySelectorAll('[data-tcf-position]'), function (input) {
            var active = self.element.ownerDocument && self.element.ownerDocument.activeElement;
            if (input !== active || self._options.force) input.value = asString(tokenValue(self._theme, input.getAttribute('data-key')), '') || input.getAttribute('data-fallback') || 'center center';
        });
    };

    CustomizerView.prototype._formatRange = function (key, value) {
        var suffix = key.toLowerCase().indexOf('blur') >= 0 ? 'px' : '%';
        return asString(value, '0') + suffix;
    };

    CustomizerView.prototype._getThemeOptions = function () {
        var source = this.controller.themeOptions || this.controller.themes;
        if (!source && typeof window !== 'undefined' && window.ThemeManager) {
            try { source = window.ThemeManager.getThemeList(); } catch (_) { source = []; }
        }
        if (source instanceof Map) source = Array.from(source.values());
        if (!Array.isArray(source)) source = [];
        return source.map(function (item) {
            var meta = item && item.meta ? item.meta : item;
            return { id: asString(item && item.id || meta && meta.id, ''), name: asString(item && item.name || meta && meta.name, '') };
        }).filter(function (item) { return item.id; });
    };

    CustomizerView.prototype._buildAdvanced = function () {
        if (this._advancedBuilt) return;
        var content = this.element.querySelector('[data-tcf-advanced-content]');
        if (!content) return;
        var baseLabel = document.createElement('label');
        baseLabel.className = 'tcf-field tcf-base-theme';
        var baseText = document.createElement('span');
        baseText.textContent = 'Base theme';
        var base = document.createElement('select');
        base.setAttribute('data-tcf-base-theme', 'true');
        base.setAttribute('aria-label', 'Base theme');
        baseLabel.appendChild(baseText);
        baseLabel.appendChild(base);
        content.appendChild(baseLabel);
        var fileActions = document.createElement('div');
        fileActions.className = 'tcf-advanced-actions';
        var importButton = document.createElement('button');
        importButton.type = 'button';
        importButton.className = 'btn-theme-action';
        importButton.setAttribute('data-tcf-action', 'import');
        importButton.textContent = 'Import JSON';
        var exportButton = document.createElement('button');
        exportButton.type = 'button';
        exportButton.className = 'btn-theme-action';
        exportButton.setAttribute('data-tcf-action', 'export');
        exportButton.textContent = 'Export JSON';
        var importFile = document.createElement('input');
        importFile.type = 'file';
        importFile.accept = '.json,application/json';
        importFile.hidden = true;
        importFile.setAttribute('data-tcf-import-file', 'true');
        fileActions.appendChild(importButton);
        fileActions.appendChild(exportButton);
        fileActions.appendChild(importFile);
        content.appendChild(fileActions);
        var jsonLabel = document.createElement('label');
        jsonLabel.className = 'tcf-json-label';
        var jsonTitle = document.createElement('span');
        jsonTitle.textContent = 'Theme JSON';
        var json = document.createElement('textarea');
        json.className = 'tcf-json';
        json.setAttribute('data-tcf-json', 'true');
        json.setAttribute('aria-label', 'Theme JSON');
        json.spellcheck = false;
        jsonLabel.appendChild(jsonTitle);
        json.wrap = 'off';
        var jsonEditor = document.createElement('div');
        jsonEditor.className = 'tcf-json-editor';
        var highlight = document.createElement('pre');
        highlight.className = 'tcf-json-highlight';
        highlight.setAttribute('aria-hidden', 'true');
        jsonEditor.appendChild(highlight);
        jsonEditor.appendChild(json);
        json.addEventListener('scroll', function () {
            highlight.scrollTop = json.scrollTop;
            highlight.scrollLeft = json.scrollLeft;
        });
        jsonLabel.appendChild(jsonEditor);
        content.appendChild(jsonLabel);
        var apply = document.createElement('button');
        apply.type = 'button';
        apply.className = 'btn-save tcf-apply-json';
        apply.setAttribute('data-tcf-action', 'apply-json');
        apply.textContent = 'Apply JSON';
        apply.title = 'Apply the JSON to the draft (Ctrl+Enter). Invalid values are rejected.';
        content.appendChild(apply);
        this._advancedBuilt = true;
    };

    CustomizerView.prototype._renderAdvanced = function () {
        this._buildAdvanced();
        if (!this.element || !this._theme) return;
        var base = this.element.querySelector('[data-tcf-base-theme]');
        if (base) {
            var current = this.controller.baseThemeId || (this.controller.state && this.controller.state.baseThemeId) || '';
            var options = this._getThemeOptions();
            var optionSignature = options.map(function (item) { return item.id; }).join('|');
            if (optionSignature !== this._baseOptionsSignature) {
                base.replaceChildren();
                options.forEach(function (item) {
                    var option = document.createElement('option');
                    option.value = item.id;
                    option.textContent = item.name || item.id;
                    base.appendChild(option);
                });
                this._baseOptionsSignature = optionSignature;
            }
            base.value = current;
        }
        /* The JSON reads like a file in the editor of the theme being edited. */
        var jsonEditor = this.element.querySelector('.tcf-json-editor');
        if (jsonEditor) {
            var theme = this._theme;
            var colors = themeColors(theme);
            var editor = theme.editor || {};
            var syntax = function (name) {
                var value = syntaxData(theme, name);
                if (/^(?:[\da-f]{6}|[\da-f]{8})$/i.test(value)) value = '#' + value;
                return isSafeCssValue(value) ? value : '';
            };
            [['--tcf-json-bg', isSafeCssValue(editor.background) ? editor.background : colors.editorBg],
                ['--tcf-json-text', isSafeCssValue(editor.foreground) ? editor.foreground : colors.textPrimary],
                ['--tcf-json-key', syntax('variable') || syntax('type') || syntax('function')],
                ['--tcf-json-string', syntax('string')],
                ['--tcf-json-number', syntax('number')],
                ['--tcf-json-literal', syntax('keyword')],
                ['--tcf-json-punct', syntax('bracket') || syntax('operator')]].forEach(function (pair) {
                if (pair[1] && isSafeCssValue(pair[1])) jsonEditor.style.setProperty(pair[0], pair[1]);
                else jsonEditor.style.removeProperty(pair[0]);
            });
        }
        /* The controller calls setJsonText() for explicit synchronization.
         * Never overwrite an edited textarea during a regular render. */
    };

    CustomizerView.prototype._buildPreview = function () {
        if (!this._previewHost || typeof this._previewHost.attachShadow !== 'function') return;
        this._previewRoot = this._previewHost.attachShadow({ mode: 'open' });
        var style = document.createElement('style');
        style.textContent = previewStyles();
        this._previewRoot.appendChild(style);
        /* <use href="#i-…"> resolves inside the shadow tree, so it gets its
         * own copy of the icons it draws. */
        var sprite = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        sprite.setAttribute('aria-hidden', 'true');
        sprite.style.display = 'none';
        PREVIEW_ICONS.forEach(function (id) {
            var symbol = document.getElementById(id);
            if (symbol) sprite.appendChild(symbol.cloneNode(true));
        });
        this._previewRoot.appendChild(sprite);
        this._previewStage = document.createElement('div');
        this._previewStage.className = 'tcf-stage';
        this._previewStage.innerHTML = previewMarkup();
        this._previewApp = this._previewStage.firstElementChild;
        this._previewRoot.appendChild(this._previewStage);
        var self = this;
        this._bound.previewResize = function () { self._fitPreview(); };
        if (typeof ResizeObserver === 'function') {
            this._previewObserver = new ResizeObserver(this._bound.previewResize);
            this._previewObserver.observe(this._previewHost);
        }
        this._bound.previewClick = function (event) {
            var target = event.target && event.target.closest ? event.target.closest('[data-preview-token]') : null;
            if (!target || !self._previewApp || !self._previewApp.contains(target)) return;
            event.preventDefault();
            event.stopPropagation();
            self._selectPreviewToken(target.getAttribute('data-preview-token'), target);
        };
        this._bound.previewKeydown = function (event) {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            var target = event.target && event.target.closest ? event.target.closest('[data-preview-token]') : null;
            if (!target || !self._previewApp || !self._previewApp.contains(target)) return;
            event.preventDefault();
            event.stopPropagation();
            self._selectPreviewToken(target.getAttribute('data-preview-token'), target);
        };
        this._previewRoot.addEventListener('click', this._bound.previewClick);
        this._previewRoot.addEventListener('keydown', this._bound.previewKeydown);
    };

    /* Lay the copy out at desktop width and scale it to the host.  When the
     * host is short and wide, the height wins and the copy gets wider. */
    CustomizerView.prototype._fitPreview = function () {
        if (!this._previewHost || !this._previewStage) return;
        var width = this._previewHost.clientWidth;
        var height = this._previewHost.clientHeight;
        if (!width || !height) return;
        var scale = width / PREVIEW_WIDTH;
        if (height / scale < PREVIEW_MIN_HEIGHT) scale = height / PREVIEW_MIN_HEIGHT;
        this._previewStage.style.width = (width / scale) + 'px';
        this._previewStage.style.height = (height / scale) + 'px';
        this._previewStage.style.transform = 'scale(' + scale + ')';
    };

    CustomizerView.prototype._selectPreviewToken = function (key, target) {
        if (!key || !this.element) return;
        this._invoke('selectPanel', this._controllerPanel('colors'));
        this._setPanelImmediately('colors');
        var search = this.element.querySelector('[data-tcf-search]');
        if (search) {
            search.value = '';
            this._searchQuery = '';
        }
        this._renderColors();
        var rows = this.element.querySelectorAll('[data-tcf-token-row]');
        Array.prototype.forEach.call(rows, function (row) {
            row.classList.toggle('tcf-preview-row-selected', row.getAttribute('data-key') === key);
        });
        var fields = this.element.querySelectorAll('[data-tcf-token-input]');
        var field = null;
        Array.prototype.some.call(fields, function (node) {
            if (node.getAttribute('data-key') === key) {
                field = node;
                return true;
            }
            return false;
        });
        if (field) {
            field.focus();
            if (typeof field.select === 'function') field.select();
            try { field.scrollIntoView({ block: 'nearest' }); } catch (_) { }
        }
        if (this._previewApp) {
            var surfaces = this._previewApp.querySelectorAll('[data-preview-token]');
            Array.prototype.forEach.call(surfaces, function (surface) {
                surface.classList.toggle('tcf-preview-selected', surface === target);
            });
        }
    };

    CustomizerView.prototype._releasePreviewVideo = function () {
        if (!this._previewVideo) return;
        try { this._previewVideo.pause(); } catch (_) { }
        this._previewVideo.removeAttribute('src');
        try { this._previewVideo.load(); } catch (_) { }
        if (this._previewVideo.parentNode) this._previewVideo.parentNode.removeChild(this._previewVideo);
        this._previewVideoParent = null;
        this._previewVideoUrl = '';
        this._previewVideoKey = '';
    };

    CustomizerView.prototype._syncPreviewVideo = function (theme) {
        if (!this._previewApp || !theme) return;
        var colors = themeColors(theme);
        var appParent = this._previewApp.querySelector('.tcf-app-background');
        var editorParent = this._previewApp.querySelector('.editor-bg-layer');
        var candidates = [
            { key: 'appBackground', cssVar: '--app-bg-image', parent: appParent, url: previewAssetUrl(colors.appBackground) },
            { key: 'editorBackground', cssVar: '--editor-bg-image', parent: editorParent, url: previewAssetUrl(colors.editorBackground) }
        ];
        var selected = candidates.find(function (candidate) {
            return candidate.parent && isVideoAsset(candidate.url);
        });
        candidates.forEach(function (candidate) {
            if (candidate.parent) candidate.parent.classList.toggle('has-video', !!selected && selected.parent === candidate.parent);
        });
        if (!selected) {
            this._releasePreviewVideo();
            return;
        }
        if (!this._previewVideo) {
            this._previewVideo = document.createElement('video');
            this._previewVideo.className = 'tcf-preview-video';
            this._previewVideo.muted = true;
            this._previewVideo.defaultMuted = true;
            this._previewVideo.loop = true;
            this._previewVideo.autoplay = false;
            this._previewVideo.controls = false;
            this._previewVideo.preload = 'metadata';
            this._previewVideo.playsInline = true;
            this._previewVideo.setAttribute('playsinline', '');
            this._previewVideo.setAttribute('aria-hidden', 'true');
        }
        if (this._previewVideoParent !== selected.parent) {
            selected.parent.appendChild(this._previewVideo);
            this._previewVideoParent = selected.parent;
        }
        this._previewApp.style.setProperty(selected.cssVar, 'none');
        if (this._previewVideoKey !== selected.key || this._previewVideoUrl !== selected.url) {
            try { this._previewVideo.pause(); } catch (_) { }
            this._previewVideo.src = selected.url;
            this._previewVideoUrl = selected.url;
            this._previewVideoKey = selected.key;
            try { this._previewVideo.load(); } catch (_) { }
        }
    };

    CustomizerView.prototype.renderPreview = function (theme) {
        if (!this._previewApp || !theme) return this._previewHost;
        var colors = themeColors(theme);
        var tokens = typeof window !== 'undefined' ? window.ThemeTokens : null;
        if (tokens && typeof tokens.applyToElement === 'function') {
            tokens.applyToElement(this._previewApp, colors, { clearFirst: true });
            if (typeof tokens.applySyntax === 'function') tokens.applySyntax(this._previewApp, theme.editor && theme.editor.syntax || {});
        } else {
            Object.keys(colors).forEach(function (key) {
                var def = definitions()[key];
                if (def && def.cssVar) this._previewApp.style.setProperty(def.cssVar, colors[key]);
            }.bind(this));
        }
        var variant = asString(theme.meta && theme.meta.type || theme.type, 'dark').toLowerCase() === 'light' ? 'light' : 'dark';
        this._previewApp.setAttribute('data-theme-variant', variant);
        this._previewApp.setAttribute('aria-label', asString(theme.meta && theme.meta.name || theme.name, 'Theme') + ' live preview');
        var style = this._previewApp.style;
        var editor = theme.editor || {};
        [['--tcf-editor-fg', editor.foreground], ['--tcf-line-highlight', editor.lineHighlight],
            ['--tcf-line-number', editor.lineNumber], ['--tcf-line-number-active', editor.lineNumberActive]].forEach(function (pair) {
            if (isSafeCssValue(pair[1])) style.setProperty(pair[0], pair[1]);
            else style.removeProperty(pair[0]);
        });
        /* Same layers as applyBackgroundSettings(): the page colour, the
         * image or video, then a tint over the app.  Without a background
         * the page shows the theme's fallback gradient and no tint. */
        var hasBackground = !!previewAssetUrl(colors.appBackground);
        var percent = Number(colors.bgOpacity);
        if (!Number.isFinite(percent)) {
            var settings = typeof App !== 'undefined' && App.settings && App.settings.appearance;
            percent = settings && Number.isFinite(Number(settings.bgOpacity)) ? Number(settings.bgOpacity) : 50;
        } else if (percent < 1) {
            percent *= 100;
        }
        var opacity = Math.min(Math.max(percent, 0), 100) / 100;
        var overlayBase = /^s*d{1,3}s*,s*d{1,3}s*,s*d{1,3}s*$/.test(asString(colors.appOverlay, '')) ? colors.appOverlay : (variant === 'light' ? '255, 255, 255' : '26, 37, 48');
        var overlayAlpha = variant === 'light' ? opacity * 0.15 : 0.3 + opacity * 0.5;
        var gradientTop = isSafeCssValue(colors.editorBg) ? colors.editorBg : isSafeCssValue(colors.bgOceanMedium) ? colors.bgOceanMedium : '#1a2530';
        var gradientBottom = isSafeCssValue(colors.bgOceanDark) ? colors.bgOceanDark : isSafeCssValue(colors.bgOceanMedium) ? colors.bgOceanMedium : '#152535';
        style.setProperty('--tcf-app-base', hasBackground ? (variant === 'light' ? 'var(--bg-ocean-light)' : '#1a2530') : 'linear-gradient(135deg, ' + gradientTop + ' 0%, ' + gradientBottom + ' 100%)');
        style.setProperty('--tcf-app-overlay', hasBackground ? 'rgba(' + overlayBase + ', ' + overlayAlpha + ')' : 'transparent');
        this._syncPreviewVideo(theme);
        this._fitPreview();
        return this._previewHost;
    };

    CustomizerView.prototype.render = function (theme, options) {
        if (!this.element) return this;
        var state = this._state();
        this._theme = theme || state.theme || {};
        this._options = Object.assign({}, state, options || {});
        this._options.panel = normalizePanel(this._options.panel);
        var name = asString(this._theme.meta && this._theme.meta.name || this._theme.name, 'Untitled theme');
        var type = asString(this._theme.meta && this._theme.meta.type || this._theme.type, 'dark');
        var nameInput = this.element.querySelector('[data-tcf-name]');
        var typeInput = this.element.querySelector('[data-tcf-type]');
        var active = this.element.ownerDocument && this.element.ownerDocument.activeElement;
        if (nameInput && (nameInput !== active || this._options.force)) nameInput.value = name;
        if (typeInput && (typeInput !== active || this._options.force)) typeInput.value = type === 'light' ? 'light' : 'dark';
        this._renderPanelState(this._options.panel);
        this._renderTokenPanels();
        this._renderFooter();
        this.element.setAttribute('aria-busy', this._options.busy ? 'true' : 'false');
        return this;
    };

    CustomizerView.prototype._renderFooter = function () {
        var options = this._options;
        var canUndo = options.canUndo !== undefined ? options.canUndo : Number(this.controller.historyIndex) > 0;
        var canRedo = options.canRedo !== undefined ? options.canRedo : Number(this.controller.historyIndex) >= 0 && Number(this.controller.historyIndex) < ((this.controller.historyStack && this.controller.historyStack.length || 0) - 1);
        var undo = this.element.querySelector('[data-tcf-action="undo"]');
        var redo = this.element.querySelector('[data-tcf-action="redo"]');
        var reset = this.element.querySelector('[data-tcf-action="reset"]');
        var save = this.element.querySelector('[data-tcf-action="save"]');
        var saveAs = this.element.querySelector('[data-tcf-action="save-as"]');
        var saveBackground = this.element.querySelector('[data-tcf-action="save-background"]');
        var deleteButton = this.element.querySelector('[data-tcf-action="delete"]');
        if (undo) undo.disabled = !!options.busy || !canUndo;
        if (redo) redo.disabled = !!options.busy || !canRedo;
        if (reset) reset.disabled = !!options.busy;
        if (save) save.hidden = !!options.isBuiltin;
        if (saveAs) {
            saveAs.disabled = !!options.busy;
            /* A builtin cannot be overwritten, so Save as new is its main action. */
            saveAs.className = options.isBuiltin ? 'btn-save' : 'btn-reset tcf-secondary';
        }
        if (saveBackground) saveBackground.hidden = !options.isBuiltin;
        if (deleteButton) deleteButton.hidden = !!options.isBuiltin;
        var dirty = this.element.querySelector('[data-tcf-dirty]');
        if (dirty) {
            dirty.textContent = options.dirty ? '● Unsaved changes' : 'Saved';
            dirty.dataset.state = options.dirty ? 'dirty' : 'saved';
        }
        var status = this.element.querySelector('[data-tcf-status]');
        if (status && !options.busy) {
            status.textContent = this._statusMessage || (options.dirty ? 'Draft changes previewed' : 'Ready');
            status.dataset.tone = this._statusMessage ? this._statusTone : '';
            status.dataset.type = this._statusMessage ? this._statusTone : '';
        } else if (status && options.busy) {
            status.textContent = 'Saving…';
        }
        Array.prototype.forEach.call(this.element.querySelectorAll('button,input,select,textarea'), function (node) {
            if (node.getAttribute('data-tcf-action') === 'close') return;
            node.disabled = !!options.busy;
        });
        if (undo) undo.disabled = !!options.busy || !canUndo;
        if (redo) redo.disabled = !!options.busy || !canRedo;
        if (reset) reset.disabled = !!options.busy;
        if (saveAs) saveAs.disabled = !!options.busy;
    };

    CustomizerView.prototype.getJsonText = function () {
        return findValue(this.element, '[data-tcf-json]');
    };

    CustomizerView.prototype.setJsonText = function (text) {
        var json = this.element && this.element.querySelector('[data-tcf-json]');
        if (json) {
            json.value = asString(text, '');
            this._jsonDirty = false;
            this._highlightJson();
        }
    };

    CustomizerView.prototype._highlightJson = function () {
        var json = this.element && this.element.querySelector('[data-tcf-json]');
        var layer = json && json.previousElementSibling;
        if (!layer || !layer.classList.contains('tcf-json-highlight')) return;
        layer.innerHTML = highlightJson(json.value);
        layer.scrollTop = json.scrollTop;
        layer.scrollLeft = json.scrollLeft;
    };

    CustomizerView.prototype.focus = function () {
        var input = this.element && this.element.querySelector('[data-tcf-name]');
        if (input && typeof input.focus === 'function') input.focus();
    };

    CustomizerView.prototype.notify = function (state, type) {
        if (this._destroyed) return this;
        if (typeof state === 'string') {
            this._setStatus(state, type || 'info');
            return this;
        }
        var payload = state || {};
        var theme = payload.workingTheme || payload.theme || this.controller.workingTheme || this._theme;
        this.render(theme, Object.assign({}, this._options, payload));
        return this;
    };

    CustomizerView.prototype.destroy = function () {
        this._destroyed = true;
        if (typeof this._unsubscribe === 'function') {
            try { this._unsubscribe(); } catch (_) { }
        }
        if (this.element && this._bound) {
            this.element.removeEventListener('click', this._bound.click);
            this.element.removeEventListener('input', this._bound.input);
            this.element.removeEventListener('change', this._bound.change);
            this.element.removeEventListener('focusout', this._bound.focusout);
            this.element.removeEventListener('keydown', this._bound.keydown);
        }
        if (this._previewRoot && this._bound) {
            this._previewRoot.removeEventListener('click', this._bound.previewClick);
            this._previewRoot.removeEventListener('keydown', this._bound.previewKeydown);
        }
        if (this._previewObserver) this._previewObserver.disconnect();
        this._previewObserver = null;
        this._releasePreviewVideo();
        if (this.element && this.element.parentNode) this.element.parentNode.removeChild(this.element);
        this._previewRoot = null;
        this._previewApp = null;
        this._previewHost = null;
        this._previewVideo = null;
    };

    var ThemeCustomizerView = {
        create: function (controller) {
            var view = new CustomizerView(controller);
            return {
                element: view.element,
                render: view.render.bind(view),
                renderPreview: view.renderPreview.bind(view),
                getJsonText: view.getJsonText.bind(view),
                setJsonText: view.setJsonText.bind(view),
                focus: view.focus.bind(view),
                notify: view.notify.bind(view),
                destroy: view.destroy.bind(view)
            };
        }
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = ThemeCustomizerView;
    else window.ThemeCustomizerView = ThemeCustomizerView;
})();
