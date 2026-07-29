# CLAUDE.md

Guidance for Claude when working in this repo. Keep it short to save context.
For a deeper architecture map, read `CODEBASE.md` (full project breakdown).

## Project
**Sameko Dev C++** — a C++ IDE built with Electron + Monaco Editor, shipping a bundled MinGW GCC toolchain (`Sameko-GCC/`). Primary target: Windows (NSIS installer). App UI language: English.

## Common commands
```powershell
npm start              # Run the app (electron .)
npm run dev            # Run with logging enabled
npm run clean-start    # Wipe settings at %APPDATA%/cpp-ide, then run
npm run build:win      # Package NSIS for Windows -> samekodevcpp/
npm run rebuild:win    # Remove release_build, then rebuild
```
No test runner or linter is configured. Do not assume `npm test`.

## DO NOT read (large or generated — wastes context)
- `Sameko-GCC/`, `mingw64/` — bundled GCC toolchain, thousands of files.
- `node_modules/`, `samekodevcpp/`, `release_build/`, `dist/` — output & deps.
- `package-lock.json` — large lockfile.
- `.agent/` — internal notes (gitignored).
- `src/renderer/app.js` — **7774 lines**. Do NOT read the whole file. Always use CodeGraph first to locate specific functions or sections.

## Plans folder
- `plans/` is **gitignored** — a working area for phased implementation plans, not committed.
- Organize by feature: `plans/<feature>/` — `CONTEXT.md` + `CHECKLIST.md` + `phase-NN-*.md`.
- Each phase file is written to be **self-contained** (paths, current-code snippets, conventions,
  acceptance criteria) so a fresh session can execute one phase without prior conversation context.
- **Read `PLANNING.md` (repo root) before creating or executing any plan** — it defines the folder
  layout, phase sizing, risk ratings, and the mandatory `## Deviations` / measurable-acceptance rules.
- Existing plans (`debugger/`, `linux-support/`, `theme-customizer/`) use a merged `00-OVERVIEW.md`;
  leave them as they are.

## Code Intelligence (CodeGraph)
This repository is indexed by CodeGraph. Do **NOT** use grep/find unless CodeGraph fails.
- **MCP Tool**: Prefer `codegraph_explore` (returns verbatim source and callpaths).
- **CLI Commands**:
  - `npm run codegraph:status` — Show index status and stats
  - `npm run codegraph:sync` — Sync changes after editing files
  - `codegraph explore "<symbol_or_query>"` — Locate code and trace call paths
  - `codegraph node <symbol>` — Show symbol source and dependent trail


## Layout at a glance (details in CODEBASE.md)
- `app/` — **Main process** (Electron/Node). Lifecycle, windows, IPC handlers, services (compiler, competitive, formatter, syntax, discord, auto-update).
- `preload.js` — Security bridge; exposes `window.electronAPI` via contextBridge.
- `src/` — **Renderer process** (browser, NO Node). UI, editor, features. Loaded from `src/index.html` via plain `<script>` tags (not ES modules).
- `app/shared/constants.js` — Source of truth for IPC channel names, paths, limits, compiler config.

## Key conventions
- **Process boundary:** Main (`app/`) uses normal Node `require()`. Renderer (`src/`) runs in the browser and only talks to main through `window.electronAPI.*` (defined in `preload.js`). Never `require('electron')` inside `src/`.
- **Dual-export pattern:** modules in `src/` typically export like:
  ```js
  if (typeof module !== 'undefined' && module.exports) module.exports = Thing;
  else window.Thing = Thing;
  ```
  Keep this pattern when editing renderer modules.
- **Adding a new IPC:** (1) declare the channel name in `app/shared/constants.js`, (2) write the handler in `app/ipc/*-handlers.js` and register it in `app/ipc/index.js`, (3) expose the matching function in `preload.js`.
- **Settings** live at `%APPDATA%/sameko-dev-cpp/settings.json` (folder name comes from package.json's `name`, not the product name). Local history & snippets are in the same folder.

## Git & GitHub Credentials
- **Commit Identity**: **NEVER** commit under the AI's name or alter configuration to represent an AI agent. Always commit using the user's local git identity (`user.name`/`user.email`).
- **Authentication**:
  - If GitHub CLI (`gh`) is available, use it for GitHub requests (e.g. issues, PRs).
  - If `gh` is unavailable, programmatically query Git Credential Manager via `echo "url=https://github.com" | git credential fill` to get the OAuth token for API requests. Do not print or log the token.

## When editing code
- Read related code before writing; follow the existing style.
- Editing a renderer feature → look in `src/features/<name>/`.
- Editing compile/run logic → `app/services/compiler/` and `app/ipc/compiler-handlers.js`.
- Build/test manually with `npm start` since there is no automated suite.

## Theme system (SSOT — do NOT re-hardcode)
- **Builtin theme colors:** edit only `ThemeManager._getHardcodedThemes()` in `src/renderer/ui/theme-manager.js`. There is no JSON theme source.
- **New token:** add it to `ThemeTokens.definitions` in `src/renderer/ui/theme-tokens.js` (+ a value in each of the 6 themes), then reference `var(--<cssVar>)` in CSS.
- **CSS:** style via `var(--token)`. For dark-only styling use `[data-theme-variant="dark"]`, never `[data-theme="<builtin-id>"]` (that breaks custom themes). See `CODEBASE.md` › Theme system and `plans/theme-customizer/`.
