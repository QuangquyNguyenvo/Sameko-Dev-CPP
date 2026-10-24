/**
 * Sameko Dev C++ IDE - renderer: Split editor, tab drag-and-drop, split resizer.
 *
 * One of the files that used to be the single renderer/app.js. They are plain
 * <script> files sharing one global scope and are loaded by index.html in a
 * fixed order (see CODEBASE.md); nothing here may run at load time that needs
 * a function from a later file.
 */

// ============================================================================
// SPLIT EDITOR
// ============================================================================
let cancelSplitResize = null;

function toggleSplit() {
    if (App.isSplit) {
        closeSplit();
    } else {
        openSplit();
    }
}

function openSplit() {
    if (App.isSplit || App.tabs.length < 1) return;

    App.isSplit = true;
    document.body.classList.add('split-active');


    const pane2 = document.getElementById('editor-pane-2');
    const resizer = document.getElementById('resizer-split');

    pane2.style.display = 'flex';
    resizer.style.display = 'block';


    if (!App.editor2) {
        App.editor2 = createEditor('editor-container-2');
        document.getElementById('editor-container-2').addEventListener('mousedown', () => focusEditorPane(2));
        // Breakpoints and the paused-line arrow work in this pane too.
        if (window.Debugger && typeof window.Debugger.attachEditor === 'function') {
            try { window.Debugger.attachEditor(App.editor2); } catch (_) { }
        }
    }


    if (App.editor) App.editor.updateOptions({ minimap: { enabled: false } });
    if (App.editor2) App.editor2.updateOptions({ minimap: { enabled: false } });


    if (App.tabs.length > 1) {

        const otherTab = App.tabs.find(t => t.id !== App.activeTabId);
        if (otherTab) {
            App.splitTabId = otherTab.id;
            showTabInEditor(App.editor2, otherTab);
        }
    } else {

        App.splitTabId = App.activeTabId;
        const tab = App.tabs.find(t => t.id === App.activeTabId);
        if (tab) showTabInEditor(App.editor2, tab);
    }


    refreshEditorLayout();
}

/**
 * Give keyboard focus to editor pane 1 or 2. The Input/Expected boxes and the
 * test cases describe the focused tab, so they are saved for the tab losing
 * focus and loaded for the one gaining it.
 */
function focusEditorPane(pane) {
    const target = pane === 2 && App.isSplit && App.splitTabId ? 2 : 1;
    if (App.activeEditor === target) return;
    const beforeId = getPreferredTabId();
    const beforeTab = App.tabs.find(t => t.id === beforeId) || null;
    if (beforeTab) {
        persistCurrentTabIO();
        saveTestStateToTab(beforeTab);
    }
    App.activeEditor = target;
    const afterId = getPreferredTabId();
    if (afterId !== beforeId) {
        restoreTabIO(afterId);
        loadTestStateFromTab(App.tabs.find(t => t.id === afterId) || null);
    }
    renderTabs();
}

/** Show a tab in the right pane, moving the panels with it when that pane has focus. */
function showInSplitPane(tab) {
    const focused = App.activeEditor === 2;
    const beforeTab = focused ? App.tabs.find(t => t.id === App.splitTabId) || null : null;
    const changing = !focused || !beforeTab || beforeTab.id !== tab.id;
    if (focused && beforeTab && changing) {
        persistCurrentTabIO();
        saveTestStateToTab(beforeTab);
    }
    App.splitTabId = tab.id;
    if (App.editor2) showTabInEditor(App.editor2, tab);
    if (focused && changing) {
        restoreTabIO(tab.id);
        loadTestStateFromTab(tab);
    }
    renderTabs();
}

function closeSplit() {
    if (!App.isSplit) return;
    if (cancelSplitResize) cancelSplitResize();


    if (App.splitTabId && App.editor2) {
        const tab = App.tabs.find(t => t.id === App.splitTabId);
        if (tab) tab.content = App.editor2.getValue();
    }

    // Hand the panels back to the left tab before the right pane goes away.
    focusEditorPane(1);
    App.isSplit = false;
    App.splitTabId = null;
    App.activeEditor = 1;
    showEmptyModel(App.editor2);
    document.body.classList.remove('split-active');

    document.getElementById('editor-pane-2').style.display = 'none';
    document.getElementById('resizer-split').style.display = 'none';


    const minimapEnabled = App.settings?.editor?.minimap !== false
        && !App.settings?.appearance?.performanceMode;
    if (App.editor) App.editor.updateOptions({ minimap: { enabled: minimapEnabled } });


    // Clear both panes so reopening starts with a balanced split.
    for (const paneId of ['editor-pane-1', 'editor-pane-2']) {
        const pane = document.getElementById(paneId);
        if (!pane) continue;
        pane.style.flex = '1';
        pane.style.width = '';
        pane.style.maxWidth = '';
    }
    refreshEditorLayout();
}

// Swap files between left and right editors
function swapSplitEditors() {
    if (!App.isSplit || !App.editor2) return;


    const leftTab = App.tabs.find(t => t.id === App.activeTabId);
    const rightTab = App.tabs.find(t => t.id === App.splitTabId);

    if (leftTab) leftTab.content = App.editor.getValue();
    if (rightTab) rightTab.content = App.editor2.getValue();


    // The focused pane now shows the other file: its Input/Expected and tests go with it.
    const focusedBefore = App.tabs.find(t => t.id === getPreferredTabId()) || null;
    if (focusedBefore) { persistCurrentTabIO(); saveTestStateToTab(focusedBefore); }

    const tempId = App.activeTabId;
    App.activeTabId = App.splitTabId;
    App.splitTabId = tempId;

    const focusedAfter = App.tabs.find(t => t.id === getPreferredTabId()) || null;
    if (focusedAfter && focusedAfter !== focusedBefore) {
        restoreTabIO(focusedAfter.id);
        loadTestStateFromTab(focusedAfter);
    }


    // Swap the documents themselves, so each keeps its own undo history.
    clearEditorDecorationsBeforeSwitch();
    const leftModel = App.editor.getModel();
    const rightModel = App.editor2.getModel();
    App.editor.setModel(rightModel);
    App.editor2.setModel(leftModel);
    if (window.Debugger) { try { window.Debugger.onFileShown(); } catch (_) { } }


    renderTabs();
}

function initTabDrag() {

    const container = document.getElementById('tabs-container');
    const editorPane1 = document.getElementById('editor-pane-1');
    const editorPane2 = document.getElementById('editor-pane-2');

    let draggedTabId = null;
    let draggedTabEl = null;
    let dropIndicator = null;


    function createDropIndicator() {
        if (!dropIndicator) {
            dropIndicator = document.createElement('div');
            dropIndicator.className = 'tab-drop-indicator';
        }
        return dropIndicator;
    }

    // Tab positions measured once per drag, so dragover does not force layout.
    let cachedTabs = [];

    container.addEventListener('dragstart', e => {
        const tab = e.target.closest('.tab');
        if (tab) {
            draggedTabId = tab.dataset.id;
            draggedTabEl = tab;
            e.dataTransfer.effectAllowed = 'move';
            tab.classList.add('dragging');

            // Custom type so the editor does not accept the drop as text.
            e.dataTransfer.setData('application/x-sameko-tab', tab.dataset.id);
            e.dataTransfer.setDragImage(tab, tab.offsetWidth / 2, tab.offsetHeight / 2);

            cachedTabs = [...container.querySelectorAll('.tab:not(.dragging)')].map(child => ({
                element: child,
                rect: child.getBoundingClientRect()
            }));
        }
    });

    container.addEventListener('dragend', e => {
        const tab = e.target.closest('.tab');
        if (tab) tab.classList.remove('dragging');
        draggedTabId = null;
        draggedTabEl = null;

        if (dropIndicator && dropIndicator.parentNode) {
            dropIndicator.parentNode.removeChild(dropIndicator);
        }

        cachedTabs = []; // Clear cache
        container.querySelectorAll('.tab').forEach(t => t.classList.remove('drag-over-left', 'drag-over-right'));
    });


    let dragOverRafId = null;
    container.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        if (!draggedTabEl) return;

        if (dragOverRafId) return;

        dragOverRafId = requestAnimationFrame(() => {
            const afterElement = getDragAfterElement(container, e.clientX);
            const indicator = createDropIndicator();

            container.querySelectorAll('.tab').forEach(t => t.classList.remove('drag-over-left', 'drag-over-right'));

            if (afterElement) {
                afterElement.classList.add('drag-over-left');
            } else {
                const lastTab = container.querySelector('.tab:last-of-type');
                if (lastTab && lastTab !== draggedTabEl) {
                    lastTab.classList.add('drag-over-right');
                }
            }
            dragOverRafId = null;
        });
    });

    container.addEventListener('dragleave', e => {

        if (e.target === container) {
            container.querySelectorAll('.tab').forEach(t => t.classList.remove('drag-over-left', 'drag-over-right'));
        }
    });

    container.addEventListener('drop', e => {
        e.preventDefault();

        if (!draggedTabId) return;


        const droppedOnTab = e.target.closest('.tab');
        const droppedOnContainer = e.target.closest('.tabs-container');

        if (droppedOnContainer || droppedOnTab) {

            const draggedIndex = App.tabs.findIndex(t => t.id === draggedTabId);
            if (draggedIndex === -1) return;

            const afterElement = getDragAfterElement(container, e.clientX);
            let targetIndex;

            if (afterElement) {
                const afterId = afterElement.dataset.id;
                targetIndex = App.tabs.findIndex(t => t.id === afterId);
            } else {
                targetIndex = App.tabs.length;
            }


            if (draggedIndex !== targetIndex && draggedIndex !== targetIndex - 1) {
                const [draggedTab] = App.tabs.splice(draggedIndex, 1);

                if (draggedIndex < targetIndex) {
                    targetIndex--;
                }
                App.tabs.splice(targetIndex, 0, draggedTab);
                renderTabs();
            }
        }


        container.querySelectorAll('.tab').forEach(t => t.classList.remove('drag-over-left', 'drag-over-right'));
    });


    function getDragAfterElement(container, x) {
        // Use cached tabs if available, otherwise query (fallback)
        const elementsInfo = cachedTabs.length > 0 ? cachedTabs :
            [...container.querySelectorAll('.tab:not(.dragging)')].map(child => ({
                element: child,
                rect: child.getBoundingClientRect()
            }));

        return elementsInfo.reduce((closest, childInfo) => {
            const box = childInfo.rect;
            const offset = x - box.left - box.width / 2;

            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: childInfo.element };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }


    [editorPane1, editorPane2].forEach((pane, idx) => {
        pane.addEventListener('dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            pane.classList.add('drop-target');
        });

        pane.addEventListener('dragleave', () => {
            pane.classList.remove('drop-target');
        });

        pane.addEventListener('drop', e => {
            e.preventDefault();
            pane.classList.remove('drop-target');

            if (!draggedTabId) return;


            if (e.target.closest('.tabs-container')) return;

            const tab = App.tabs.find(t => t.id === draggedTabId);
            if (!tab) return;

            if (idx === 0) {

                setActive(draggedTabId);
            } else {

                if (!App.isSplit) openSplit();
                showInSplitPane(tab);
            }
        });
    });
}


function setupSplitResizer() {
    const resizer = document.getElementById('resizer-split');
    const pane1 = document.getElementById('editor-pane-1');
    const pane2 = document.getElementById('editor-pane-2');
    let dragging = false;
    let startX, startW1, startW2, latestX, lastWidth;
    let rafId = null;

    const resize = () => {
        rafId = null;
        if (!dragging || !App.isSplit) return;
        const totalWidth = startW1 + startW2;
        if (totalWidth <= 0) return;
        const minWidth = Math.min(200, totalWidth / 2);
        const newW1 = Math.max(minWidth, Math.min(totalWidth - minWidth, startW1 + latestX - startX));
        if (newW1 === lastWidth) return;
        lastWidth = newW1;

        // Flex weights divide the space left after the divider, without overflow.
        pane1.style.flex = `${newW1} 1 0px`;
        pane2.style.flex = `${totalWidth - newW1} 1 0px`;
        if (App.editor) App.editor.layout();
        if (App.editor2) App.editor2.layout();
    };

    cancelSplitResize = () => {
        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = null;
        if (!dragging) return;
        dragging = false;
        resizer.classList.remove('dragging');
        document.body.style.cursor = '';
    };

    resizer.onmousedown = e => {
        if (e.button !== 0 || !App.isSplit) return;
        cancelSplitResize();
        dragging = true;
        startX = latestX = e.clientX;
        startW1 = pane1.getBoundingClientRect().width;
        startW2 = pane2.getBoundingClientRect().width;
        lastWidth = startW1;
        resizer.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        e.preventDefault();
    };

    document.addEventListener('mousemove', e => {
        if (!dragging) return;
        latestX = e.clientX;
        if (rafId === null) rafId = requestAnimationFrame(resize);
    });

    document.addEventListener('mouseup', e => {
        if (!dragging) return;
        latestX = e.clientX;
        if (rafId !== null) cancelAnimationFrame(rafId);
        resize();
        cancelSplitResize();
    });
    window.addEventListener('blur', cancelSplitResize);
}
