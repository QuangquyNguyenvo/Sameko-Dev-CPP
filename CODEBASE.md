# CODEBASE.md — Sameko Dev C++

A map of where things live; it answers "which file do I open?". Contribution guidelines are in
`CONTRIBUTING.md`.

**Sameko Dev C++** is a C++ IDE built on Electron 44 + Monaco Editor. It ships a bundled MinGW GCC
toolchain (`Sameko-GCC/`) and adds a GDB debugger, clangd IntelliSense, competitive-programming
judging, AStyle formatting, local history, Discord Rich Presence and auto-update. Windows is the
primary target; Linux is supported.

## 1. Architecture

```
┌─────────────────────────────┐      IPC       ┌──────────────────────────────┐
│   MAIN PROCESS  (app/)      │  <---------->  │  RENDERER PROCESS  (src/)    │
│   Node.js, CommonJS         │   preload.js   │  Browser, no Node            │
│                             │  contextBridge │                              │
│  • Lifecycle, windows       │                │  • All UI                    │
│  • File system, compiler    │  window        │  • Monaco editor             │
│  • GDB, clangd, services    │  .electronAPI  │  • Tabs, themes, features    │
└─────────────────────────────┘                └──────────────────────────────┘
```

Startup (`app/main.js`): `v8-compile-cache` → single-instance lock → `setupAppEvents()` →
`app.whenReady()` → splash window → `initializeApp()` (dirs, compiler detection) →
`createMainWindow()` → register all IPC handlers (`app/ipc/index.js`) → the main window is
revealed on `ready-to-show` (10 s fallback) and the splash closes. Only after the page's
`did-finish-load` does `startDeferredWork()` start the compiler warm-up, run-launcher and PCH
builds, and 1.5 s later auto-update and Discord RPC. `electron-updater`, `electron-log` and
`discord-rpc` are required on first use, not at startup (they were ~170 ms of module loading).

The main window always loads `src/index.html` from disk (`loadFile`), in development and when
packaged. Navigation away from it and `window.open` are denied in `app/windows/main-window.js`.

## 2. Main process — `app/`

| Path | Responsibility |
|---|---|
| `main.js` | Entry point: lifecycle, splash, IPC registration, service init. |
| `core/app-lifecycle.js` | `initializeApp()` (creates user-data and temp dirs), `setupAppEvents()`. |
| `core/window-manager.js` | Core window management. |
| `windows/main-window.js` | The frameless `BrowserWindow`, navigation guards, saved window bounds. |
| `windows/splash-window.js` | Splash shown while the main window loads (`src/splash.html`). |

### `app/ipc/` — one handler file per domain
`index.js` exports `registerAllHandlers(mainWindow)`, which wires every file below.

| File | Handles |
|---|---|
| `file-handlers.js` | Open/save/read/delete/rename, directory listing, external-change watcher. |
| `compiler-handlers.js` | Compile, run, stop, stdin, compiler info. |
| `debug-handlers.js` | GDB session control: breakpoints, stepping, frames, variable objects. |
| `format-handlers.js` | AStyle formatting, syntax check, suggestions, clangd completions/hover. |
| `competitive-handlers.js` | Competitive Companion server, batch testing, judging. |
| `settings-handlers.js` | Load/save `settings.json`. |
| `history-handlers.js` | Local history: backup before save, list, read (snapshot files only), clear. Async I/O. |
| `dialog-handlers.js`, `window-handlers.js` | System dialogs; minimize/maximize/close. |
| `update-handlers.js`, `discord-handlers.js` | electron-updater, opening project pages; Discord Rich Presence. |
| `state-handlers.js` | JSON documents under `userData/state/` (`state-read/write/delete`) and theme assets (`theme-asset-save`). |

### `app/services/` — business logic behind the handlers

| Path | Responsibility |
|---|---|
| `compiler/detector.js` | Finds the bundled and system compilers; resolves app/writable base paths. |
| `compiler/executor.js` | Spawns g++, runs the program, streams output. |
| `compiler/pch-manager.js`, `compiler/warmup.js` | Precompiled-header cache; startup warm-up. |
| `compiler/run-launcher.js` | Builds (once per toolchain) and locates `sameko_run.exe`, the Windows helper that runs a program and reports its wall time, CPU time and peak memory. |
| `debugger/gdb-session.js` | Drives GDB over the MI protocol. |
| `debugger/mi-parser.js` | Pure GDB/MI output parser (unit-tested by `scripts/test-debugger.js`). |
| `syntax/clangd-service.js` | clangd child process, JSON-RPC over stdio. |
| `syntax/gcc-checker.js` | `g++ -fsyntax-only` check, the fallback when clangd is unavailable. |
| `competitive/companion-server.js` | HTTP listener for Competitive Companion on `127.0.0.1:27121` (the `10043` in `constants.js` is unused). |
| `competitive/batch-tester.js`, `competitive/judge-selftest.js` | Multi-test runner; judge self-test. |
| `formatter/astyle.js`, `formatter/styles.js` | AStyle wrapper; style presets. |
| `auto-update-service.js`, `discord-rpc-service.js` | electron-updater; Discord RPC. |

### `app/shared/`

| File | Contents |
|---|---|
| `constants.js` | IPC channel names (`IPC.<GROUP>`), path names, window defaults. `LIMITS`, `COMPILER` and `COMPETITIVE_COMPANION` are declared but not read by the code that does the work. |
| `platform.js` | OS helpers: `IS_WIN`/`IS_LINUX`, `binName`, `NULL_DEVICE`, `which`, `appTempDir`, `killPosixTree`, system compiler paths. |
| `settings-store.js` | The only reader/writer of `settings.json`: atomic write, `.bak` fallback, keeps main-owned keys (`windowBounds`) when the renderer saves. |
| `settings-reader.js` | Compiler settings for main-process services, read through the store. |
| `judge.js` | `normalizeOutput()`, `compareOutputs()`; also loaded by `preload.js` so both sides judge alike. |
| `types.js`, `validators.js` | JSDoc types; input validation. |

## 3. `preload.js`
Exposes `window.electronAPI`: file ops, explorer, settings, build/run, debugger, window controls,
main→renderer events, Competitive Companion, batch testing, judge utils, auto-update, formatting,
syntax/clangd, local history, Discord RPC.

## 4. Renderer — `src/`

| Path | Responsibility |
|---|---|
| `index.html` | Root page. Loads Monaco, then every script in order with plain `<script>` tags. |
| `splash.html` | Splash screen. |
| `renderer/app/*.js` | The application itself, 17 files loaded in a fixed order (formerly one 7,900-line `app.js`). File index in §9. |
| `renderer/boot.js` | Loaded first: error hooks, Monaco loader config, shared `escHtml`. |
| `renderer/ui/` | `theme-manager.js`, `theme-tokens.js`, `theme-customizer.js` (draft/history/save), `theme-customizer-view.js` (controls/scoped IDE preview), `theme-marketplace.js`, `color-registry.js`, `confirm-dialog.js`, `motion.js`. |
| `styles/` | `base.css` (imports `animations.css` and fonts), `components/*.css`, `themes/{theme,themes}.css`. `components/toolbar.css` and `components/islands.css` load after `themes.css`: the header buttons, and the floating-card layout (header islands, editor / bottom panel / status bar cards, Run split button, collapsed bottom panel) for every theme. |
| `assets/` | Fonts, icons, backgrounds (five looping `.webm` + one `.jpg`), screenshots (README only). |

### Loaded scripts, in order (`index.html`)
`renderer/boot.js` (error hooks, Monaco loader config, shared `escHtml`) → Monaco loader → `features/suggestions/cpp-suggestions.js` →
`features/snippets/snippet-editor.js` → `renderer/ui/theme-tokens.js` → `color-registry.js` →
`theme-manager.js` → `theme-marketplace.js` → `theme-customizer-view.js` → `theme-customizer.js` → `confirm-dialog.js` → `motion.js` →
`features/local-history/history-manager.js` → `features/file-explorer/file-explorer.js` →
`features/terminal/terminal-manager.js` → `features/debugger/debugger-ui.js` → `renderer/app/*.js` in
the order of §9.

| Feature | File | Global |
|---|---|---|
| Completion + hover (clangd, snippets) | `features/suggestions/cpp-suggestions.js` | `registerCppIntellisense` |
| Snippet settings list | `features/snippets/snippet-editor.js` | `renderSnippetsList`, `editSnippet` |
| Local history / checkpoints | `features/local-history/history-manager.js` | `LocalHistory` |
| Explorer, categories, contest mode | `features/file-explorer/file-explorer.js` | `FileExplorer` |
| Terminal output (xterm, display only; xterm.js is loaded through the AMD loader when the page is idle or on the first write, earlier writes are queued) | `features/terminal/terminal-manager.js` | `TerminalManager` |
| Debugger panel, breakpoints, variables | `features/debugger/debugger-ui.js` | `Debugger` |
| GSAP effects (menu cascade, Settings pop-in, Run result); GSAP is loaded through the AMD loader once the editor is ready, and every call is a no-op in Performance Mode or with reduced motion | `renderer/ui/motion.js` | `Motion` |

**Icons** are Phosphor (MIT) symbols in a sprite inside `index.html`, between the `icons:start` /
`icons:end` comments. Write `<svg class="ico" data-icon="gear-six" data-weight="duo" data-alt="fill"></svg>`
and run `npm run icons` (`scripts/build-icons.js`): it fills in the `<use>` references and bundles
only the symbols in use. `duo` is the bold outline over duotone's tint; `data-alt` is the weight
shown while the button is `.active`. Icons in markup built by JS reference `#i-<name>[-<weight>]`
directly and must be listed in `JS_ICONS` in that script. `@phosphor-icons/core` is a dev
dependency only.

Every `.js` under `src/` is in that list; a new renderer file does nothing until it gets a
`<script>` tag there. (Eight never-loaded modules and the golden-layout dependency were deleted
in October 2026.)

### Theme system
- **Data:** `ThemeManager._getHardcodedThemes()` defines the six builtin themes (`kawaii-dark`,
  `kawaii-light`, `sakura`, `dracula`, `monokai`, `nord`) inline.
- **Tokens:** `ThemeTokens` maps each token to a CSS variable and type, holds defaults
  (`fillDefaults`) and is the single apply path (`applyToElement` / `applyValue` / `applySyntax`).
- **Apply:** `ThemeManager.setTheme(id, {editorScheme})` sets the variables on `:root`, sets
  `data-theme` and `data-theme-variant` (light/dark) and applies the Monaco theme.
- **Persistence:** custom themes and builtin background overrides share `userData/state/themes.json`
  through `electronAPI.stateRead/stateWrite`; old localStorage keys migrate after a successful write.
- **Customizer:** a separate draft owns history and validation. The dialog reuses the Settings
  popup's classes (`.settings-*`, `.setting-row`, `.btn-save`); its Shadow DOM preview is a scaled
  copy of the islands layout fed with all `ThemeTokens`. Editing never changes the active Monaco theme.
  `npm run test:themes` covers editing, save/restart, backgrounds and portable export on an isolated profile.

## 5. Everything else at the root

| Path | What it is |
|---|---|
| `Sameko-GCC/` | Bundled toolchain (gitignored). Copied into the Windows build as an extra resource. |
| `scripts/` | `clean.js`, `build-appimage.js`, `build-icons.js`, `check-toolchain-deps.js`, `test-debugger.js`, `test-gui-smoke.js`. |
| `docs/` | The sameko.dev website (landing page and wiki). Not part of the app. |
| `plans/` | Gitignored working plans. |
| `samekodevcpp/` | electron-builder output (gitignored). |
| `setup-bundled-mingw.md` | How to obtain and place the bundled compiler. |
| `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md` | User and contributor docs. |

## 6. Packaging (`package.json` › `build`)
- electron-builder, `asar: true`, output `samekodevcpp/`, appId `com.quangquy.cppide`.
- Packaged files: `app/`, `preload.js`, `src/`, `node_modules/` (trimmed by the exclusion list:
  Monaco ships only `min/vs` without the TypeScript/CSS/HTML language services and non-English
  strings — every tab is `cpp`, the theme editor uses `json`). `electronLanguages: ["en-US"]` keeps
  one Chromium locale.
- Windows: NSIS installer + zip, x64, with `Sameko-GCC/` as an extra resource. Its `filter` drops
  what the IDE never runs (Fortran/Objective-C compilers, `ld.lld`, WinLibs extras such as ccache,
  nasm, ninja, the `wl-*` package manager, the DLLs only they import, Python's test suite,
  GCC plugin headers, `.idl` files): 894 → 540 MB. The DLL list was derived from PE imports;
  after editing the filter or updating the toolchain, build `--win dir` and run
  `node scripts/check-toolchain-deps.js` — it fails if any kept binary imports a dropped DLL.
  Runtime DLLs a user's program may need (`libgomp`, `libquadmath`, `libatomic`, `libssp` and
  their dependency `libdl`) are kept on purpose.
- Linux: AppImage, deb, tar.gz; `npm run build:appimage` builds the AppImage via
  `scripts/build-appimage.js`. Linux uses the system `g++`/`gdb`/`clangd`/`astyle`.

**Interface Scale** (`appearance.uiScale`, `'auto'` or a percentage) is applied by the main process
as the page zoom: `applyUiScale()` in `app/windows/main-window.js` runs on `dom-ready`, on every
settings save, when the window moves and when displays change, and sets the minimum window size to
760×520 CSS px times the factor. Layout code and media queries therefore see CSS pixels and need
no knowledge of the scale.

## 7. Runtime data
- **User data** (`%APPDATA%/sameko-dev-cpp/` on Windows, `~/.config/sameko-dev-cpp/` on Linux):
  `settings.json` (includes window bounds), `local-history/` (up to 20 versions per file),
  `snippets.json`.
- **Temp** (via `appTempDir()`): `cpp-ide/` (scratch sources), `cpp-ide-pch/` (PCH cache),
  `cpp-ide-builds/` (build output), `cpp-ide-check/` (syntax-check scratch).

## 8. How the main flows behave

Verified by reading and by running the app on 2026-10-03, after the first fix pass. Items marked ⚠
are open defects recorded in `plans/code-audit/FINDINGS.md`; do not copy the pattern.

The page has a Content-Security-Policy: no inline `<script>` and no inline event-handler attributes
(`onclick="…"`) — attach listeners in JS.

**Compile** (`buildActiveTab` in `renderer/app/build.js` → `compile` IPC → `executor.compile`)
- Flags are assembled in the renderer by `buildCompileFlags()`; the default is `-O0 -g0`, and
  `executor` prepends `-std=c++17` when no `-std=` is present.
- A saved file is written to disk first; an untitled tab is compiled from
  `<temp>/cpp-ide/temp_code.cpp`.
- Output is `<temp>/cpp-ide-builds/<basename>-<hash of full path>.exe`; the path is stored on the
  tab (`tab.exePath`) and "Run only" runs the active tab's build.
- If the source contains `bits/stdc++.h`, `ensurePCH(flags)` supplies
  `<temp>/cpp-ide-pch/<key>/stdc++.h.gch`, added as `-include stdc++.h`. `getPCHFlags()` picks every
  flag that affects PCH validity (`-O`, `-std`, `-g`, `-D`/`-U`, `-f…`, `-m…`); the key is
  `O0_stdc17` for the plain case and gains a hash otherwise. Concurrent requests for one key share
  one build; at most four variants are kept (each `.gch` is 110–120 MB). A default PCH is prebuilt
  1.5 s after launch.
- `sameko_unbuffer.o` from the toolchain is linked unless "Realtime Output" is off.
- Build cache (`buildCacheKey` / `reusableBuild` in `executor.js`, in memory): when the full g++
  argument list, the source text and the compiler's size+mtime match the last successful build of
  that output path and the `.exe` still has the size and mtime it was built with, `compile()`
  returns `{ cached: true }` without running g++. Sources with `#include "…"`, an `<…>` include
  found next to the file, or user `-I`/`-L`/`-l`/`-Wl,`/`@file` flags are never cached;
  `execution.noBuildCache` turns it (and the PCH) off.
- With single-file mode off, `#include "x.h"` also compiles a sibling `x.cpp`.
- `compile()` stops a still-running program first; `process-stopped` is only emitted when one was
  actually running.

**Run** (`run()` → `run` IPC → `executor.run`)
- `spawn` with piped stdio; stdout/stderr are sent as `process-output` / `process-error` at most
  32 K chars per 30 ms tick, and the pipes are paused above a 128 K backlog (back-pressure: the
  program blocks instead of flooding the renderer).
- On Windows the program is started through the run launcher (`<temp>/cpp-ide-tools/sameko_run-*.exe
  <stats.json> <program.exe>`): the child inherits the pipes, runs in a kill-on-close job, and the
  launcher writes `{wallMs, cpuMs, peakKB}` that `process-exit` reports. If the launcher is not
  built yet (first seconds after the first launch) or on Linux, the program is spawned directly and
  time comes from Node, memory from `tasklist` / `/proc`.
- The INPUT panel is sent as one block 20 ms after start; the terminal input box sends line by line.
- External terminal: `start /wait cmd` on Windows, a runner script plus a terminal emulator on Linux.
- Stop is `executor.stopProcess()`: it kills only the child it spawned (`taskkill /pid /t` on
  Windows) while holding its handle. Never kill by image name.

**Live check** (`scheduleLiveCheck` → `syntax-check` IPC → `services/syntax/index.js`)
- Diagnostics come from clangd: `clangd-service.getDiagnostics()` syncs the document and waits for
  the `publishDiagnostics` notification of that version (~100 ms once the preamble is built).
- Fallback when clangd is not running or times out: `g++ -fsyntax-only` on a temp copy with the user's standard and extra flags (and the matching
  PCH when the source includes `bits/stdc++.h`).
- Results become Monaco markers (owner `live-check`) and the Problems list. Off by default.

**IntelliSense** (`cpp-suggestions.js` → `get-clangd-completions` / `get-clangd-hover`)
- One clangd process, started when `app/ipc/format-handlers.js` is first required. A request
  carries the full document; it is forwarded (`didOpen`, then `didChange`) only when the text
  differs from what clangd has, and `clangd-close-document` sends `didClose` when a tab closes.
  Flags (standard, MinGW target, include paths, `-Wall -Wextra`, extra flags) are sent as
  `fallbackFlags` in the LSP `initialize` request; clangd is restarted when Settings change them.
  Nothing is written to the machine-wide clangd config any more (a file left by an older version
  is removed if it still carries the app's marker).

**Debug** (`Debugger.start` → `compile` with `-g -O0` and its own PCH → `debug:start`)
- `GdbSession` drives `gdb --interpreter=mi3`; program I/O is redirected to temp files and polled
  every 120 ms; stdin comes from the INPUT panel only.
- Every stop sends frames and locals in one `debug:stopped` event; the UI then creates the GDB
  variable objects of the frame in one batched call (`debug:varCreateMany`) and patches values with
  `-var-update` on later stops in the same frame.

**Opening files**
- Ctrl+O starts in the active file's folder (else the Explorer folder, else the folder of the last
  dialog). Its filters include write-ups and test data (`.txt .md .inp .out .ans …`).
- Files on the command line ("Open with", a second launch while the app runs) go through
  `app/services/launch-files.js`: the first launch's are fetched by the renderer with
  `getLaunchFiles()` after the session restore; later ones arrive as `file-opened` events.

**Tabs and editors**
- `languageForFile()` (`core.js`) picks the model language from the extension: C/C++ and untitled
  tabs are `cpp`, `.md` is `markdown`, everything else `plaintext`. `isCppTab()` gates Build,
  live check, Format and clangd; `.md`/`.txt` wrap lines and text files do not flag non-ASCII
  letters. `renderTabs()` re-syncs the language after a rename or Save As.
- `App.tabs[]` holds `{id, name, path, content, original, modified, viewState, exePath, model}`.
  **Each tab owns a Monaco model** (`getTabModel`); showing a tab is `editor.setModel`, so undo
  history, markers and scroll state stay with the file, and one tab shown in both split panes is one
  live document. Use `showTabInEditor`, `setTabText` (replace text from outside) and
  `disposeTabModel`; do not call `editor.setValue()` to switch files. `tab.content` is kept in
  sync by the editor's change handler, which finds the tab with `getTabForModel`.
- Decorations made with `deltaDecorations` are tracked by id per model:
  `clearEditorDecorationsBeforeSwitch()` (error lines + `Debugger.onFileHidden()`) runs before a
  model is swapped and `Debugger.onFileShown()` after.
- Each editor has an owned placeholder model (`editor.__emptyModel`) shown when no tab is open.
- Keyboard shortcuts: one capture-phase `document` keydown handler (`initShortcuts`) maps combos
  through `currentShortcutMap` to `ACTION_HANDLERS` and stops propagation when it handles a key,
  so the table in Settings wins over Monaco's built-ins. Do not add `editor.addCommand` bindings.

**Batch tests** (`runAllTests` → `run-test` IPC → `batch-tester.runTest`)
- One warm-up run, then the tests run on a pool of up to 4 workers
  (`settings.execution.parallelTests`, default on); a test that timed out or used more than 60% of
  the limit is re-run alone. Each test goes through the run launcher, output is capped at 16 MB.

**Persistence**

| Data | Where |
|---|---|
| Settings, window bounds | `userData/settings.json` via `app/shared/settings-store.js` (+ `settings.json.bak`); `windowBounds` belongs to main |
| Checkpoints of saved files | `userData/local-history/<sha256(path)>/<timestamp>.snapshot`, pruned by age ("Delete After") |
| Session (open tabs, unsaved text, each tab's test cases) | `userData/state/session.json`, every 30 s and 5 s after an edit |
| Checkpoints of untitled tabs | `userData/state/untitled-<key>.json`, removed when the tab closes (stale ones swept after 14 days) |
| Explorer state, categories, saved approaches | `userData/state/explorer.json` (batched writes, flushed on close); legacy `localStorage` keys are migrated once. `localStorage['cp-mode:<folder>']` is still read. |
| Custom themes, background overrides | `userData/state/themes.json` (`{version:1,themes,backgrounds}`); legacy localStorage keys migrate once; images/videos are files in `userData/theme-assets/`, embedded into portable exports |
| Contest metadata | `<folder>/.sameko` |
| Debugger panel prefs | `localStorage['sameko-debug-*']` |

## 9. `src/renderer/app/` file index

Plain `<script>` files sharing one global scope, loaded in this order. A function may be called
from any file once everything has loaded; only code that runs **at load time** must not need a
function from a later file. Search for the function name to find the exact spot.

| File | Lines | Contents |
|---|---|---|
| `core.js` | 939 | Defaults (`DEFAULT_SETTINGS`), the global `App` state, startup (`DOMContentLoaded`), tab models, Monaco setup, `createEditor` |
| `split.js` | 418 | Split editor, tab drag-and-drop, split resizer |
| `settings.js` | 1128 | Settings load/save, the Settings dialog, keybinding editor, auto-save |
| `session.js` | 375 | Session checkpoint: save, restore prompt, reopening tabs |
| `live-check.js` | 329 | Live check, problem summary in the status bar, `applySettings` |
| `appearance.js` | 110 | `applyTheme`, `applyBackgroundSettings` |
| `shortcuts.js` | 253 | `ACTION_HANDLERS`, the capture-phase key handler, `formatCode` |
| `layout.js` | 971 | `updateUI`, header buttons, docking Terminal and I/O into Problems, resizers, Discord presence |
| `tabs.js` | 420 | `newFile`, `setActive`, `closeTab`, `openFileFromPath`, `renderTabs`, menus, `save` / `saveAs` |
| `build.js` | 805 | `buildActiveTab` (compile / build & run), `run`, `stop`, Problems panel, `log`, `setStatus`, output diff |
| `ipc-events.js` | 144 | Handlers for events from main: file opened, process output / exit / stopped, system messages |
| `companion.js` | 643 | Competitive Companion, per-tab test state (`ccProblem`, `saveTestStateToTab`), test navigation |
| `file-watch.js` | 118 | External file changes and the reload prompt |
| `batch-tests.js` | 605 | `runAllTests`, single test, results list, `buildCompileFlags` |
| `terminal-input.js` | 217 | Terminal input box, xterm setup |
| `updates.js` | 341 | About tab, update status, portable detection, compiler check at startup, `showToast` |
| `tab-menu.js` | 218 | Tab context menu, local-history settings fields |

Test cases (`ccProblem`, `ccTestIndex`, `batchTestResults`) describe the **active tab**;
`setActive()` saves them to `tab.testState` and loads the next tab's.

## 10. Where to change what

| To change... | Go to |
|---|---|
| Compile / run | `app/services/compiler/executor.js`, `app/ipc/compiler-handlers.js` |
| Compiler detection | `app/services/compiler/detector.js`, `app/shared/platform.js` |
| Debugger | `app/services/debugger/`, `app/ipc/debug-handlers.js`, `src/features/debugger/debugger-ui.js` |
| IntelliSense | `app/services/syntax/clangd-service.js`, `src/features/suggestions/cpp-suggestions.js` |
| An IPC channel | `app/shared/constants.js` → `app/ipc/*-handlers.js` → `preload.js` |
| Window, splash, dev server | `app/windows/` |
| Competitive Companion / judging | `app/services/competitive/`, `app/ipc/competitive-handlers.js`, `app/shared/judge.js` |
| Formatting | `app/services/formatter/`, `app/ipc/format-handlers.js` |
| Global UI state and init | `src/renderer/app/core.js` |
| Tabs, settings, shortcuts, panels, tests | the matching file in `src/renderer/app/` (see §9) |
| Explorer, terminal, debugger UI, checkpoints, completion | the loaded file under `src/features/` (see §4) |
| Theme colors / tokens / CSS | `theme-manager.js` / `theme-tokens.js` / `src/styles/themes/*.css` |
| Limits, flags, ports | `app/shared/constants.js` |
