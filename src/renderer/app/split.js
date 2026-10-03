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
        document.getElementById('editor-container-2').addEventListener('mousedown', () => {
            if (App.activeEditor === 2) return;
            App.activeEditor = 2;
            renderTabs();
        });
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


    // Use transitionend to trigger layout exactly when animation finishes
    const onTransitionEnd = (e) => {
        if (e.propertyName === 'width' || e.propertyName === 'flex-grow') {
            if (App.editor) App.editor.layout();
            if (App.editor2) App.editor2.layout();
            pane2.removeEventListener('transitionend', onTransitionEnd);
        }
    };
    pane2.addEventListener('transitionend', onTransitionEnd);

    // Fallback in case transition doesn't fire (e.g. hidden)
    setTimeout(() => {
        if (App.editor) App.editor.layout();
        if (App.editor2) App.editor2.layout();
        pane2.removeEventListener('transitionend', onTransitionEnd);
    }, 350); // Slightly longer than CSS transition time
}

function closeSplit() {
    if (!App.isSplit) return;


    if (App.splitTabId && App.editor2) {
        const tab = App.tabs.find(t => t.id === App.splitTabId);
        if (tab) tab.content = App.editor2.getValue();
    }

    App.isSplit = false;
    App.splitTabId = null;
    App.activeEditor = 1;
    showEmptyModel(App.editor2);
    document.body.classList.remove('split-active');

    document.getElementById('editor-pane-2').style.display = 'none';
    document.getElementById('resizer-split').style.display = 'none';


    const minimapEnabled = App.settings?.editor?.minimap !== false;
    if (App.editor) App.editor.updateOptions({ minimap: { enabled: minimapEnabled } });


    const resizer = document.getElementById('resizer-split');
    const onTransitionEnd = (e) => {
        if (App.editor) App.editor.layout();
        resizer.removeEventListener('transitionend', onTransitionEnd);
    };
    resizer.addEventListener('transitionend', onTransitionEnd);

    // Fallback
    setTimeout(() => {
        if (App.editor) App.editor.layout();
        resizer.removeEventListener('transitionend', onTransitionEnd);
    }, 350);

    // Reset pane 1 to full width
    const pane1 = document.getElementById('editor-pane-1');
    if (pane1) {
        pane1.style.flex = '1';
        pane1.style.width = '';
        pane1.style.maxWidth = '';
    }
}

// Swap files between left and right editors
function swapSplitEditors() {
    if (!App.isSplit || !App.editor2) return;


    const leftTab = App.tabs.find(t => t.id === App.activeTabId);
    const rightTab = App.tabs.find(t => t.id === App.splitTabId);

    if (leftTab) leftTab.content = App.editor.getValue();
    if (rightTab) rightTab.content = App.editor2.getValue();


    const tempId = App.activeTabId;
    App.activeTabId = App.splitTabId;
    App.splitTabId = tempId;


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

    container.addEventListener('dragstart', e => {
        const tab = e.target.closest('.tab');
        if (tab) {
            draggedTabId = tab.dataset.id;
            draggedTabEl = tab;
            e.dataTransfer.effectAllowed = 'move';
            tab.classList.add('dragging');

            // Set custom type to prevent drop into editor
            e.dataTransfer.setData('application/x-sameko-tab', tab.dataset.id);

            e.dataTransfer.setDragImage(tab, tab.offsetWidth / 2, tab.offsetHeight / 2);
        }
    });

    // Cache for drag operations to prevent layout thrashing
    let cachedTabs = [];

    container.addEventListener('dragstart', e => {
        const tab = e.target.closest('.tab');
        if (tab) {
            draggedTabId = tab.dataset.id;
            draggedTabEl = tab;
            e.dataTransfer.effectAllowed = 'move';
            tab.classList.add('dragging');
            e.dataTransfer.setDragImage(tab, tab.offsetWidth / 2, tab.offsetHeight / 2);

            // Cache positions once at start
            cachedTabs = [...container.querySelectorAll('.tab:not(.dragging)')].map(child => ({
                element: child,
                rect: child.getBoundingClientRect(),
                offset: 0
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
                App.splitTabId = draggedTabId;
                if (App.editor2) showTabInEditor(App.editor2, tab);
            }
        });
    });
}


function setupSplitResizer() {
    const resizer = document.getElementById('resizer-split');
    const pane1 = document.getElementById('editor-pane-1');
    const pane2 = document.getElementById('editor-pane-2');
    let dragging = false;
    let startX, startW1, startW2;

    resizer.onmousedown = e => {
        dragging = true;
        startX = e.clientX;
        startW1 = pane1.offsetWidth;
        startW2 = pane2.offsetWidth;
        resizer.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        e.preventDefault();
    };

    let rafId = null;
    document.addEventListener('mousemove', e => {
        if (!dragging) return;

        if (rafId) return;
        rafId = requestAnimationFrame(() => {
            const dx = e.clientX - startX;
            const totalWidth = startW1 + startW2;

            // Calc new width for pane1, clamping min 200px
            let newW1 = startW1 + dx;

            // Constraint: pane1 min 200px
            if (newW1 < 200) newW1 = 200;
            // Constraint: pane2 min 200px (meaning pane1 max = total - 200)
            if (newW1 > totalWidth - 200) newW1 = totalWidth - 200;

            // Convert to percentage
            const p1 = (newW1 / totalWidth) * 100;
            const p2 = 100 - p1;

            pane1.style.flex = 'none';
            pane2.style.flex = 'none';
            pane1.style.width = `${p1}%`;
            pane2.style.width = `${p2}%`;

            // Layout immediately during resize for responsiveness
            if (App.editor) App.editor.layout();
            if (App.editor2) App.editor2.layout();

            rafId = null;
        });
    });

    document.addEventListener('mouseup', () => {
        if (dragging) {
            dragging = false;
            resizer.classList.remove('dragging');
            document.body.style.cursor = '';
        }
    });
}
