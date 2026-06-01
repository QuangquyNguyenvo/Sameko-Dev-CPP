# CODEBASE.md — Sameko Dev C++

A guide to the codebase structure so newcomers (and AI tools) can get up to speed without reading every folder. Read this before diving into the code.

> Overview: **Sameko Dev C++** is a C++ IDE built on **Electron** + **Monaco Editor**, shipping a bundled **MinGW GCC** toolchain (`Sameko-GCC/`). It supports competitive-programming judging, code formatting (AStyle), realtime syntax checking (tree-sitter + GCC), Discord Rich Presence, and auto-update. Primary target: **Windows** (NSIS installer).

---

## 1. High-level architecture

The app follows the standard Electron two-process model, separated by `preload.js`:

```
┌─────────────────────────────┐      IPC       ┌──────────────────────────────┐
│   MAIN PROCESS  (app/)      │  <---------->  │  RENDERER PROCESS  (src/)    │
│   Full Node.js              │   preload.js   │  Browser, NO Node            │
│                             │  contextBridge │                              │
│  • Lifecycle, windows       │                │  • All UI                    │
│  • File system, compiler    │  window        │  • Monaco editor             │
│  • Background services      │  .electronAPI  │  • Tabs, themes, features    │
└─────────────────────────────┘                └──────────────────────────────┘
```

- **Main** (`app/`): real Node runtime with file-system access; spawns compile processes, opens dialogs. Entry: `app/main.js`.
- **Renderer** (`src/`): runs in a browser environment with **context isolation on** and **no Node integration**. Talks to main only through `window.electronAPI.*`.
- **Preload** (`preload.js`): the one file bridging both worlds; uses `contextBridge.exposeInMainWorld` to expose a safe API to the renderer.

Startup flow (`app/main.js`):
1. `v8-compile-cache` to speed up `require`.
2. `requestSingleInstanceLock()` — single instance only.
3. `app.whenReady()` → `initializeApp()` → `createMainWindow()` → `registerLegacyHandlers(mainWindow)` (registers all IPC) → init auto-update + Discord RPC.

---

## 2. Directory map

### `app/` — Main process (Electron / Node)

| Path | Responsibility |
|---|---|
| `app/main.js` | Entry point. Single-instance lock, lifecycle, IPC registration, service init. |
| `app/core/app-lifecycle.js` | `initializeApp()`, `setupAppEvents()` — app lifecycle events. |
| `app/core/window-manager.js` | Window management at the core level. |
| `app/windows/main-window.js` | Creates the `BrowserWindow` (frameless, context isolation, preload). Dev: runs a static HTTP server serving `src/`; Production: loads the packaged HTML. Persists/restores window bounds to settings. |
| `app/windows/index.js` | Barrel export for windows. |

#### `app/ipc/` — IPC handlers (grouped by domain)
`app/ipc/index.js` exports `registerAllHandlers(mainWindow)` — calls `setMainWindow` + `registerHandlers` for each group:

| File | Handles |
|---|---|
| `file-handlers.js` | Open/save/read/delete/rename files & folders, copy/move, **file watcher** (detects external changes via `fs.watch` + mtime comparison). |
| `compiler-handlers.js` | `compile`, `run`, `stop`, send stdin input, get compiler info. |
| `dialog-handlers.js` | System open/save dialogs. |
| `window-handlers.js` | Minimize / maximize / close (for the frameless window). |
| `settings-handlers.js` | Save/load `settings.json`. |
| `format-handlers.js` | Format code (AStyle), syntax check, smart suggestions. |
| `competitive-handlers.js` | Competitive Companion server, batch testing, judging. |
| `update-handlers.js` | Check/download/install updates (electron-updater). |
| `history-handlers.js` | Local history — backup before save, view/restore versions. |
| `discord-handlers.js` | Discord Rich Presence (enable/disable/update/clear). |

#### `app/services/` — Background business logic

| Path | Responsibility |
|---|---|
| `services/compiler/index.js` | Re-exports compiler utilities. |
| `services/compiler/detector.js` | Detects the bundled compiler (`Sameko-GCC/...`) and system compilers (TDM-GCC, MinGW, msys64). |
| `services/compiler/executor.js` | Spawns g++, compiles and runs the program, streams stdout/stderr. |
| `services/compiler/pch-manager.js` | Manages the precompiled header to speed up builds. |
| `services/compiler/warmup.js` | Warms up the compiler/PCH at startup. |
| `services/competitive/companion-server.js` | HTTP server that receives problems from the Competitive Companion extension (port `10043`). |
| `services/competitive/batch-tester.js` | Runs multiple test cases, compares output. |
| `services/competitive/judge-selftest.js` | Self-test for the judge. |
| `services/competitive/index.js` | Barrel export for competitive. |
| `services/formatter/astyle.js` | Wrapper that invokes AStyle. |
| `services/formatter/styles.js` | Format style presets. |
| `services/formatter/index.js` | Barrel export for formatter. |
| `services/syntax/gcc-checker.js` | Syntax checking by invoking GCC. |
| `services/syntax/tree-sitter.js` | Parses C++ with tree-sitter for suggestions/diagnostics. |
| `services/syntax/index.js` | Barrel export for syntax. |
| `services/auto-update-service.js` | Initializes electron-updater, emits update-status events. |
| `services/discord-rpc-service.js` | Connects/disconnects Discord RPC, updates presence. |

#### `app/shared/` — Shared between main & renderer

| File | Contents |
|---|---|
| `shared/constants.js` | **Source of truth.** IPC channel names (groups `FILE`, `COMPILER`, `WINDOW`, `SETTINGS`...), paths (`cpp-ide-pch`, `cpp-ide-builds`, `settings.json`, `local-history`, `snippets.json`), limits (max file 1024KB, 30s timeout, max 100 batch tests...), compiler config (bundled MinGW paths, default flags `-O0 -w`), Companion port `10043`, default window size. |
| `shared/judge.js` | `normalizeOutput()`, `compareOutputs()` — shared judging rules (also reused by preload). |
| `shared/types.js` | Shared type/JSDoc definitions. |
| `shared/validators.js` | Data validation helpers. |

### `preload.js` — Security bridge
Exposes `window.electronAPI` with groups of functions: file ops, file explorer, settings, build (`compile`/`run`/`sendInput`/`stopProcess`), window controls, event listeners (`onProcessOutput`, `onFileOpened`, `onFileChangedExternal`...), Competitive Companion, batch testing, judge utils, auto-update, format code, syntax check, local history, Discord RPC, `.sameko` contest metadata. Also loads `app/shared/judge` so renderer-side judging follows the same rules as main.

### `src/` — Renderer process (browser)

| Path | Responsibility |
|---|---|
| `src/index.html` | Root page. Loads Monaco first (via Monaco's `require` config), then loads theme/UI/feature scripts sequentially with plain `<script>` tags (NOT ES modules). |
| `src/renderer/app.js` | **Orchestrator, ~7774 lines.** Holds the global `App` state (editor, tabs, split view, run state, UI visibility flags), initializes Monaco, manages settings/themes/keybindings, wires up every feature. **Do NOT read the whole file — Grep to the needed section/function, then read by offset.** |
| `src/renderer/components/shortcuts-manager.js` | Keyboard shortcut management. |
| `src/renderer/ui/` | Renderer-level UI: `color-registry.js`, `confirm-dialog.js`, `theme-customizer.js`, `theme-manager.js`, `theme-marketplace.js`, `theme-tokens.js`. |
| `src/core/editor/editor-core.js` | Core Monaco editor logic. |
| `src/core/editor/split-manager.js` | Editor splitting / split view. |

#### `src/features/` — One folder per feature
| Feature | Main file | Does |
|---|---|---|
| Tabs | `tabs/tab-manager.js` | `TabManager` (window global) — manages tabs, open/close, state persistence. |
| Terminal | `terminal/terminal-manager.js` | `TerminalManager` — terminal I/O (xterm): write, clear, process state. |
| File Explorer | `file-explorer/file-explorer.js` | Directory tree, file operations. |
| Local History | `local-history/history-manager.js` | File version-history UI. |
| Panels | `panels/panel-manager.js` | Panel layout (golden-layout). |
| Settings | `settings/settings-manager.js` | Settings read/write & UI. |
| Snippets | `snippets/snippets-manager.js`, `snippets/snippet-editor.js` | Manage & edit snippets. |
| Suggestions | `suggestions/cpp-suggestions.js` | C++ suggestions/autocomplete. |
| Themes | `themes/theme-manager.js` | Apply/switch themes. |

#### `src/styles/` — CSS
`base.css`, `animations.css`, `components/*` (confirm-dialog, local-history, snippet-editor, suggest-fix), `themes/*` (theme.css, themes.css, goldenlayout-dark-theme.css).

#### `src/themes/builtin/` — Built-in themes (JSON)
`dracula`, `kawaii-dark`, `kawaii-light`, `monokai`, `nord`, `sakura`, and `theme-schema.json` (theme schema).

### `Sameko-GCC/` & `mingw64/` — Bundled toolchain
The MinGW GCC compiler shipped with the app. **Do not read** — thousands of generated files. `Sameko-GCC/` is copied into `extraResources` during packaging (see `package.json` > `build`).

---

## 3. Build & packaging config (`package.json`)

- `main`: `app/main.js`.
- **Scripts:** `start` (`electron .`), `dev` (with `--enable-logging`), `clean`/`clean-start` (wipe `%APPDATA%/cpp-ide`), `build:win`/`build:mac`/`build:linux`, `rebuild:win`.
- **electron-builder:** appId `com.quangquy.cppide`, output `samekodevcpp/`, `asar: false`. Packs `app/`, `preload.js`, `src/`, `node_modules/`, `mingw64/`; excludes `Sameko-GCC/` from `files` but copies it via `extraResources`.
- Windows target: NSIS (allows changing install dir, creates shortcuts). mac (dmg) and linux (AppImage/deb) configs exist, but Windows is the focus.
- **Key dependencies:** `monaco-editor` (editor), `golden-layout` (panel layout), `tree-sitter` + `tree-sitter-cpp` (C++ parsing), `xterm` + `xterm-addon-fit` (terminal), `discord-rpc`, `electron-updater`, `electron-log`, `v8-compile-cache`.

---

## 4. Runtime data (under `%APPDATA%/cpp-ide/`)
- `settings.json` — user config (including window bounds).
- `local-history/` — file backups before save (up to 20 versions/file).
- `snippets.json` — user snippets.
- `cpp-ide-pch/`, `cpp-ide-builds/` — PCH cache & temp build output.

---

## 5. Important flows (where-to-find-X)

| Want to change... | Go to |
|---|---|
| Compile / run logic | `app/services/compiler/executor.js` + `app/ipc/compiler-handlers.js` |
| Compiler detection | `app/services/compiler/detector.js`, paths in `app/shared/constants.js` |
| Add/change an IPC channel | `app/shared/constants.js` → `app/ipc/*-handlers.js` → register in `app/ipc/index.js` → expose in `preload.js` |
| Window behavior (frameless, bounds, dev server) | `app/windows/main-window.js` |
| Detecting external file changes | `app/ipc/file-handlers.js` (file watcher) |
| Competitive Companion / judging | `app/services/competitive/` + `app/ipc/competitive-handlers.js` |
| Code formatting | `app/services/formatter/` + `app/ipc/format-handlers.js` |
| Realtime syntax checking | `app/services/syntax/` |
| Overall UI state & init | `src/renderer/app.js` (Grep to the part you need) |
| Tabs / Terminal / Explorer / Settings... | `src/features/<name>/` |
| Themes | `src/features/themes/`, `src/renderer/ui/theme-*.js`, `src/themes/builtin/*.json` |
| Channel names / paths / limits / compiler flags | `app/shared/constants.js` |

---

## 6. Code conventions

- **Process boundary:** No `require('electron')` or Node APIs in `src/`. The renderer only calls `window.electronAPI.*`.
- **Dual-export pattern** (renderer modules that run in both Node and browser):
  ```js
  if (typeof module !== 'undefined' && module.exports) module.exports = Thing;
  else window.Thing = Thing;
  ```
- **Main modules:** use `'use strict'` + normal CommonJS `require`/`module.exports`.
- **Centralized constants:** don't hardcode IPC channel names or paths — pull them from `app/shared/constants.js`.
- **No automated test/lint:** test manually with `npm start`.

---

## 7. Other docs in the repo
- `README.md` — intro, features, install instructions for users.
- `CHANGELOG.md` — version history.
- `CONTRIBUTING.md` — contribution guide.
- `setup-bundled-mingw.md` — how to bundle/set up MinGW with the app.
- `CLAUDE.md` — short guidance for AI tools (quick read each session).
- `docs/` — GitHub Pages site (no need to read for core development).
