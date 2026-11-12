/*
 * Functions run in an OJ page's MAIN world through chrome.scripting.executeScript({ world: 'MAIN',
 * func }). The worker importScripts() this file and passes the function itself, which Chrome
 * serialises — so every function here must be self-contained (no outer variables, no helpers).
 */
(function (root) {
    'use strict';

    /**
     * Put `text` into the code editor at or around `selector`: Ace, CodeMirror 5, CodeMirror 6,
     * Monaco, or a plain <textarea>. → { ok: true, editor } | { ok: false, reason }.
     */
    function setEditorText(selector, text) {
        let el = null;
        try { el = selector ? document.querySelector(selector) : null; } catch (_) { el = null; }
        if (!el) return { ok: false, reason: 'not-found' };
        const near = (cls) => (el.classList && el.classList.contains(cls) ? el : el.querySelector('.' + cls) || el.closest('.' + cls));

        // Ace: the editor element carries env.editor once ace.edit() has run.
        const aceEl = near('ace_editor');
        if (aceEl) {
            let ed = aceEl.env && aceEl.env.editor;
            if (!ed && window.ace && window.ace.edit) { try { ed = window.ace.edit(aceEl); } catch (_) { ed = null; } }
            if (ed && ed.setValue) { ed.setValue(text, -1); return { ok: true, editor: 'ace' }; }
        }

        // CodeMirror 5: the wrapper element has a .CodeMirror property.
        const cm5 = near('CodeMirror');
        if (cm5 && cm5.CodeMirror && cm5.CodeMirror.setValue) {
            cm5.CodeMirror.setValue(text);
            if (cm5.CodeMirror.save) { try { cm5.CodeMirror.save(); } catch (_) { /* not from a textarea */ } }
            return { ok: true, editor: 'codemirror5' };
        }

        // CodeMirror 6: the view hangs off .cm-content (cmView.view) in current releases.
        const cm6 = near('cm-editor');
        if (cm6) {
            const content = cm6.querySelector('.cm-content');
            const view = (content && content.cmView && content.cmView.view) || (cm6.cmView && cm6.cmView.view);
            if (view && view.dispatch) {
                view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
                return { ok: true, editor: 'codemirror6' };
            }
        }

        // Monaco: find the editor whose DOM node is (inside) the element.
        if (window.monaco && window.monaco.editor) {
            const m = window.monaco.editor;
            const eds = m.getEditors ? m.getEditors() : [];
            const ed = eds.find(e => { const n = e.getDomNode && e.getDomNode(); return n && (el.contains(n) || n.contains(el)); }) ||
                (eds.length === 1 ? eds[0] : null);
            if (ed && ed.getModel && ed.getModel()) { ed.getModel().setValue(text); return { ok: true, editor: 'monaco' }; }
            const models = m.getModels ? m.getModels() : [];
            if (!eds.length && models.length === 1) { models[0].setValue(text); return { ok: true, editor: 'monaco' }; }
        }

        // Plain textarea / input.
        const area = el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' ? el : el.querySelector('textarea');
        if (area) {
            const proto = area.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const desc = Object.getOwnPropertyDescriptor(proto, 'value');
            if (desc && desc.set) desc.set.call(area, text); else area.value = text;
            area.dispatchEvent(new Event('input', { bubbles: true }));
            area.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true, editor: 'textarea' };
        }
        return { ok: false, reason: 'no-editor' };
    }

    const SamekoPageWorld = { setEditorText };
    root.SamekoPageWorld = SamekoPageWorld;
    if (typeof module !== 'undefined' && module.exports) module.exports = SamekoPageWorld;
})(typeof globalThis !== 'undefined' ? globalThis : this);
