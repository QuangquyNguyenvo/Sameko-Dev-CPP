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
- `src/renderer/app.js` — **7774 lines**. Do NOT read the whole file. Grep for the function/section you need, then read by `offset`/`limit`.

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
- **Settings** live at `%APPDATA%/cpp-ide/settings.json`. Local history & snippets are in the same folder.

## When editing code
- Read related code before writing; follow the existing style.
- Editing a renderer feature → look in `src/features/<name>/`.
- Editing compile/run logic → `app/services/compiler/` and `app/ipc/compiler-handlers.js`.
- Build/test manually with `npm start` since there is no automated suite.
