# AGENTS.md

The single source of AI-agent rules for this repo. Codex reads it directly; `CLAUDE.md` imports it.
Edit rules here only. `CODEBASE.md` is the architecture map — open it when you need to find where
something lives, not every session.

## Project
**Sameko Dev C++** — a C++ IDE on Electron 28 + Monaco, with a bundled MinGW GCC toolchain
(`Sameko-GCC/`), a GDB debugger and clangd IntelliSense. Windows is the primary target (NSIS
installer + portable zip); Linux (AppImage/deb) is supported. App UI language: English.

## Commands
```powershell
npm start               # run the app
npm run dev             # run with logging
npm run clean-start     # wipe user data, then run
npm run test:debugger   # MI-parser unit tests + GDB end-to-end (skips if gdb is absent)
npm run test:gui        # Playwright smoke test: boot, Monaco mount, theme tokens, failed loads
npm run build:win       # package NSIS + zip -> samekodevcpp/
npm run codegraph:sync  # refresh the code index after adding/renaming symbols
```
There is no `npm test` and no linter.

## Context budget
- **Never read:** `Sameko-GCC/`, `mingw64/`, `node_modules/`, `samekodevcpp/`, `.codegraph/`,
  `package-lock.json`, `src/assets/`.
- **Never read whole — locate the symbol, then read a range:** `src/styles/themes/theme.css`
  (~7800 lines), `src/features/file-explorer/file-explorer.js` (~5400),
  `src/renderer/ui/theme-customizer.js` (~5200), `src/styles/themes/themes.css` (~4300),
  `src/features/debugger/debugger-ui.js` (~1800), `CHANGELOG.md`. The app logic is split across
  `src/renderer/app/*.js` (100–1100 lines each); open only the file `CODEBASE.md` §9 points to.
- `docs/` is the sameko.dev website and `plans/` is working state; open them only when the task is
  about them.
- **Before exploring, read `CODEBASE.md` §8–§9**: they describe how compile, run, live check, tabs
  and persistence actually behave, with a file index for `src/renderer/app/`, so those flows do not have to
  be re-derived from source. Known defects and their line numbers are in
  `plans/code-audit/FINDINGS.md` (local, gitignored).

## Finding code
The JS is indexed by CodeGraph. Use it before text search for anything symbol-shaped:
```powershell
codegraph explore "<symbol or question>"   # relevant source + call paths
codegraph node <symbol>                    # one symbol's source, callers and callees
codegraph callers <symbol>                 # also: callees, impact
```
If the session exposes the CodeGraph MCP tools (`codegraph_explore`, `codegraph_node`), they return
the same output. Use plain text search for what the index does not cover: CSS, HTML, string
literals, IPC channel names.

## Invariants
- **Process boundary.** `app/` is the main process (Node, CommonJS, `'use strict'`). `src/` is the
  renderer: a browser with context isolation and no Node. It reaches main only through
  `window.electronAPI.*` from `preload.js`. Never use `require('electron')` or Node APIs in `src/`.
- **Renderer scripts are plain `<script>` tags**, not ES modules, loaded in order by
  `src/index.html`. A new renderer file needs a tag there, placed after what it depends on.
- **Dual export.** Renderer modules end with
  `if (typeof module !== 'undefined' && module.exports) module.exports = Thing; else window.Thing = Thing;`
  Keep it when editing them and use it in new ones.
- **Adding an IPC channel** takes three edits: the name in `app/shared/constants.js` (`IPC.<GROUP>`),
  the handler in `app/ipc/<domain>-handlers.js` (a new handler file must also be registered in
  `app/ipc/index.js`), and the bridge function in `preload.js`. Handlers reference `IPC.*`;
  `preload.js` repeats the literal string, so keep the two identical.
- **Cross-platform.** Do not hardcode `.exe`, `NUL`, drive paths or `taskkill`. Use the helpers in
  `app/shared/platform.js` (`binName`, `NULL_DEVICE`, `appTempDir`, `which`, `killPosixTree`, ...).
- **Themes have one source.** Builtin colors live only in `ThemeManager._getHardcodedThemes()`
  (`src/renderer/ui/theme-manager.js`); there is no JSON theme source. A new token goes in
  `ThemeTokens.definitions` (`src/renderer/ui/theme-tokens.js`) with a value in each of the six
  builtin themes, and CSS reads it as `var(--token)`. For dark-only styling use
  `[data-theme-variant="dark"]`, never `[data-theme="<builtin-id>"]`, which breaks custom themes.
- **User data** is in Electron's `userData` folder, named after `package.json`'s `name`:
  `%APPDATA%/sameko-dev-cpp/` on Windows (`settings.json`, `local-history/`, `snippets.json`).
- **Escape before `innerHTML`.** Compiler messages, file names, test data, theme names and
  `.sameko` contents are untrusted and routinely contain `<` (`vector<int>`). Use `textContent`, or
  wrap every interpolated value in `escHtml()` (global, defined once in `src/renderer/boot.js`).
- **No inline scripts or `on…=""` attributes.** The page's CSP blocks them; attach listeners in JS.
- **One Monaco model per tab.** Switch files with `showTabInEditor()` / `setActive()`, replace a
  tab's text with `setTabText()`; never `editor.setValue()` to change which file is shown (it wipes
  undo history). Keyboard shortcuts go in `ACTION_HANDLERS` + `DEFAULT_SETTINGS.keybindings`, never
  `editor.addCommand`.
- **`settings.json` is written only through `app/shared/settings-store.js`.** Other data that must
  survive a restart goes through `electronAPI.stateRead/stateWrite` (files under `userData/state`),
  not `localStorage`; images and videos go through `electronAPI.saveThemeAsset`.
- **After changing IPC**, run `node plans/code-audit/tools/ipc-check.js`: it must report nothing
  unused or unhandled.
- **Processes are killed by handle/PID, never by image name.**
- **Only renderer files listed in `src/index.html` run.** Tabs, settings, shortcuts, panels and
  build logic live in `src/renderer/app/*.js` (one global scope, fixed load order — see
  `CODEBASE.md` §9). A new file needs its own `<script>` tag in the right position.
- **UMD libraries after Monaco's `loader.js`** register as anonymous AMD modules instead of
  setting `window.*`. Load them through the AMD loader (`require.config({ paths })` +
  `require([...])`), as `TerminalManager.loadXterm()` does for xterm.
- **Keep startup light.** Main-process modules not needed to show the editor (updater, Discord,
  logging) are `require`d on first use; background g++ work and services start from
  `startDeferredWork()` in `app/main.js`, after the page has loaded. Do not add work before that.

## Verifying a change
Run the check that covers what you touched: `npm run test:debugger` for `app/services/debugger/`,
`npm run test:gui` for startup, renderer wiring or themes. Anything else needs `npm start` and a
manual look. In the final report, say which of these ran and what was left unverified.

`npm start` uses the developer's real profile (open tabs, session, settings). To drive the app
without touching it, launch with `--user-data-dir=<temp dir>`, as `plans/code-audit/tools/probe.js`
does. Startup time and memory: `node plans/code-audit/tools/perf8.js 3 [packagedExe]`.

Packaging changes (`package.json` › `build`, the `Sameko-GCC` filter, a toolchain update): run
`npx electron-builder --win dir -c.directories.output=<short temp dir>`, then
`node scripts/check-toolchain-deps.js <dir>/win-unpacked/resources/Sameko-GCC` and
`node plans/code-audit/tools/probe9.js "<dir>/win-unpacked/Sameko Dev C++.exe"` (compile, run,
OpenMP, LTO, clangd, AStyle, gdb). Keep the output path short: past ~120 characters before
`Sameko-GCC`, g++ cannot open its own headers (MAX_PATH).

## Git and GitHub
- Commit only when asked, and always under the user's local git identity (`user.name` /
  `user.email`). Never commit as an AI agent or change git config to do so.
- Commit messages follow Conventional Commits (`feat(terminal): ...`, `fix: ...`, `build: ...`).
- Use `gh` for GitHub requests. If it is unavailable, get a token with
  `echo "url=https://github.com" | git credential fill` and never print or log it.

## Plans
`plans/` is gitignored working state. Work that fits one session needs no plan file. Read
`PLANNING.md` before creating, auditing or executing a persistent plan.
