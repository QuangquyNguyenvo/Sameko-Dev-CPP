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

Startup (`app/main.js`): Node compile cache (`module.enableCompileCache`) → single-instance lock → `setupAppEvents()` →
`app.whenReady()` → splash window → `initializeApp()` (dirs, compiler detection) →
`createMainWindow()` → register all IPC handlers (`app/ipc/index.js`) → the main window is
revealed on `ready-to-show` (10 s fallback) and the splash closes. Only after the page's
`did-finish-load` does `startDeferredWork()` start the compiler warm-up, run-launcher and PCH
builds, and 1.5 s later auto-update and Discord RPC. `electron-updater`, `electron-log` and
`discord-rpc` are required on first use, not at startup (they were ~170 ms of module loading).

The main window loads `app://app/src/index.html`, in development and when packaged
(`app/core/app-protocol.js` serves the app root; Chromium keeps a V8 code cache only for http(s)
and custom schemes with `codeCache`, not for file://). Such a page may not load `file://` URLs:
pictures, video and audio on disk (theme backgrounds, Markdown media) go through
`app://app/@local?u=<file URL>` / `?p=<path>` — wrap a stored `file://` URL or path in
`localUrl()` (`boot.js`) where it enters the DOM or `fetch`. The Markdown preview drops
network-share sources (`isNetworkPath()`), so opening a file never connects to an SMB host. The splash window still uses `loadFile`. Navigation away from the page
and `window.open` are denied in `app/windows/main-window.js`.

## 2. Main process — `app/`

| Path | Responsibility |
|---|---|
| `main.js` | Entry point: lifecycle, splash, IPC registration, service init. |
| `core/app-lifecycle.js` | `initializeApp()` (creates user-data and temp dirs), `setupAppEvents()`. |
| `windows/main-window.js` | The frameless `BrowserWindow`, navigation guards, saved window bounds. |
| `windows/splash-window.js` | Splash shown while the main window loads (`src/splash.html`). |

### `app/ipc/` — one handler file per domain
`index.js` exports `registerAllHandlers(mainWindow)`, which wires every file below.

| File | Handles |
|---|---|
| `file-handlers.js` | Open/save/read/delete/rename, directory listing, external-change watcher. Saves are atomic (`fs-atomic.js`); `watchWanted` (what the renderer asked to watch) is kept apart from the native watcher, which a save closes until its last overlapping write ends. |
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
| `compiler/languages.js` | Python, Java, Kotlin, Rust, Go, Pascal, JavaScript: finds the machine's compiler/interpreter (PATH, the registry's PATH, usual folders, `settings.languages.<id>.path`), builds into `<temp>/cpp-ide-builds/lang/`, and `runCommand()` turns a build into the command that starts it. |
| `compiler/run-launcher.js` | Builds (once per toolchain) and locates `sameko_run.exe`, the Windows helper that runs a program and reports its wall time, CPU time and peak memory. |
| `debugger/gdb-session.js` | Drives GDB over the MI protocol. |
| `debugger/mi-parser.js` | Pure GDB/MI output parser (unit-tested by `test/e2e/debugger.js --unit`). |
| `syntax/clangd-service.js` | clangd child process, JSON-RPC over stdio. |
| `syntax/gcc-checker.js` | `g++ -fsyntax-only` check, the fallback when clangd is unavailable. |
| `competitive/companion-server.js` | HTTP listener for Competitive Companion on `127.0.0.1:27121` (the `10043` in `constants.js` is unused). |
| `competitive/batch-tester.js` | Multi-test runner (judge rules tested by `test/unit/judge.js`). |
| `competitive/checker.js` | testlib checkers: copies the bundled `app/assets/testlib/testlib.h` (0.9.41, MIT) to a temp folder that `executor.js` and clangd add with `-idirafter`, and `runChecker()` (`checker in out ans`, exit code = verdict). |
| `formatter/astyle.js`, `formatter/styles.js` | AStyle wrapper; style presets. |
| `auto-update-service.js`, `discord-rpc-service.js` | electron-updater; Discord RPC. |

### `app/shared/`

| File | Contents |
|---|---|
| `constants.js` | IPC channel names (`IPC.<GROUP>`), path names, window defaults. `LIMITS`, `COMPILER` and `COMPETITIVE_COMPANION` are declared but not read by the code that does the work. |
| `platform.js` | OS helpers: `IS_WIN`/`IS_LINUX`, `binName`, `NULL_DEVICE`, `which`, `appTempDir`, `killPosixTree`, `killProcessTree` (a child and everything it started, by PID), system compiler paths. |
| `fs-atomic.js` | `writeFileAtomic` / `writeFileAtomicSync`: write a temp file next to the target, then rename over it (in-place fallback where rename cannot replace). Used for saves and `.sameko`. |
| `settings-store.js` | The only reader/writer of `settings.json`: atomic write, `.bak` fallback, keeps main-owned keys (`windowBounds`) when the renderer saves. |
| `settings-reader.js` | Compiler settings for main-process services, read through the store. |
| `judge.js` | `normalizeOutput()`, `compareOutputs()`; also loaded by `preload.js` so both sides judge alike. |
| `exit-codes.js` | `describeExit(code, signal)`: name and usual cause of a crash code (0xC00000FD stack overflow, 0xC0000409 abort/assert/uncaught exception…), `describeStartError(winError)`: why Windows would not start a program (antivirus, policy). English; the renderer translates. |
| `types.js`, `validators.js` | JSDoc types; input validation. |

## 3. `preload.js`
Exposes `window.electronAPI`: file ops, explorer, settings, build/run, debugger, window controls,
main→renderer events, Competitive Companion, batch testing, judge utils, auto-update, formatting,
syntax/clangd, local history, Discord RPC.

## 4. Renderer — `src/`

| Path | Responsibility |
|---|---|
| `index.html` | Root page. Loads every script in order with plain `<script>` tags; `core.js` then loads the Monaco bundle. |
| `splash.html` | Splash screen. |
| `renderer/app/*.js` | The application itself, 18 files loaded in a fixed order (formerly one 7,900-line `app.js`). File index in §9. |
| `renderer/boot.js` | Loaded first: error hooks, `loadScript()` (one-time script/module loader), shared `escHtml`. |
| `vendor/monaco/` | Generated, gitignored: the Monaco ESM bundle built by `scripts/build-monaco.js` (`npm start`, `npm test`, `npm run test:gui` and every `build:*` run it). `vim.js` (monaco-vim) is a second entry sharing its chunks, imported only when Vim Mode is on. |
| `renderer/ui/` | `theme-manager.js` (logic) + `theme-manager-builtins.js` (builtin theme data, `_getHardcodedThemes()`), `theme-tokens.js`, `theme-customizer.js` (draft/history/save), `theme-customizer-view.js` (controls/scoped IDE preview), `theme-marketplace.js`, `confirm-dialog.js`, `motion.js`. |
| `styles/` | `base.css` (imports `animations.css` and fonts), `components/*.css`, `themes/theme.css` + `themes/theme-{layout,editor,dock,tests,explorer,contest,categories}.css` (the app stylesheet, one cascade in eight files, linked in that order), `themes/themes.css` + `themes/themes-{dark-panels,sakura,marketplace}.css` (theme-variant styling, same arrangement). `components/toolbar.css` and `components/islands.css` load after `themes.css`: the header buttons, and the floating-card layout (header islands, editor / bottom panel / status bar cards, Run split button, collapsed bottom panel) for every theme. |
| `assets/` | Fonts, icons, backgrounds (five looping `.webm` + one `.jpg`), screenshots (README only). |

### Loaded scripts, in order (`index.html`)
`renderer/boot.js` (error hooks, `loadScript`, shared `escHtml`) → `renderer/i18n.js` → `renderer/locales/{vi,zh-CN}.js` → `features/suggestions/cpp-suggestions.js` →
`features/snippets/snippet-editor.js` → `renderer/ui/theme-tokens.js` →
`theme-manager.js` → `theme-manager-builtins.js` → `theme-marketplace.js` → `theme-customizer-view.js` → `theme-customizer.js` → `confirm-dialog.js` → `motion.js` →
`features/local-history/history-manager.js` → `features/file-explorer/file-explorer.js` and its parts `file-explorer-{tree,menus,approaches,contest,categories,category-ui}.js` →
`features/terminal/terminal-manager.js` → `features/debugger/debugger-ui.js` → `renderer/app/*.js` in
the order of §9.

| Feature | File | Global |
|---|---|---|
| Completion + hover (clangd, snippets) | `features/suggestions/cpp-suggestions.js` | `registerCppIntellisense` |
| Snippets: settings list, per-language `lang` (none = C/C++), suggestions outside C/C++ | `features/snippets/snippet-editor.js` | `renderSnippetsList`, `editSnippet`, `snippetAppliesTo`, `registerSnippetCompletions` |
| Local history / checkpoints | `features/local-history/history-manager.js` | `LocalHistory` |
| Explorer, categories, contest mode | `features/file-explorer/file-explorer.js` (state, persistence, directory loading, contest/approach metadata) + `file-explorer-tree.js` (render), `-menus.js` (context menus, dialogs, rename/delete/open), `-approaches.js`, `-contest.js`, `-categories.js`, `-category-ui.js`; each part is `Object.assign(FileExplorer, {…})` | `FileExplorer` |
| Terminal output (xterm, display only; xterm.js is loaded with `loadScript` when the page is idle or on the first write, earlier writes are queued) | `features/terminal/terminal-manager.js` | `TerminalManager` |
| Debugger panel, breakpoints, variables | `features/debugger/debugger-ui.js` | `Debugger` |
| GSAP effects (menu cascade, Settings pop-in, Run result); GSAP is loaded with `loadScript` once the editor is ready, and every call is a no-op in Performance Mode or with reduced motion | `renderer/ui/motion.js` | `Motion` |

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

### Interface language
- `renderer/i18n.js` (`I18n`) translates the page in place. App code keeps writing **English**;
  each locale file maps the English text to its translation (`I18n.register('vi', {...})`, keys
  with `{0}` are templates). Once a non-English language is on, a MutationObserver translates every
  text node and the `title`/`placeholder`/`aria-label`... attributes the app adds later; in English it
  costs nothing (no observer). Monaco, xterm, inputs, `pre`, file/tab names, debugger values, diff
  lines and anything under `translate="no"` / `data-i18n-skip` are skipped (`I18n.SKIP`).
- Setting: `appearance.language` (`en` default | `vi` | `zh-CN`), applied in `core.js` right after
  `loadSettings()` and on Settings save. Any other value (the old `auto`) resolves to English.
  Picked with flag buttons (`renderLanguagePicker()` in `settings.js`) over a hidden `#set-language`.
- `I18n.t('English {0}', x)` is for text that never reaches the DOM as-is.
- Installer: `package.json` › `build.nsis.installerLanguages` + the `LangString`s in `installer/installer.nsh`.

### Theme system
- **Data:** `ThemeManager._getHardcodedThemes()` (in `theme-manager-builtins.js`) defines the eleven builtin themes (`kawaii-dark`,
  `kawaii-light`, `sakura`, `dracula`, `monokai`, `nord`,
  `catppuccin-mocha`, `gruvbox-dark`, `crimson`, `event-horizon`, `pixel-night`) inline; the list of ids is
  `ThemeManager.builtinThemeIds`. Every builtin has a background picture or video; a theme with
  `appBackground: ''` shows the fallback gradient (editorBg -> bgOceanDark).
- **Tokens:** `ThemeTokens` maps each token to a CSS variable and type, holds defaults
  (`fillDefaults`) and is the single apply path (`applyToElement` / `applyValue` / `applySyntax`).
- **Apply:** `ThemeManager.setTheme(id, {editorScheme})` sets the variables on `:root`, sets
  `data-theme` and `data-theme-variant` (light/dark) and applies the Monaco theme.
- **Persistence:** custom themes and builtin background overrides share `userData/state/themes.json`
  through `electronAPI.stateRead/stateWrite`; old localStorage keys migrate after a successful write.
- **Customizer:** a separate draft owns history and validation. The dialog reuses the Settings
  popup's classes (`.settings-*`, `.setting-row`, `.btn-save`); its Shadow DOM preview is a scaled
  copy of the islands layout fed with all `ThemeTokens`. Editing never changes the active Monaco theme.
  `test/gui/theme-customizer.js` (part of `npm test`) covers editing, save/restart, backgrounds and portable export on an isolated profile.

## 5. Everything else at the root

| Path | What it is |
|---|---|
| `Sameko-GCC/` | Bundled toolchain (gitignored). Copied into the Windows build as an extra resource. |
| `scripts/` | `clean.js`, `build-appimage.js`, `build-icons.js`, `check-toolchain-deps.js`, `patch-toolchain-utf8.js` (gives binutils the UTF-8 code page, §6). |
| `test/` | Every test suite (`test/README.md`). `run.js` is the runner and its `SUITES` list (`npm test`, `node test/run.js <group or word>`); `unit/` plain Node (theme tokens/manager/customizer state, judge rules, crash names, OJ bridge), `gui/` the real app on a temp profile (`app.js` boot, editor state, Build & Run; `theme-customizer.js`; `checker.js`), `e2e/debugger.js` (`--unit` MI parser / `--e2e` gdb), `helpers/app.js` launch + PASS/FAIL for new gui suites. |
| `docs/` | The sameko.dev website (landing page and wiki). Not part of the app. |
| `plans/` | Gitignored working plans. |
| `samekodevcpp/` | electron-builder output (gitignored). |
| `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md` | User and contributor docs (`CONTRIBUTING.md` also covers placing the bundled compiler). |

## 6. Packaging (`package.json` › `build`)
- electron-builder, `asar: true`, output `samekodevcpp/`, appId `com.quangquy.cppide`.
- Packaged files: `app/`, `preload.js`, `src/`, `node_modules/` (trimmed by the exclusion list:
  Monaco is not packaged from `node_modules` (it is a devDependency); `src/vendor/monaco/` holds
  the esbuild bundle, without the TypeScript/JSON/CSS/HTML language services, the LSP client and
  the diff editor. Basic-language tokenizers are lazy chunks (the Markdown preview colours code
  blocks with them). `electronLanguages: ["en-US"]` keeps one Chromium locale.
- Windows: NSIS installer + zip, x64, with `Sameko-GCC/` as an extra resource. Its `filter` drops
  what the IDE never runs (Fortran/Objective-C compilers, `ld.lld`, WinLibs extras such as ccache,
  nasm, ninja, the `wl-*` package manager, the DLLs only they import, Python's test suite,
  GCC plugin headers, `.idl` files): 894 → 540 MB. The DLL list was derived from PE imports;
  after editing the filter or updating the toolchain, build `--win dir` and run
  `node scripts/check-toolchain-deps.js` — it fails if any kept binary imports a dropped DLL,
  or if `as`/`ld`/`collect2`/`lto-wrapper` lack the UTF-8 code-page manifest that
  `scripts/patch-toolchain-utf8.js` embeds (without it nothing builds under a folder name such
  as `C:\Users\Nguyễn\…`, which is both `%TEMP%` and the default install folder; gdb is left
  alone: with UTF-8 its string printing breaks).
  Runtime DLLs a user's program may need (`libgomp`, `libquadmath`, `libatomic`, `libssp` and
  their dependency `libdl`) are kept on purpose.
- `npm run build:win` is `scripts/build-win.js`: the NSIS installer with the toolchain split out,
  then the zip packed from that same `win-unpacked` (`--prepackaged`) with the toolchain put back:
  electron-builder writes `resources/app-update.yml` (where to look for updates) only in a run
  that builds the installer, so a zip built in a run of its own never saw an update. The `afterPack` hook `scripts/toolchain-package.js` (active only with
  `SAMEKO_SPLIT_TOOLCHAIN=1`) names the filtered toolchain by content
  (`gcc-<version>-<hash>`), packs it once into `build/toolchain/<id>.7z` (~60 MB) and moves it out
  of the app package. `installer/installer.nsh` extracts it only when
  `resources/Sameko-GCC/.sameko-toolchain` names another id (or is missing), and on an update its
  uninstaller keeps that folder. An update with the same GCC takes ~20 s instead of ~1 min;
  installed paths are unchanged. A plain `electron-builder --win nsis` still packs the toolchain
  in the app package (the installer then drops the stamp). Updates from 1.4.x reinstall it once,
  since their uninstaller removes the whole folder.
- "Restart to update" runs the installer with its progress page only (Welcome/Finish skipped),
  unless the install folder does not contain the product name (a `/S /D=` deployment): the wizard
  would move it into a subfolder, so that one is updated silently.
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
- Flags are assembled in the renderer by `buildCompileFlags()`; the default is `-O0 -g0` (tests: -O2), and
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
- The INPUT panel is sent as one block 20 ms after start; the terminal input box sends its whole
  text in one IPC (Enter on an empty box sends an empty line).
- Judging uses only the program's stdout, captured per run in `build.js` (`beginRunCapture` /
  `captureRunOutput`, capped at 8 MiB, tied to the tab that ran). stderr is captured beside it
  (`captureRunStderr`, 1 MiB) for the Stderr card, shown when non-empty. The terminal keeps no copy of
  its lines (`TerminalManager.getLines()` reads xterm's buffer on demand, for probes). The
  Expected diff draws at most `DIFF_MAX_ROWS` lines plus `DIFF_MAX_MISMATCHES` mismatches.
- A crash is named: `process-exit` carries `crash` (`exit-codes.js`), printed under "--- Exit ---".
  When the launcher cannot start the program it writes `{startError}` (CreateProcess's error)
  and exits 126; a spawn Windows refuses throws "spawn UNKNOWN" (caught); an `.exe` built this
  session that is missing at Run time is reported as quarantined (`wasBuiltThisSession`).
- Windows builds link with `-Wl,--stack=268435456` (Settings › Compiler › Large Stack, default on,
  added by `buildCompileFlags()`); the build cache treats that flag as cacheable.
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
- One clangd process, started by the first completion, hover or live-check request (the first
  C++ tab shown asks for completions); with no C++ tab it never runs. A request
  carries the full document; it is forwarded (`didOpen`, then `didChange`) only when the text
  differs from what clangd has, and `clangd-close-document` sends `didClose` when a tab closes.
  Flags (standard, MinGW target, include paths, `-Wall -Wextra`, extra flags) are sent as
  `fallbackFlags` in the LSP `initialize` request; clangd is restarted when Settings change them
  or `editor.argumentPlaceholders` (off adds `--function-arg-placeholders=0`).
  Nothing is written to the machine-wide clangd config any more (a file left by an older version
  is removed if it still carries the app's marker).

**Debug** (`Debugger.start` → `compile` with `-g -O0` and its own PCH → `debug:start`)
- `GdbSession` drives `gdb --interpreter=mi3`; program I/O is redirected to temp files and polled
  every 120 ms; stdin comes from the INPUT panel only.
- `debugger-ui.js` keeps decoration state per editor (`paneState`): breakpoints, the current line
  and gutter clicks work in both split panes, and F5 debugs the focused pane's tab.
- Every stop sends frames and locals in one `debug:stopped` event; the UI then creates the GDB
  variable objects of the frame in one batched call (`debug:varCreateMany`) and patches values with
  `-var-update` on later stops in the same frame.

**Opening files**
- Dropping OS files onto the app opens tabs through `initFileDrop()` / `openFileFromPath()`;
  Input and Explorer category drop targets keep their own behavior. Multiple files open in drop order.
- Ctrl+O starts in the active file's folder (else the Explorer folder, else the folder of the last
  dialog). Its filters include write-ups and test data (`.txt .md .inp .out .ans …`).
- Files on the command line ("Open with", a second launch while the app runs) go through
  `app/services/launch-files.js`: the first launch's are fetched by the renderer with
  `getLaunchFiles()` after the session restore; later ones arrive as `file-opened` events.

**Tabs and editors**
- `languageForFile()` (`core.js`) picks the model language from the extension: C/C++ and untitled
  tabs are `cpp`, `.md` is `markdown`, the other languages their Monaco id (`OTHER_LANGUAGES`),
  everything else `plaintext`. `isCppTab()` gates Build,
  live check, Format and clangd; `.md`/`.txt` wrap lines and text files do not flag non-ASCII
  letters. `renderTabs()` re-syncs the language after a rename or Save As.
- Markdown preview (`src/features/markdown/markdown-preview.js`): `createEditor` attaches one
  `.md-preview` element per editor pane; it follows the pane's model (`onDidChangeModel`), so a
  `markdown` tab shows it unless `tab.mdPreview === false`. marked + DOMPurify load with
  `loadScript` on first use; the two sides scroll independently (by request). A re-render sanitizes
  only changed top-level blocks (`state.cache`) and `patch()` swaps only those DOM nodes. Links
  go to `electronAPI.openExternalLink` (http/https/mailto only) or open a tab.
- `App.tabs[]` holds `{id, name, path, content, original, modified, viewState, exePath, model}`.
  **Each tab owns a Monaco model** (`getTabModel`); showing a tab is `editor.setModel`, so undo
  history, markers and scroll state stay with the file, and one tab shown in both split panes is one
  live document. Use `showTabInEditor`, `setTabText` (replace text from outside) and
  `disposeTabModel`; do not call `editor.setValue()` to switch files. Once a tab has a model,
  `tab.content` is an accessor that returns the model's text on demand (`bindTabContent`); the
  change handler only updates `tab.modified` (a length check first, then a text compare), once
  per change even when both panes show the file.
- Editor-owned decorations (`deltaDecorations` on an editor) live on the model it shows:
  `clearEditorDecorationsBeforeSwitch()` (`Debugger.onFileHidden()`) runs before a model is
  swapped and `Debugger.onFileShown()` after. Build error lines are model decorations on the built
  tab (`highlightErrorLines(tab)`, only problems whose file is that tab's), cleared by an edit of
  that file or the next build. `App.problemsTabId` names the tab `App.problems` belong to.
- Each editor has an owned placeholder model (`editor.__emptyModel`) shown when no tab is open.
- Keyboard shortcuts: one capture-phase `document` keydown handler (`initShortcuts`) maps combos
  through `currentShortcutMap` to `ACTION_HANDLERS` and stops propagation when it handles a key,
  so the table in Settings wins over Monaco's built-ins. Do not add `editor.addCommand` bindings.
  Vim Mode (`settings.editor.vimMode`) switches the table to its own profile,
  `settings.keybindingsVim` (`keybindingProfile()`), which moves Ctrl+D/O/W/E/T/J off so Vim gets
  them; Settings › Keybindings edits the profile the Vim Mode switch selects.

**Batch tests** (`runAllTests` → `run-test` IPC → `batch-tester.runTest`)
- One warm-up run, then the tests run on a pool of up to 4 workers
  (`settings.execution.parallelTests`, default on); a test that timed out or used more than 60% of
  the limit is re-run alone. Each test goes through the run launcher, output is capped at 16 MB.
- A test with a blank expected output is `RAN` (ran cleanly, not judged): not AC, not failed, and
  it never marks a contest problem solved.
- Judged like Codeforces: the tests are built with at least -O2 (`buildCompileFlags({ judge: true })`)
  into their own `…-judge.exe` (`compile({ variant: 'judge' })`), so Build & Run keeps its -O0 build.
  The launcher stops the program at the time limit itself, counted from the program's start; memory
  is the peak commit (memory asked for, used or not), and the memory limit (the problem's from
  Competitive Companion, else `execution.memoryLimitMB`, default 256, 0 = none) is a job limit:
  over it is `MLE`. Output is compared word by word with real numbers within 1e-6
  (`execution.compareMode` 'tokens'; 'nocase' ignores letter case; 'lines' is the strict rule), in `app/shared/judge.js`.
- **Checker** (`checker.js`): each problem may override that in `problem.checker` ('' = Settings,
  'tokens' / 'nocase' / 'lines', or `file:<path>` of a testlib checker), picked in the TESTS header
  and the STRESS setup. A checker file is compiled like the tests (`prepareChecker`), passed to
  `runTest({ checker })`, and judges every cleanly finished test, also one without an expected
  output: exit 0 AC, 1/2 WA, 7 partial (WA), anything else `FAIL` (the checker's fault). Its stderr
  line is the test's detail. A problem with only a checker and no tests is still saved in the session.

**Other languages** (`app/services/compiler/languages.js`)
- `executor.compile` hands a file whose extension is not C/C++ (`languageOfFile`) to
  `languages.build`. An untitled tab sends its name's extension (`untitledExt`) and is written to
  `<temp>/cpp-ide/untitled-<tab id>/Main.<ext>` (Java: named after the public class); other
  untitled tabs are C++ (`temp_code-<tab id>.cpp`). The + button's right-click menu and
  Settings › Code Template › New File create these tabs (`newFile(ext)`); they start from
  `settings.template.others[ext]` (the template's Other menu, saved only when changed), else
  `NEW_FILE_STARTERS`.
  Nothing is bundled: the tool comes from
  Settings › Compiler › Other Languages, else PATH (the process's and the registry's, read with
  PowerShell so a tool installed after start is found), the tool's home variable and its usual
  folders. The Microsoft Store `python.exe` stub is skipped unless it runs Python 3.
- Output per source: `<temp>/cpp-ide-builds/lang/<ascii name>-<hash of path>/` (40 kept). Rust
  (`-O`, 256 MB stack by link arg), Go (`GOTOOLCHAIN=local`, `CGO_ENABLED=0`) and Free Pascal
  (`-O2`, ASCII 8.3 paths because fpc uses the ANSI file API) leave `prog.exe`; Python and
  JavaScript are syntax-checked (`compile()` / `node --check`) and Java/Kotlin compiled, and leave
  `run.json` (`{tool, args}`). Compile errors become `problems` (each compiler's format), which
  `build.js` shows instead of parsing GCC lines. In-memory cache: same tool, flags and text.
- `runCommand(artifact, {memoryLimit, interactive})` is used by `executor.run`, `runExternal` and
  `batch-tester.runTest`: an exe is itself; `run.json` becomes the interpreter plus arguments,
  passed through the run launcher (which quotes arguments by the CRT rules). Python gets
  `PYTHONUTF8`/`PYTHONIOENCODING` (UTF-8 output) and `-u` in the terminal; a JVM gets
  `-Xss64m -XX:+UseSerialGC -Xms8m` and the memory limit as `-Xmx` (its default initial heap commits
  1/64 of the RAM, which a 256 MB limit refused).
- Renderer: `OTHER_LANGUAGES` / `languageForFile` (`core.js`) set the Monaco language;
  `isBuildableTab` gates Build & Run, Run All Tests and the stress test, `isCppTab` still gates
  clangd, live check, Format and the debugger. Settings › Compiler › Other Languages lists what was
  found (`languages-list` IPC) and saves `settings.languages.<id>.path`.

**Stress test** (STRESS tab, `stress-test.js`)
- Gen, brute force and solution are built like the tests (`variant: 'judge'`, so the solution
  shares Run All's build). Each test: the generator runs with its seed as `argv[1]` (`runTest({ args })`,
  passed on by the run launcher; plain words only), the brute force's output is the expected answer
  and the solution is judged with the problem's limits and its checker (the brute force's output is the
  answer file). Up to 4 workers like Run All;
  a TLE from a crowded run is re-run alone. Stops at the first failure (lowest test number), the
  test count or the time budget (`execution.stressTests`, `stressSeconds`). Seeds differ every run.
- Holds `isBatchTesting` while it runs. Gen and brute are picked from the files next to the focused
  tab (guessed from their names, `gen*` / `*brute*`); the failing test shows in the tab itself, and
  "Add to tests" appends it to the tested tab's tests (never into the Input/Expected boxes directly).

**Persistence**

| Data | Where |
|---|---|
| (zip build) | `userData` is `data\` next to the exe (`app/core/portable.js`, before anything reads it); first start copies settings, snippets and state from %APPDATA%. No uninstaller next to the exe = zip build: updates are only announced, with a download link |
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
| `shortcuts.js` | 253 | `ACTION_HANDLERS`, the capture-phase key handler, keybinding profiles, `formatCode` |
| `vim-mode.js` | 112 | Vim Mode: loads `vendor/monaco/vim.js`, attaches monaco-vim per editor, status bar, `:w` / `:q` |
| `layout.js` | 971 | `updateUI`, header buttons, docking Terminal and I/O into Problems, resizers, Discord presence |
| `tabs.js` | 420 | `newFile`, `setActive`, `closeTab`, `openFileFromPath`, `renderTabs`, menus, `save` / `saveAs` |
| `build.js` | 805 | `buildActiveTab` (compile / build & run), `run`, `stop`, Problems panel, `log`, `setStatus`, output diff |
| `ipc-events.js` | 144 | Handlers for events from main: file opened, process output / exit / stopped, system messages |
| `companion.js` | 643 | Competitive Companion, per-tab test state (`ccProblem`, `saveTestStateToTab`), test navigation |
| `file-watch.js` | 118 | External file changes and the reload prompt |
| `batch-tests.js` | 605 | `runAllTests`, single test, results list, `buildCompileFlags` |
| `checker.js` | 248 | How a problem's tests are judged: `problem.checker`, the TESTS-header and STRESS selects, New checker, `prepareChecker` |
| `stress-test.js` | 744 | STRESS tab of the bottom panel: generator / brute force / solution loop, `startStressTest`, Add to tests |
| `oj-submit.js` | 536 | Submit to an online judge through the Sameko browser extension (`submitToOJ`, verdict chip per tab in `tab.ojSubmission`), the extension section of the Get Tests popup, pairing prompt, theme snapshot for the extension |
| `terminal-input.js` | 217 | Terminal input box, xterm setup |
| `updates.js` | 341 | About tab, update status, portable detection, compiler check at startup, `showToast` |
| `tab-menu.js` | 218 | Tab context menu, local-history settings fields |

Test cases (`ccProblem`, `ccTestIndex`, `batchTestResults`) and the Input/Expected boxes describe
the **focused tab** (`getPreferredTabId()`: the right pane's tab when it has focus). `setActive()`
and `focusEditorPane()` save them to `tab.testState` / `App.ioByTab` and load the next tab's.
Build & Run, Run All Tests and auto-save capture their tab when they start, so switching tabs
meanwhile cannot mix two files.

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
| Submit to OJ / Sameko browser extension | `extension/` (contract: `extension/PROTOCOL.md`), `app/services/competitive/extension-bridge.js`, `src/renderer/app/oj-submit.js` |
| Formatting | `app/services/formatter/`, `app/ipc/format-handlers.js` |
| Global UI state and init | `src/renderer/app/core.js` |
| Tabs, settings, shortcuts, panels, tests | the matching file in `src/renderer/app/` (see §9) |
| Explorer, terminal, debugger UI, checkpoints, completion | the loaded file under `src/features/` (see §4) |
| Theme colors / tokens / CSS | `theme-manager-builtins.js` (colors), `theme-manager.js` (logic) / `theme-tokens.js` / `src/styles/themes/*.css` |
| Limits, flags, ports | `app/shared/constants.js` |

## 11. Browser extension — `extension/`

"Sameko Dev C++ Companion", Manifest V3, plain JS, no build step (load unpacked from the folder).
It submits the focused tab's code to an online judge inside the user's own logged-in browser tab,
reports the verdict back, and sends problems / sample tests to the app. The contract with the app
is `extension/PROTOCOL.md`; change it in the same commit as the code on either side.

```
renderer oj-submit.js ─IPC─► main extension-bridge.js ◄─HTTP 127.0.0.1:27121 /sameko/v1/*─► background/bridge.js
                                                                                              background/jobs.js ─► content/main.js ─► adapters/<id>.js
```

| File | Contents |
|---|---|
| `manifest.json` | Hosts of every supported judge appear twice: `host_permissions` and `content_scripts.matches`. The worker loads adapters from the content-script list. |
| `shared/adapters.js` | `SamekoAdapters` registry (`register`, `get`, `byUrl`, `classifyUrl`, `list`) and pure helpers: `pickLanguage`, `normalizeVerdict`, `isPendingVerdict`, `parseTimeMs`, `parseMemoryKb`. Loaded by the worker and by pages. |
| `adapters/<id>.js` | One judge each (`codeforces`, `atcoder`, `cses`, `dmoj` = VNOJ + LQDOJ + dmoj.ca). Pure `classify` / `submitUrl`; DOM `parseProblem`, `isLoggedIn`, `fillAndSubmit`, `readVerdict`, optional `readSubmitError`. No DOM access at load time. |
| `background/bridge.js` | `hello` / long poll (`POST …/poll`) / `events` client, pairing loop, reconnect and the 30 s alarm, cached theme snapshot, connection state (`disconnected`, `unpaired`, `denied`, `connected`). |
| `background/jobs.js` | Submit job per tab (`fill` → `watch`, stored in `chrome.storage.session`), tab reuse, timeouts, `fetchProblem`, auto-send, MAIN-world `setEditorText`. |
| `background/service-worker.js` | Wires bridge + jobs to `chrome.*` events. |
| `content/main.js`, `content/page-world.js` | On judge pages: asks the worker `whoami`, runs the adapter stage with the `h` helpers, watches the verdict. `page-world.js` sets Ace / CodeMirror / Monaco text in the page's own world. |
| `popup/`, `welcome/`, `_locales/` | Popup (state, toggles, recent submissions) and first-install page, coloured from the app's theme snapshot; en / vi / zh_CN. |
| `test/run.js` | Node suite with a fake `chrome` (`fake-chrome.js`) and a stub app (`stub-app.js`); in `npm test` as `extension`. |
| `test/adapter-fixtures.js` | Runs `test/adapters/<id>.cases.js` against saved judge HTML in `test/fixtures/<id>/` (Electron DOM); in `npm test` as `extension adapters`. |
| `test/mock-oj/`, `test/make-dev.js`, `test/e2e.js` | A local fake judge with a complete adapter (the worked example), a dev copy of the extension that includes it (`extension/.dev/`), and a real-browser end-to-end run (`node extension/test/e2e.js`, not in `npm test`). |

Messages inside the extension — content → worker: `whoami`, `pageInfo`, `filled`, `submitted`,
`verdict`, `failed`, `setEditorText`; worker → content: `getProblem`; popup → worker:
`popup:getState`, `popup:sendProblem`, `popup:retry`, `popup:setSetting`.

**Adding a judge:** copy `test/mock-oj/adapter.js` to `adapters/<id>.js`, add its hosts to both
lists in `manifest.json`, save real page HTML under `test/fixtures/<id>/`, write
`test/adapters/<id>.cases.js`. Nothing in the app changes: the extension tells the app which hosts
it supports in `hello`.

**Releases:** the extension ships through the browser stores only. Never publish a GitHub Release
for it: the app's auto-update and the winget workflow both read this repository's releases.
