/**
 * Sameko Dev C++ IDE - renderer: Panel visibility, header buttons, docking of Terminal and I/O, resizers, Discord presence.
 *
 * One of the files that used to be the single renderer/app.js. They are plain
 * <script> files sharing one global scope and are loaded by index.html in a
 * fixed order (see CODEBASE.md); nothing here may run at load time that needs
 * a function from a later file.
 */

// ============================================================================
// UI UPDATE
// ============================================================================
function updateUI() {
    const hasTabs = App.tabs.length > 0;
    document.getElementById('welcome').style.display = hasTabs ? 'none' : 'flex';
    document.getElementById('editor-section').style.display = hasTabs ? 'flex' : 'none';

    // Force hide panels if the welcome screen is open (no tabs)
    const showIO = hasTabs && App.showIO;
    const showTerm = hasTabs && App.showTerm;
    const showProblems = hasTabs && App.showProblems;

    document.getElementById('io-section').classList.toggle('panel-hidden', !showIO);
    document.getElementById('resizer-io').classList.toggle('panel-hidden', !showIO);
    document.getElementById('btn-toggle-io').classList.toggle('active', showIO);

    document.getElementById('terminal-section').classList.toggle('panel-hidden', !showTerm);
    document.getElementById('resizer-term').classList.toggle('panel-hidden', !showTerm);
    document.getElementById('btn-toggle-term').classList.toggle('active', showTerm);

    document.getElementById('problems-panel').classList.toggle('hidden', !showProblems);
    document.getElementById('resizer-problems').classList.toggle('panel-hidden', !showProblems);
    document.getElementById('btn-toggle-problems').classList.toggle('active', showProblems);
}

// ============================================================================
// HEADER
// ============================================================================
function initHeader() {
    document.getElementById('btn-new-tab').onclick = newFile;
    document.getElementById('btn-buildrun').onclick = buildRun;
    document.getElementById('btn-run-only').onclick = run;
    document.getElementById('btn-stop').onclick = stop;
    document.getElementById('btn-toggle-io').onclick = toggleIO;
    document.getElementById('btn-toggle-term').onclick = toggleTerm;
    document.getElementById('btn-toggle-problems').onclick = toggleProblems;

    document.getElementById('welcome-new').onclick = newFile;
    document.getElementById('welcome-open').onclick = openFile;

    document.getElementById('btn-close').onclick = () => window.electronAPI?.closeWindow?.();
    document.getElementById('btn-min').onclick = () => window.electronAPI?.minimizeWindow?.();
    document.getElementById('btn-max').onclick = () => window.electronAPI?.maximizeWindow?.();

    document.getElementById('tabs-container').onmousedown = e => {
        if (e.button === 1) {
            const tab = e.target.closest('.tab');
            if (tab) closeTab(tab.dataset.id);
        }
    };


    const hamburgerBtn = document.getElementById('btn-hamburger');
    const menuGroup = document.getElementById('menu-group');
    if (hamburgerBtn && menuGroup) {
        hamburgerBtn.onclick = (e) => {
            e.stopPropagation();
            hamburgerBtn.classList.toggle('active');
            menuGroup.classList.toggle('show');
        };


        document.addEventListener('click', (e) => {
            if (!menuGroup.contains(e.target) && !hamburgerBtn.contains(e.target)) {
                hamburgerBtn.classList.remove('active');
                menuGroup.classList.remove('show');
            }
        });


        menuGroup.querySelectorAll('.menu-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                hamburgerBtn.classList.remove('active');
                menuGroup.classList.remove('show');
            });
        });
    }

    setupSplitResizer();

    // The page itself never scrolls. Monaco keeps a 50000px-wide measuring element in
    // <body>, so a focus() or scrollIntoView() inside a side panel could scroll the whole
    // window sideways and leave only a sliver of the app on screen.
    window.addEventListener('scroll', () => {
        if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
    });
}

function toggleIO() {
    if (DockingState.ioDocked) {
        const problemsPanel = document.getElementById('problems-panel');
        const isIOActive = document.getElementById('docked-io-tab')?.classList.contains('active');

        if (App.showProblems && isBottomPanelCollapsed()) {
            showBottomPanel('io');
        } else if (!App.showProblems) {
            App.showProblems = true;
            if (!App.settings.panels) App.settings.panels = {};
            App.settings.panels.showProblems = true;
            saveSettings();
            updateUI();
            setBottomPanelCollapsed(false);
            switchDockedPanel('io');
        } else {
            if (isIOActive) {
                toggleProblems();
            } else {
                switchDockedPanel('io');
            }
        }
        return;
    }

    App.showIO = !App.showIO;
    if (!App.settings.panels) App.settings.panels = {};
    App.settings.panels.showIO = App.showIO;
    saveSettings();
    updateUI();

    setTimeout(() => {
        if (App.editor) App.editor.layout();
        if (App.editor2) App.editor2.layout();
    }, 50);
}
function toggleTerm() {
    if (DockingState.terminalDocked) {
        const problemsPanel = document.getElementById('problems-panel');
        const isTerminalActive = document.getElementById('docked-terminal-tab')?.classList.contains('active');

        if (App.showProblems && isBottomPanelCollapsed()) {
            showBottomPanel('terminal');
        } else if (!App.showProblems) {
            // If hidden, show and switch to terminal
            App.showProblems = true;
            if (!App.settings.panels) App.settings.panels = {};
            App.settings.panels.showProblems = true;
            saveSettings();
            updateUI();
            setBottomPanelCollapsed(false);
            switchDockedPanel('terminal');
        } else {
            // If shown...
            if (isTerminalActive) {
                // If already looking at terminal, close problems
                toggleProblems();
            } else {
                // If looking at something else, switch to terminal
                switchDockedPanel('terminal');
            }
        }
        return;
    }

    App.showTerm = !App.showTerm;
    if (!App.settings.panels) App.settings.panels = {};
    App.settings.panels.showTerm = App.showTerm;
    saveSettings();
    updateUI();

    setTimeout(() => {
        if (App.editor) App.editor.layout();
        if (App.editor2) App.editor2.layout();
    }, 50);
    if (App.showTerm) fitTerminal();
}
function toggleProblems() {
    // Ctrl+J on a collapsed panel opens it rather than hiding it.
    if (App.showProblems && isBottomPanelCollapsed()) {
        setBottomPanelCollapsed(false);
        return;
    }
    App.showProblems = !App.showProblems;
    if (App.showProblems) setBottomPanelCollapsed(false);
    if (!App.settings.panels) App.settings.panels = {};
    App.settings.panels.showProblems = App.showProblems;
    saveSettings();
    updateUI();
    // Refresh editor layout after panel visibility changes
    setTimeout(() => {
        if (App.editor) App.editor.layout();
        if (App.editor2) App.editor2.layout();
    }, 50);
}

// ============================================================================
// PANELS
// ============================================================================
function initPanels() {

    const clearInput = document.getElementById('clear-input');
    const clearOutput = document.getElementById('clear-output');

    if (clearInput) {
        clearInput.onclick = () => { document.getElementById('input-area').value = ''; };
    }
    if (clearOutput) {
        clearOutput.onclick = () => {
            document.getElementById('expected-area').value = '';
            document.getElementById('expected-area').style.display = 'block';
            document.getElementById('expected-diff').style.display = 'none';
            document.getElementById('expected-diff').innerHTML = '';
        };
    }

    document.getElementById('clear-term').onclick = clearTerm;
    document.getElementById('close-problems').onclick = () => { App.showProblems = false; updateUI(); };
    initBottomPanelCollapse();

    document.getElementById('btn-send').onclick = sendInput;

    // Input from a file (#49): the button, its clear button, or a file dropped on the Input card.
    document.getElementById('btn-input-file').onclick = () => chooseInputFile();
    document.getElementById('btn-input-file-clear').onclick = () => setInputFile(null);
    const inputCard = document.querySelector('.io-panel-input');
    if (inputCard) {
        inputCard.addEventListener('dragover', (e) => {
            if (!e.dataTransfer?.types?.includes('Files')) return;
            e.preventDefault();
            e.stopPropagation();
            inputCard.classList.add('drop-target');
        });
        inputCard.addEventListener('dragleave', (e) => {
            if (!inputCard.contains(e.relatedTarget)) inputCard.classList.remove('drop-target');
        });
        inputCard.addEventListener('drop', (e) => {
            inputCard.classList.remove('drop-target');
            const file = e.dataTransfer?.files?.[0];
            if (!file) return;
            e.preventDefault();
            e.stopPropagation();
            const filePath = window.electronAPI?.getPathForFile?.(file) || '';
            if (filePath) setInputFile(filePath);
        });
    }




    document.getElementById('expected-diff').onclick = switchToExpectedEdit;


    const setupRightClickPaste = (element) => {
        if (!element) return;
        element.addEventListener('contextmenu', async (e) => {
            e.preventDefault();
            try {
                const text = await navigator.clipboard.readText();
                const start = element.selectionStart;
                const end = element.selectionEnd;
                element.value = element.value.slice(0, start) + text + element.value.slice(end);
                element.selectionStart = element.selectionEnd = start + text.length;
            } catch (err) {
                console.log('Clipboard access denied:', err);
            }
        });
    };

    setupRightClickPaste(document.getElementById('input-area'));
    setupRightClickPaste(document.getElementById('expected-area'));
    // NOTE: #terminal-in is handled by initTerminalUX()'s document-level handler
    // (right-click anywhere in the terminal pastes). Registering it here too
    // would paste the clipboard twice.

    // IO textareas are the real elements — no sync needed even when docked
    initDockablePanels();
}

// ============================================================================
// BOTTOM PANEL COLLAPSE
// ============================================================================
// The bottom panel (Problems / Terminal / Tests) starts collapsed to its tab
// strip so the editor gets the room, and opens when it has something to show:
// a run, a failed build, a click on one of its tabs. The caret in its header,
// or a click on the tab already shown, collapses it again.
function isBottomPanelCollapsed() {
    return !!document.getElementById('problems-panel')?.classList.contains('collapsed');
}

function setBottomPanelCollapsed(collapsed) {
    const panel = document.getElementById('problems-panel');
    if (!panel || panel.classList.contains('collapsed') === collapsed) return;
    panel.classList.toggle('collapsed', collapsed);
    document.getElementById('resizer-problems')?.classList.toggle('collapsed', collapsed);
    refreshEditorLayout();
    if (!collapsed) fitTerminal();
}

/** Shows the bottom panel open on one of its views ('terminal', 'problems', 'tests', 'io'). */
function showBottomPanel(panelId) {
    if (!App.showProblems) {
        App.showProblems = true;
        updateUI();
    }
    setBottomPanelCollapsed(false);
    if (panelId) switchDockedPanel(panelId);
}

function initBottomPanelCollapse() {
    const panel = document.getElementById('problems-panel');
    const head = panel?.querySelector('.panel-head');
    if (!head) return;
    document.getElementById('resizer-problems')?.classList.toggle('collapsed', isBottomPanelCollapsed());
    document.getElementById('collapse-problems').onclick = (e) => {
        e.stopPropagation();
        setBottomPanelCollapsed(!isBottomPanelCollapsed());
    };
    // Capture phase: runs before the tab's own handler makes it active.
    head.addEventListener('click', (e) => {
        const title = e.target.closest('.panel-title');
        if (!title || e.target.closest('.dock-undock')) return;
        if (isBottomPanelCollapsed()) setBottomPanelCollapsed(false);
        else if (title.classList.contains('active')) setBottomPanelCollapsed(true);
    }, true);
}

// ============================================================================
// SIMPLE DOCKING SYSTEM - Dock Terminal and I/O into Problems panel
// ============================================================================

// Docking state
const DockingState = {
    draggedPanel: null,
    terminalDocked: false,
    ioDocked: false
};

function initDockablePanels() {

    const terminalSection = document.getElementById('terminal-section');
    const ioSection = document.getElementById('io-section');
    const problemsPanel = document.getElementById('problems-panel');
    const terminalHead = terminalSection?.querySelector('.panel-head');
    const ioHead = ioSection?.querySelector('.panel-head');

    if (!problemsPanel) return;


    if (terminalHead) {
        terminalHead.setAttribute('draggable', 'true');
        terminalHead.style.cursor = 'grab';

        terminalHead.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('application/x-sameko-panel', 'terminal');
            e.dataTransfer.effectAllowed = 'move';
            terminalSection.classList.add('panel-dragging');
            DockingState.draggedPanel = 'terminal';
        });

        terminalHead.addEventListener('dragend', () => {
            terminalSection.classList.remove('panel-dragging');
            DockingState.draggedPanel = null;
            document.querySelectorAll('.dock-drop-target').forEach(el => {
                el.classList.remove('dock-drop-target');
            });
        });
    }

    // Make IO header draggable
    if (ioHead) {
        ioHead.setAttribute('draggable', 'true');
        ioHead.style.cursor = 'grab';

        ioHead.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('application/x-sameko-panel', 'io');
            e.dataTransfer.effectAllowed = 'move';
            ioSection.classList.add('panel-dragging');
            DockingState.draggedPanel = 'io';
        });

        ioHead.addEventListener('dragend', () => {
            ioSection.classList.remove('panel-dragging');
            DockingState.draggedPanel = null;
            document.querySelectorAll('.dock-drop-target').forEach(el => {
                el.classList.remove('dock-drop-target');
            });
        });
    }

    // Problems panel as drop target
    problemsPanel.addEventListener('dragover', (e) => {
        if (DockingState.draggedPanel !== 'terminal' && DockingState.draggedPanel !== 'io') return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        problemsPanel.classList.add('dock-drop-target');
    });

    problemsPanel.addEventListener('dragleave', (e) => {
        if (!problemsPanel.contains(e.relatedTarget)) {
            problemsPanel.classList.remove('dock-drop-target');
        }
    });

    problemsPanel.addEventListener('drop', (e) => {
        e.preventDefault();
        problemsPanel.classList.remove('dock-drop-target');

        // Check for custom panel drag type
        const panelType = e.dataTransfer.getData('application/x-sameko-panel');

        if (panelType === 'terminal' || DockingState.draggedPanel === 'terminal') {
            dockTerminalToProblems();
        } else if (panelType === 'io' || DockingState.draggedPanel === 'io') {
            dockIOToProblems();
        }
    });

    // Load saved state
    if (App.settings?.panels?.terminalDocked) {
        setTimeout(() => dockTerminalToProblems({ open: false }), 100);
    }
    if (App.settings?.panels?.ioDocked) {
        setTimeout(() => dockIOToProblems(), 150);
    }
}

/**
 * The terminal is one element, #terminal-view (output + input), that lives either in
 * its own section or in the bottom panel. Docking only moves it; whether it is shown
 * inside the bottom panel is decided by the panel's data-view (CSS), never by styles on
 * the terminal itself, so nothing from one place is carried to the other.
 * @param {'section'|'panel'} where
 */
function mountTerminalView(where) {
    const view = document.getElementById('terminal-view');
    const host = document.getElementById(where === 'panel' ? 'problems-panel' : 'terminal-section');
    if (!view || !host) return;
    if (view.parentElement !== host) host.appendChild(view);
    fitTerminal();
}

/** @param {{open?: boolean}} [opts] open the bottom panel on the terminal (not when restoring at startup) */
function dockTerminalToProblems({ open = true } = {}) {
    if (DockingState.terminalDocked) return;

    const terminalSection = document.getElementById('terminal-section');
    const problemsPanel = document.getElementById('problems-panel');
    const resizerTerm = document.getElementById('resizer-term');

    if (!terminalSection || !problemsPanel) return;

    mountTerminalView('panel');

    // Hide the now-empty terminal section shell + its resizer
    terminalSection.classList.add('docked-away');
    if (resizerTerm) resizerTerm.classList.add('docked-away');

    // Add Terminal tab to the panel-head, right after PROBLEMS
    const panelHead = problemsPanel.querySelector('.panel-head');
    if (panelHead) {
        const terminalTab = document.createElement('span');
        terminalTab.className = 'panel-title terminal docked-tab';
        terminalTab.id = 'docked-terminal-tab';
        terminalTab.innerHTML = 'TERMINAL <span class="dock-undock" title="Drag to detach">×</span>';
        terminalTab.setAttribute('draggable', 'true');


        const problemCount = panelHead.querySelector('.problem-count');
        if (problemCount) {
            problemCount.after(terminalTab);
        } else {
            const problemsTitle = panelHead.querySelector('.panel-title');
            if (problemsTitle) {
                problemsTitle.after(terminalTab);
            }
        }


        const problemsTitle = panelHead.querySelector('.panel-title.problems');
        if (problemsTitle) {
            problemsTitle.classList.add('active');
        }

        // Click to switch tabs
        terminalTab.onclick = (e) => {
            if (e.target.classList.contains('dock-undock')) {
                undockTerminal();
                return;
            }
            switchDockedPanel('terminal');
        };


        const problemsTitleEl = panelHead.querySelector('.panel-title.problems');
        if (problemsTitleEl) {
            problemsTitleEl.onclick = () => switchDockedPanel('problems');
        }

        // Drag to undock
        terminalTab.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('application/x-sameko-panel', 'undock-terminal');
            e.dataTransfer.effectAllowed = 'move';
            terminalTab.classList.add('dragging');
        });

        terminalTab.addEventListener('dragend', () => {
            terminalTab.classList.remove('dragging');
            undockTerminal();
        });
    }

    // Show terminal, hide problems body
    switchDockedPanel('terminal');

    DockingState.terminalDocked = true;

    // Save state
    if (!App.settings.panels) App.settings.panels = {};
    App.settings.panels.terminalDocked = true;
    saveSettings();

    // Dropped in by the user: open the panel on it. Restored at startup: the panel keeps
    // its collapsed start state.
    if (open) {
        showBottomPanel('terminal');
    } else if (!App.showProblems) {
        App.showProblems = true;
        updateUI();
    }

    log('Terminal docked to Problems', 'info');
    refreshEditorLayout();
}

function switchDockedPanel(panelId) {
    const problemsPanel = document.getElementById('problems-panel');
    if (!problemsPanel) return;

    const problemsTitle = problemsPanel.querySelector('.panel-title.problems');
    const testsTitle = problemsPanel.querySelector('.panel-title.tests');
    const terminalTab = document.getElementById('docked-terminal-tab');
    const ioTab = document.getElementById('docked-io-tab');

    const problemsBody = problemsPanel.querySelector('.problems-body');
    const testsBody = document.getElementById('tests-results-list');
    let ioView = problemsPanel.querySelector('.docked-io-view');

    // The docked terminal is shown by CSS from this attribute (see mountTerminalView).
    problemsPanel.dataset.view = panelId;

    // Deactivate all headers
    problemsTitle?.classList.remove('active');
    testsTitle?.classList.remove('active');
    terminalTab?.classList.remove('active');
    ioTab?.classList.remove('active');

    // Hide all bodies
    if (problemsBody) problemsBody.style.display = 'none';
    if (testsBody) testsBody.style.display = 'none';
    if (ioView) ioView.style.display = 'none';

    if (panelId === 'problems') {
        problemsTitle?.classList.add('active');
        if (problemsBody) problemsBody.style.display = '';
    } else if (panelId === 'tests') {
        testsTitle?.classList.add('active');
        if (testsBody) testsBody.style.display = 'block';
    } else if (panelId === 'terminal') {
        terminalTab?.classList.add('active');
        fitTerminal();
    } else if (panelId === 'io') {
        ioTab?.classList.add('active');
        // Ensure docked shell exists (textareas are moved in by dockIOToProblems)
        if (!ioView) {
            createDockedIOView(problemsPanel);
            ioView = problemsPanel.querySelector('.docked-io-view');
        }
        if (ioView) ioView.style.display = 'flex';
    }
}


function undockTerminal() {
    if (!DockingState.terminalDocked) return;

    const terminalSection = document.getElementById('terminal-section');
    const problemsPanel = document.getElementById('problems-panel');
    const resizerTerm = document.getElementById('resizer-term');

    mountTerminalView('section');
    if (problemsPanel) problemsPanel.dataset.view = 'problems';

    terminalSection?.classList.remove('docked-away');
    resizerTerm?.classList.remove('docked-away');

    const terminalTab = document.getElementById('docked-terminal-tab');
    terminalTab?.remove();

    // Show problems body
    const problemsBody = problemsPanel?.querySelector('.problems-body');
    if (problemsBody) problemsBody.style.display = '';

    const problemsTitle = problemsPanel?.querySelector('.panel-title.problems');
    if (problemsTitle) {
        problemsTitle.classList.remove('active');
        problemsTitle.onclick = null; // Remove click handler
    }

    DockingState.terminalDocked = false;

    // Save state
    if (App.settings.panels) {
        App.settings.panels.terminalDocked = false;
        saveSettings();
    }

    // Refresh tests list if has tests
    if (ccProblem?.tests?.length > 0) {
        renderTestResults();
        switchProblemsTab('tests');
    }

    log('Terminal undocked', 'info');
    refreshEditorLayout();
    fitTerminal();
}

// ============================================================================
// I/O DOCKING FUNCTIONS
// ============================================================================

function dockIOToProblems() {
    if (DockingState.ioDocked) return;

    const ioSection = document.getElementById('io-section');
    const problemsPanel = document.getElementById('problems-panel');
    const resizerIO = document.getElementById('resizer-io');

    if (!ioSection || !problemsPanel) return;

    // Hide IO section (textareas will be moved into docked shell)
    ioSection.classList.add('docked-away');
    if (resizerIO) resizerIO.classList.add('docked-away');

    // Create docked shell (header + split containers, no clone textareas)
    createDockedIOView(problemsPanel);

    // Move real textareas into the docked slots
    const inputArea = document.getElementById('input-area');
    const expectedArea = document.getElementById('expected-area');
    const expectedDiff = document.getElementById('expected-diff');
    const inputSlot = document.getElementById('docked-input-slot');
    const expectedSlot = document.getElementById('docked-expected-slot');

    if (inputArea && inputSlot) inputSlot.appendChild(inputArea);
    if (expectedSlot) {
        if (expectedArea) expectedSlot.appendChild(expectedArea);
        if (expectedDiff) expectedSlot.appendChild(expectedDiff);
    }

    const panelHead = problemsPanel.querySelector('.panel-head');
    if (panelHead) {
        const ioTab = document.createElement('span');
        ioTab.className = 'panel-title io docked-tab';
        ioTab.id = 'docked-io-tab';
        ioTab.innerHTML = 'I/O <span class="dock-undock" title="Drag to detach">×</span>';
        ioTab.setAttribute('draggable', 'true');


        const terminalTab = document.getElementById('docked-terminal-tab');
        const problemCount = panelHead.querySelector('.problem-count');
        if (terminalTab) {
            terminalTab.after(ioTab);
        } else if (problemCount) {
            problemCount.after(ioTab);
        } else {
            const problemsTitle = panelHead.querySelector('.panel-title');
            if (problemsTitle) problemsTitle.after(ioTab);
        }

        // Click to switch tabs
        ioTab.onclick = (e) => {
            if (e.target.classList.contains('dock-undock')) {
                undockIO();
                return;
            }
            switchDockedPanel('io');
        };

        // Drag to undock
        ioTab.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('application/x-sameko-panel', 'undock-io');
            e.dataTransfer.effectAllowed = 'move';
            ioTab.classList.add('dragging');
        });

        ioTab.addEventListener('dragend', () => {
            ioTab.classList.remove('dragging');
            undockIO();
        });
    }

    DockingState.ioDocked = true;

    // Save state
    if (!App.settings.panels) App.settings.panels = {};
    App.settings.panels.ioDocked = true;
    saveSettings();

    // Show problems if hidden
    if (!App.showProblems) {
        App.showProblems = true;
        updateUI();
    }

    log('I/O docked to Problems', 'info');
    refreshEditorLayout();
}

function undockIO() {
    if (!DockingState.ioDocked) return;

    const ioSection = document.getElementById('io-section');
    const problemsPanel = document.getElementById('problems-panel');
    const resizerIO = document.getElementById('resizer-io');

    // Move real textareas back to io-section
    const inputArea = document.getElementById('input-area');
    const expectedArea = document.getElementById('expected-area');
    const expectedDiff = document.getElementById('expected-diff');

    if (inputArea) {
        const inputPanel = ioSection?.querySelector('.io-panel-input');
        if (inputPanel) inputPanel.appendChild(inputArea);
    }
    if (expectedArea) {
        const expectedPanel = ioSection?.querySelector('.io-panel-expected');
        if (expectedPanel) {
            expectedPanel.appendChild(expectedArea);
            if (expectedDiff) expectedPanel.appendChild(expectedDiff);
        }
    }

    ioSection?.classList.remove('docked-away');
    resizerIO?.classList.remove('docked-away');

    const ioTab = document.getElementById('docked-io-tab');
    ioTab?.remove();

    const dockedView = problemsPanel?.querySelector('.docked-io-view');
    dockedView?.remove();

    if (!DockingState.terminalDocked) {
        const problemsBody = problemsPanel?.querySelector('.problems-body');
        if (problemsBody) problemsBody.style.display = '';
    }

    DockingState.ioDocked = false;

    // Save state
    if (App.settings.panels) {
        App.settings.panels.ioDocked = false;
        saveSettings();
    }

    // Refresh tests list if has tests
    if (ccProblem?.tests?.length > 0) {
        renderTestResults();
        switchProblemsTab('tests');
    }

    log('I/O undocked', 'info');
    refreshEditorLayout();
}

function createDockedIOView(container) {

    let dockedIOView = container.querySelector('.docked-io-view');
    if (!dockedIOView) {
        dockedIOView = document.createElement('div');
        dockedIOView.className = 'docked-io-view';
        dockedIOView.innerHTML = `
            <div class="docked-io-header-bar">
                <span class="docked-io-title">Test Cases</span>
                <div class="docked-test-nav" id="docked-test-nav">
                    <button class="docked-nav-btn" id="docked-btn-add-test" title="Add test">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                    </button>
                    <button class="docked-nav-btn" id="docked-btn-prev-test" title="Previous test">
                        <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="3">
                            <polyline points="15 18 9 12 15 6" />
                        </svg>
                    </button>
                    <span class="docked-test-label" id="docked-test-label">0/0</span>
                    <button class="docked-nav-btn" id="docked-btn-next-test" title="Next test">
                        <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="3">
                            <polyline points="9 18 15 12 9 6" />
                        </svg>
                    </button>
                    <button class="docked-nav-btn danger" id="docked-btn-delete-test" title="Delete test">
                        <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="docked-io-split">
                <div class="docked-io-panel">
                    <div class="docked-io-header">INPUT</div>
                    <div class="docked-io-slot" id="docked-input-slot"></div>
                </div>
                <div class="docked-io-divider"></div>
                <div class="docked-io-panel">
                    <div class="docked-io-header">EXPECTED</div>
                    <div class="docked-io-slot" id="docked-expected-slot"></div>
                </div>
            </div>
        `;
        container.appendChild(dockedIOView);

        updateDockedTestNavUI();

        // Bind docked nav buttons - these never change
        document.getElementById('docked-btn-add-test')?.addEventListener('click', addTestCase);
        document.getElementById('docked-btn-prev-test')?.addEventListener('click', prevTestCase);
        document.getElementById('docked-btn-next-test')?.addEventListener('click', nextTestCase);
        document.getElementById('docked-btn-delete-test')?.addEventListener('click', deleteTestCase);
    } else {
        updateDockedTestNavUI();
    }
    return dockedIOView;
}

// Update docked test navigation UI
function updateDockedTestNavUI() {
    const testLabel = document.getElementById('docked-test-label');
    const prevBtn = document.getElementById('docked-btn-prev-test');
    const nextBtn = document.getElementById('docked-btn-next-test');
    const deleteBtn = document.getElementById('docked-btn-delete-test');

    if (!testLabel) return;

    const testCount = ccProblem?.tests?.length || 0;

    if (testCount > 0) {
        testLabel.textContent = `${ccTestIndex + 1}/${testCount}`;
        if (prevBtn) prevBtn.style.display = 'flex';
        if (nextBtn) nextBtn.style.display = 'flex';
        if (deleteBtn) deleteBtn.style.display = 'flex';
    } else {
        testLabel.textContent = '0/0';
        if (prevBtn) prevBtn.style.display = 'none';
        if (nextBtn) nextBtn.style.display = 'none';
        if (deleteBtn) deleteBtn.style.display = 'none';
    }
}

function refreshEditorLayout() {
    setTimeout(() => {
        if (App.editor) App.editor.layout();
        if (App.editor2) App.editor2.layout();
    }, 50);
}

// Re-fit the xterm terminal after a layout change (dock/undock/switch/show).
// xterm computes a fixed row/col count in fit(); when the container changes
// size we must recompute or it keeps stale dimensions and won't fill. Two rAFs
// + a fallback timeout cover both instant reflows and CSS transitions.
function fitTerminal() {
    if (!window.TerminalManager) return;
    const doFit = () => TerminalManager.fit();
    requestAnimationFrame(() => requestAnimationFrame(doFit));
    setTimeout(doFit, 120); // after the panel height/opacity transition
}


// ============================================================================
// RESIZERS
// ============================================================================
function applySavedPanelSizes() {
    const panelSettings = App.settings.panels || {};

    const ioSection = document.getElementById('io-section');
    const termSection = document.getElementById('terminal-section');
    const problemsPanel = document.getElementById('problems-panel');

    const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

    // Keep enough room for Monaco editor on small/odd aspect ratios.
    const viewportWidth = window.innerWidth || 1280;
    const minEditorWidth = 420;
    const reserved = 120; // header paddings/gaps/safety
    const maxPanelWidth = Math.max(150, Math.floor((viewportWidth - minEditorWidth - reserved) / 2));

    if (ioSection && Number.isFinite(panelSettings.ioWidth) && panelSettings.ioWidth > 0) {
        ioSection.style.width = clamp(panelSettings.ioWidth, 150, maxPanelWidth) + 'px';
    }
    if (termSection && Number.isFinite(panelSettings.termWidth) && panelSettings.termWidth > 0) {
        termSection.style.width = clamp(panelSettings.termWidth, 150, maxPanelWidth) + 'px';
    }
    if (problemsPanel && Number.isFinite(panelSettings.problemsHeight) && panelSettings.problemsHeight > 0) {
        const maxProblemsHeight = Math.max(120, Math.floor((window.innerHeight || 800) * 0.55));
        problemsPanel.style.height = clamp(panelSettings.problemsHeight, 80, maxProblemsHeight) + 'px';
    }
}

function persistPanelSize(targetId, sizeValue) {
    if (!App.settings.panels) App.settings.panels = {};

    if (targetId === 'io-section') {
        App.settings.panels.ioWidth = sizeValue;
    } else if (targetId === 'terminal-section') {
        App.settings.panels.termWidth = sizeValue;
    } else if (targetId === 'problems-panel') {
        App.settings.panels.problemsHeight = sizeValue;
    }

    saveSettings();
}

function initResizers() {
    applySavedPanelSizes();
    setupResizer('resizer-io', 'io-section', 150, 500);
    setupResizer('resizer-term', 'terminal-section', 150, 600);
    setupResizerH('resizer-problems', 'problems-panel', 80);

    window.addEventListener('resize', () => {
        applySavedPanelSizes();
    });
}

function setupResizer(resizerId, targetId, min, max) {
    const resizer = document.getElementById(resizerId);
    const target = document.getElementById(targetId);
    let dragging = false;
    let startX, startW;

    const getDynamicMax = () => {
        const viewportWidth = window.innerWidth || 1280;
        const minEditorWidth = 420;
        const reserved = 120;
        const computedMax = Math.max(min, Math.floor((viewportWidth - minEditorWidth - reserved) / 2));
        return Math.min(max, computedMax);
    };

    resizer.onmousedown = e => {
        dragging = true;
        startX = e.clientX;
        startW = target.offsetWidth;
        resizer.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        e.preventDefault();
    };

    document.addEventListener('mousemove', e => {
        if (!dragging) return;
        const dx = startX - e.clientX;
        const dynamicMax = getDynamicMax();
        const newW = Math.min(dynamicMax, Math.max(min, startW + dx));
        target.style.width = newW + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (dragging) {
            dragging = false;
            resizer.classList.remove('dragging');
            document.body.style.cursor = '';
            persistPanelSize(targetId, target.offsetWidth);
        }
    });
}

function setupResizerH(resizerId, targetId, min) {
    const resizer = document.getElementById(resizerId);
    const target = document.getElementById(targetId);
    let dragging = false;
    let startY, startH;

    resizer.onmousedown = e => {
        dragging = true;
        startY = e.clientY;
        startH = target.offsetHeight;
        resizer.classList.add('dragging');
        document.body.style.cursor = 'row-resize';
        e.preventDefault();
    };

    document.addEventListener('mousemove', e => {
        if (!dragging) return;
        const dy = startY - e.clientY;
        // Same cap applySavedPanelSizes uses (55% of the window), instead of a
        // fixed 400px that was too much on a short window and too little on a tall one.
        const dynamicMax = Math.max(min, Math.floor((window.innerHeight || 800) * 0.55));
        const newH = Math.min(dynamicMax, Math.max(min, startH + dy));
        target.style.height = newH + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (dragging) {
            dragging = false;
            resizer.classList.remove('dragging');
            document.body.style.cursor = '';
            persistPanelSize(targetId, target.offsetHeight);
        }
    });
}

// ============================================================================
// DISCORD RICH PRESENCE
// ============================================================================

let _discordCursorTimer = null;
let _discordLastPos = { line: 1, col: 1 };

function updateDiscordPresence(tab, line, col) {
    // Respect the enabled setting
    if (App.settings?.discord?.enabled === false) return;
    if (!window.electronAPI?.discordUpdatePresence) return;

    const fileName = tab?.name || null;
    let workspaceName = null;
    if (tab?.path) {
        const parts = tab.path.replace(/\\/g, '/').split('/');
        if (parts.length >= 2) workspaceName = parts[parts.length - 2];
    }

    const ln = line || _discordLastPos.line;
    const cl = col || _discordLastPos.col;

    window.electronAPI.discordUpdatePresence({ fileName, workspaceName, line: ln, col: cl }).catch(() => { });
}

/**
 * Called on cursor move — throttled to avoid spamming the RPC socket
 */
function scheduleDiscordCursorUpdate(line, col) {
    if (App.settings?.discord?.enabled === false) return;
    _discordLastPos = { line, col };
    if (_discordCursorTimer) return; // already scheduled
    _discordCursorTimer = setTimeout(() => {
        _discordCursorTimer = null;
        const activeTab = App.tabs.find(t => t.id === App.activeTabId) || null;
        updateDiscordPresence(activeTab, _discordLastPos.line, _discordLastPos.col);
    }, 5000); // update presence every 5 s at most on cursor movement
}

/**
 * Update the Discord preview card inside settings panel
 */
function updateDiscordPreview() {
    const detailsEl = document.getElementById('discord-preview-details');
    const stateEl = document.getElementById('discord-preview-state');
    if (!detailsEl || !stateEl) return;
    const activeTab = App.tabs.find(t => t.id === App.activeTabId);
    if (activeTab?.name) {
        detailsEl.textContent = `Working on ${activeTab.name}`;
        const folder = activeTab.path
            ? activeTab.path.replace(/\\/g, '/').split('/').slice(-2, -1)[0]
            : null;
        stateEl.textContent = folder
            ? `In ${folder} \u2014 Ln ${_discordLastPos.line}, Col ${_discordLastPos.col}`
            : `Sameko Dev C++ \u2014 Ln ${_discordLastPos.line}, Col ${_discordLastPos.col}`;
    } else {
        detailsEl.textContent = 'Idle';
        stateEl.textContent = 'Sameko Dev C++';
    }
}
