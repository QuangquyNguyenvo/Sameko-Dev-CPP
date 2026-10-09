# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.3.1] - 2026-10-10

A rebuilt theme customizer, files that open from Windows, and proper support for write-ups and test data.

### Added

- **Open with Sameko Dev C++**: files opened from Windows Explorer or the command line now open in the IDE, in the running window if it is already open.
- **Text and test files**: `.md` is highlighted as Markdown; `.txt`, `.inp`, `.out`, `.ans` and others open as plain text.
  - In plain text, lines starting with `# ` or `//` show as comments and `[SECTION]` lines as headers. Grid input such as `#..#` stays as data.
  - `.md` and `.txt` wrap long lines, and Vietnamese letters are no longer flagged as unusual characters.
  - Live check, IntelliSense, Format and Build skip these files; the status bar shows `Markdown` or `Plain Text`.
- **Undo one color** in the theme customizer with the ↺ button on a changed row; Ctrl+Z / Ctrl+Y undo and redo.
- **Highlighted Theme JSON**, with every color value underlined in its own color.

### Changed

- **Theme customizer** rebuilt in the Settings style, more compact:
  - the live preview is a small copy of the real window, background included; click any part to jump to its color;
  - color search, HEX / RGB / RGBA input, and help moved into a **?** tooltip;
  - edits stay in the preview until you save.
- **Ctrl+O** opens in the current file's folder (or the Explorer folder, or the last folder used) instead of the system default.
- **Open and Save As** list `.txt`, `.md`, `.inp`, `.out`, `.ans` and other test files; Save As preselects the filter that matches the file name.
- **Dialogs** (confirmations, name prompts, update and Competitive Companion) match the Settings window: thicker frame, icon badge (red for destructive actions), readable body text.
- **Discord preview** in Settings looks like the real Discord profile card, with a live timer and a list of what is and is not shared. The status line uses `-` instead of `—`.
- The one-window setup is now named `sameko-dev-cpp-<version>-installer.exe` (was `Sameko-Setup-<version>.exe`), like the other downloads.
- Themes and background overrides are stored in `userData/state/themes.json` (moved over automatically). Saves are queued and failed saves are rolled back.
- Exported themes include uploaded background images and videos; importing can no longer overwrite a builtin theme.

### Fixed

- The Reset confirmation opened behind the theme customizer.
- The customizer could disappear after Reset or a quick reopen, and one click on Customize opened it twice.
- Apply JSON emptied the JSON box, and invalid JSON (such as `"appBackground": 42`) was accepted.
- Undo / Redo missed background sliders and could not redo a picked color.
- A cleared background was not saved, and saving Settings could remove a theme's background.
- Opening the customizer changed opacity values (0.4 became 0.004).
- The preview differed from the saved theme, and video backgrounds were blurred twice.
- "Copy from" another theme changed which theme Save overwrote.
- Saving another builtin theme's background switched to it without updating Settings.
- Import / Export in the customizer's Advanced tab did nothing.
- Closing the customizer reset the editor's color scheme.
- Syntax swatches showed black for themes that store colors without `#` (Nord).

## [1.3.0] - 2026-10-04

A full code audit, Electron 44, a reworked interface (floating cards, Explorer, Input / Output / Expected, dialogs) and test input from a file. Numbers were measured on the bundled GCC 16.1 toolchain (16-core Windows machine).

### Performance

- **Live Code Checking is ~10× faster**: diagnostics now come from the clangd process that already parses the open file for IntelliSense, instead of spawning `g++ -fsyntax-only` after every pause in typing. A check takes ~100–130 ms (was 1.5–2.2 s). `g++` remains the fallback when clangd is unavailable, and that path was fixed too (see below): ~0.6 s instead of ~1.5 s.
- **Accurate run time and memory**: programs are started through a small native launcher (built once with the bundled compiler) that reports the program's own wall time and peak memory as recorded by Windows. A 23 ms program used to be shown as 88–168 ms with no memory figure; it now shows ~20 ms and its real peak memory. The `tasklist` sampler it replaces cost ~150 ms per sample.
- **Run All Tests runs tests in parallel** on up to 4 workers: 8 tests went from 5.2 s to 2.7 s. Any test that times out or comes close to the limit is re-run on its own, so a time verdict is never taken from a crowded run. Set `execution.parallelTests` to `false` in `settings.json` to keep the old one-at-a-time behaviour.
- **Debug builds use a precompiled header**: the PCH is now keyed by every flag that affects it, so `-g` builds get their own instead of re-parsing `bits/stdc++.h` (1.9 s → ~0.9 s). The same fix restores the PCH for builds with `-D_GLIBCXX_DEBUG`, `-fsanitize=…` or `-Ofast` in Additional Compile Flags, which were silently compiled without it.
- **Building an unchanged file is instant**: Build & Run, Compile and Run All Tests reuse the last executable when the source, the flags and the compiler are the same as its last successful build and the file on disk is still the one that build wrote (~730 ms → ~3 ms). Anything the check cannot see — a local `#include "…"` header, or `-I`/`-L`/`-l`/`-Wl,` flags in Additional Compile Flags — always compiles again; the cache lives in memory and is empty after a restart.
- **Debugger steps faster across function calls**: all variable objects of a frame are created and deleted in one round trip instead of one per variable.
- **Smaller install**: README screenshots (16 MB), two oversized source images and the unused `golden-layout` dependency are no longer packaged; the logo shown in the splash and About is a 256 px image instead of 2508 px.
- **Downloads and the installed app are a third smaller** than 1.2.0: installer 271 → 173 MB, portable zip 370 → 238 MB, installed size 1,122 → 766 MB in 4,794 files instead of 7,589 (measured on Electron 28; the move to Electron 44 below adds ~106 MB to the installed size, and the final 1.3.0 downloads are 197 MB for the installer and 272 MB for the zip):
  - the bundled toolchain (825 → 540 MB) no longer ships what the IDE never runs: the Fortran and Objective-C compilers, `ld.lld`, the WinLibs package manager and extra tools (ccache, nasm/yasm, ninja, premake, ctags…) together with the 55 DLLs only they use, Python's test suite and IDLE/Tk (gdb's Python keeps its standard library), GCC plugin headers, `.idl` sources and static Python/Fortran libraries. The C/C++ compilers, LTO, OpenMP and the other runtime libraries a program may link, gdb, clangd and AStyle are all still there;
  - only the English Chromium locale is packaged (36 MB → 0.4 MB; the UI is English);
  - Monaco's TypeScript/CSS/HTML language services and non-English UI strings, which the editor never loads, are left out; with the removals listed above, `app.asar` is 10 MB (1.2.0: 48 MB).
- **Faster startup**: `electron-updater`, `electron-log` and `discord-rpc` were loaded before the window could answer the page — ~170 ms of the ~220 ms the main process spent loading modules. They are now loaded when first used, and the compiler warm-up, PCH build, update check and Discord connection start only after the window has loaded, so on a slow machine they no longer compete with the editor while it opens. The output terminal (xterm.js, ~140 ms of the page's start-up work) is loaded when the window is idle or on the first output instead of before the page is shown. Measured on the packaged app, launch until the editor is ready (median): 2.03 → 1.82 s on a 16-core machine, 3.49 → 2.69 s when the app is limited to 2 cores; memory use is 2–4% lower.
- **The background video pauses when no one can see it**: while the window is minimised or covered, or when a user background image hides it. With a file open and the window in the background, idle CPU use drops from ~11% to ~1.3% of one core, mostly in the GPU process, and memory by ~35 MB.
- **Electron 44 opens the editor ~15% sooner**: on the packaged app, launch until the editor is ready went from 1.82 to 1.55 s (median of 3 runs, 16-core machine). The cost: private memory at idle rose ~9% (383 → 416 MB measured from source) and the installed app grew from 766 to 872 MB, almost all of it the larger Electron runtime.
- **Blur without the cost**: the welcome card's frosted glass is a copy of the background blurred once when the theme is applied, instead of a live backdrop blur that re-blurred the playing background video every frame. The dimmed layers behind dialogs (Checkpoints, confirmations, Snippets, theme editor, ...) are a plain dim for the same reason.
- Chromium's spellchecker is turned off (it underlined identifiers typed in the app's text fields and used memory for nothing in a code editor).
- **File, checkpoint and app-state operations no longer block the main process**: opening, saving, listing folders, checkpoints and the saved app state use asynchronous file I/O, so a slow disk or a large file does not stall builds, output and the debugger while it is read or written.
- **The explorer saves its state in batches** instead of rewriting everything (including saved approaches, i.e. whole files) to browser storage on every click.
- Smaller wins: settings are written once when Ctrl+wheel zoom stops (not on every tick), clicking in the editor no longer rebuilds the tab strip, and clangd is not asked to re-parse a document whose text did not change.

### Changed

- **Floating layout**: the header, explorer, editor, bottom panel and status bar are separate rounded cards with the background showing between them. Tabs are soft pills: the open file gets a tinted fill and the rest are plain text, and a long row of tabs scrolls instead of pushing the window sideways.
- **One Run button**: Build & Run and a caret that opens Run without building (F10), Compile only (F9), Start debugging (F5) and the Debug panel. Stop appears next to it only while a program runs.
- **Bottom panel opens when needed**: it starts collapsed to its tab strip and opens on a run or a failed build. Click the open tab or the caret to collapse it again; Ctrl+J opens a collapsed panel. The Problems count is hidden at zero.
- **Explorer shows the folder's files again**: an opened folder lists its files and subfolders under **Files**, with indent guides and the open file as a filled pill that follows the active tab. The header shows the folder's name with New File, Refresh and Open Folder. A filter box at the top lists every matching file in the folder with the subfolder it is in (Enter opens the first, Esc clears it). **Recent** keeps the last three files, a folder shows how many files under it are marked Done, and a file's status is a coloured pill at the end of its row. Compiler output (`.exe`, `.o`, `.dSYM`, ...) is hidden behind a "build files hidden · Show" link and is never opened as text. Contest and Collections follow below.
- **Electron 44** (was 28): a newer Chromium and V8 (see Performance). Dropped files and a background image chosen in Settings get their path through `webUtils.getPathForFile`, since `File.path` no longer exists. Also updated: the terminal to xterm.js 6 (now `@xterm/xterm` and `@xterm/addon-fit`), electron-updater 6.8, electron-log 5.4.4, and electron-builder 26 for packaging. Monaco stays at 0.45: newer releases no longer ship the AMD loader the app is built on.
- **The loading screen follows your theme**: the splash takes the colours of the theme you last used (saved each time a theme is applied) and is redrawn as a soft card with a sliding progress bar instead of a thick border and spinner.
- The Debugger help card is shorter and uses one style throughout.
- **Input / Output / Expected**: the I/O column is three cards, each with a coloured dot. The new **Output** card shows what the last run printed, with an **AC** or **WA · N lines** badge when Expected is filled (Running / Stopped while it runs or after Stop), remembered per tab.
- **No theme flash at startup**: the window appears once the saved theme is applied, instead of opening in the default colours and switching, and the background video no longer blinks when the editor finishes loading.
- **Scrollbars are a thin pill kept inside their card**, clear of the rounded corners, in every theme. The Settings lists showed Windows' scrollbar with arrow buttons (on Chromium, `scrollbar-width` overrides the app's own style). The Terminal's scrollbar is the same pill instead of xterm's square 14 px bar, the terminal's padding follows its theme colour, and program output in red, green, yellow or blue uses the theme's error, success, warning and accent colours, as does selected text.
- **Dialogs, menus and notifications share one look**: a solid card in the theme's panel colour with its thin border, pill buttons in the theme's button colour (a soft tint for the other choice, red for Delete), and one plain dim behind dialogs. The large glowing shadows round menus, popups, the welcome card and the islands are gone; they were costly to paint over the background video. The tab's right-click menu (Checkpoints, Copy Path, ...) was drawn in Kawaii Light's blue glow in every theme and now follows the theme.
- **Updates install without the setup wizard**: after the download, "Restart to update" installs the new version silently and reopens the app, instead of showing the installer pages each time. An install in Program Files still asks for administrator rights.
- The classic installer (`sameko-dev-cpp-setup-1.3.0.exe`) uses the Kawaii Dark colours and its own artwork and wording, and offers to open the app when it finishes.
- **Performance Mode keeps the background video and animations**; it now only turns off the editor's costly options (minimap, bracket pair colours, smooth scrolling, cursor animation).
- The dimmed backdrop behind Settings takes the theme's colour instead of Kawaii Light's blue in every theme.
- **Debug panel is part of the layout**: it opens as a column beside the editor, which narrows to make room, instead of floating over the code.
- **Kawaii Light**: a light editor and terminal (they were Kawaii Dark's navy), syntax colours in pastel tones dark enough to read on white, and darker build-message colours. Its background image now shows, and fading it with the opacity slider lightens it instead of turning it grey.
- Program output in the terminal uses the theme's terminal text colour, so it is readable in Sakura.
- **Status bar**: error and warning counts, the last run's time and peak memory, and the selected C++ standard.
- **New icons and toolbar**: the interface uses Phosphor icons with rounded, bold strokes and a light tint, and an active button switches to the filled icon. Toolbar buttons are grouped (panels, run controls, settings) and behave like the Windows 11 taskbar: a soft tile on hover and a bar under each open panel's button, which widens on hover. The Run icon hops while a build is in progress, then bounces when it succeeds or the button shakes when it fails. Menus cascade in and Settings springs open. The window buttons are smaller and the close button turns red on hover. All of these effects are off when Windows is set to reduce animations.
- The bottom panel (Problems / Terminal / Tests) uses flat tabs with an underline instead of pill buttons; the editor no longer sits in a second frame inside its card (12 px more room each way); Settings rows use thin solid borders instead of dashed ones; the explorer shows one welcome block (Open Folder, with New Collection as a link) when no folder is open and there are no collections; the status bar text is easier to read.

### Added

- **A new Windows setup** (`Sameko-Setup-1.3.0.exe`): one rounded window in Kawaii Dark instead of the four-page wizard. It shows the folder to install to (the current install's folder when updating), a Browse button, the space needed and free, Desktop shortcut and Open when done, then a progress bar with each step (removing the old version, copying the editor, installing the compiler). It installs through the same NSIS installer, so Start Menu entries, uninstall and auto-update work as before; it asks for administrator rights only for a folder the user cannot write to, such as Program Files. The classic installer is still published and is what auto-update uses.
- **`struct` gets its `};`** (#52): typing `{` after `struct Name` (also `class`, `union`, `enum`) closes it as `{};`, like Code::Blocks, so Enter leaves the semicolon after the body. Ctrl+Z takes back just the `;`. Functions, lambdas and `= {` initialisers are left alone. Completion also offers common standard-library names (`setprecision`, `lower_bound`, `priority_queue`, ...) in the first seconds before clangd answers, which used to offer only keywords.
- **Test input from a file** (#49): the file button on the Input card, or a file dropped on it, makes the tab read its input from a `.txt` file instead of the Input box. The card shows the file's name, size and line count and its first 30 lines; the whole file is never loaded into the window. Run and Debug feed the file to the program from disk (a 6.6 MB, 1,000,000-number input runs in 1.4 s), the terminal shows one `< file` line instead of echoing it, and ✕ goes back to typed input. Each tab keeps its own file.
- **Ctrl+T** opens a new tab and **Ctrl+Tab / Ctrl+Shift+Tab** move to the next or previous tab (changeable in Settings › Keybindings). Ctrl/Alt shortcuts read the physical key, so they also work while a Vietnamese input method (Unikey, EVKey) is on.
- **Interface Scale** (Settings › Appearance, or Ctrl+= / Ctrl+- / Ctrl+0): enlarges or shrinks the whole interface, 80–200%. The default, **Auto**, enlarges it on 4K screens left at 100% or 125% scaling in Windows, where the app used to be too small to read (a 4K screen at 100% gets 150%); other screens stay at 100%. The editor and terminal stay sharp because this is the browser zoom, not a resize of the rendered image.

### Fixed

- **The Terminal came back empty after being dragged out of the bottom panel** (no output and no input box) when the Problems tab had been open: the panel hid the terminal's output and input with styles on the elements themselves, and they kept them when moved back. The terminal is now one block that moves between its own column and the panel as a unit, and the panel shows or hides it from its own state. Dragging the Terminal into the panel now also opens it.
- **"File changed on disk" after every Build & Run**: saving a file, or the build writing the editor's text to it, was reported by the file watcher as an outside change, so the IDE offered to reload the file it had just written. The IDE's own writes are now ignored.
- **The window slid sideways**: many open tabs, or opening the Debug panel, scrolled the whole page left (up to ~1,300 px), leaving the header half off-screen. Only the tab strip scrolls now, and the page itself can no longer scroll. The Debug panel also no longer covers the Run menu.
- **The Explorer listed no files**: an opened folder showed only Contest, Collections and Recent; its files and subfolders are back (see Changed).
- **A window last closed tall and narrow** (portrait on a landscape screen) reopens at the default 1400×900, centred.
- **The Terminal showed a second scrollbar** along its right edge: the output ran a few pixels past its box, which scrolled on its own; the last line could also be cut off. The output now fits the box exactly.
- The Explorer was the only see-through card: the Explorer, header and status bar are now solid like the editor.
- **F12 and Ctrl+Shift+I open DevTools only when running from source**, not in the installed app.
- **Rename, New File and other name prompts in the Explorer could not be used**: the dialog opened but OK, Cancel, Esc and Enter did nothing (a script error left it without its handlers). They work again.
- Confirmation dialogs: Enter answers with the focused button (Tab to Cancel then Enter no longer deletes), and the confirm button takes the theme's colour instead of a fixed blue.
- The Input / Output / Expected cards are the same height (Output was a fifth shorter) and line up with the editor's top and the bottom panel's bottom edge (they sat 2 px lower and ended 12 px higher).
- The docked Terminal no longer sits in a dark frame, the bottom panel's resize strip shows a grip and stays clear between the rounded cards (it was filled in Performance Mode), and a run's time and memory appear once, in the status bar.
- In the Explorer, the highlighted file follows the active tab (it only marked the first file opened).
- **Small and short windows**: the window can no longer be shrunk below the size the layout works at (760×520, times the interface scale). The docked Terminal/Problems panel took a fixed 320 px, leaving 8–10 editor lines on a 720 px-high screen; it now follows the window height (still 320 px from ~890 px up) and can be dragged up to 55% of the window instead of a fixed 400 px. Narrow windows give the Input/Expected column less width, the ☰ Run menu now has Compile and Get Tests from OJ (their toolbar buttons are hidden there), and the "install update" button no longer disappears.
- **A program printing in an infinite loop froze the whole IDE** (window unresponsive for ~25 s, Stop unreachable). Output is now rate-limited with back-pressure: the window stays responsive and Stop answers immediately. Nothing is dropped.
- **Undo history was lost when switching tabs.** Every tab now has its own editor document, so Ctrl+Z, markers and scroll position stay with the file; the same file shown in both split panes is one live document.
- **F10 / F11 / Shift+F5 did the wrong thing while debugging** when the cursor was in the editor (F10 tried to Run instead of Step Over), and keybindings changed in Settings had no effect inside the editor. All shortcuts now go through one table, and a changed keybinding applies immediately.
- **Stop could kill unrelated programs**: stopping or rebuilding ran `taskkill` by executable *name*, so a source file named `explorer.cpp` would take down Windows Explorer. Only the process started by the IDE is terminated now.
- **Text containing `<…>` was mangled** in the Problems panel (`std::vector<int>` showed as `std::vector`), the snippet list, tabs, test results, the explorer and theme lists.
- **Live Code Checking reported a false error on any code using `try`/`catch`** ("exception handling disabled").
- **"--- Stopped ---" was printed on every build** even when nothing was running.
- **Two files with the same name overwrote each other's executable** (every contest has an `A.cpp`), and "Run only" ran whichever file was built last instead of the current tab.
- **Buttons that did nothing**: the GitHub button, the portable "Download" button and the update dialog link had no handler; the portable link also pointed to the wrong repository.
- **The "compiler not found" warning at startup was never shown** (it crashed on an undefined function).
- **"Delete After (days)" for Checkpoints was ignored**, so old checkpoints were never removed; small checkpoints were listed as "0 KB".
- **Settings could be lost or reverted**: `settings.json` is now written atomically with a backup copy, and saving settings no longer overwrites the saved window position.
- **Saving or building a file asked to reload it** ("File has been changed externally"): the app's own write was reported by the file watcher before it was recorded as ours, so every Ctrl+S and every Build & Run of a saved file showed the prompt. Only changes made by other programs prompt now; a compile that writes the editor's text to disk is also recognised as the app's own write.
- **External changes were only detected for files opened through the Open dialog**, not for files opened from the explorer or restored from the previous session.
- **Test cases were shared by every tab**: switching tabs kept the other file's tests, and typing in INPUT overwrote them. Each tab now has its own test cases, selected test and results, and they are restored with the session.
- **The app changed clangd for the whole machine**: it wrote `%LOCALAPPDATA%\clangd\config.yaml`, forcing a MinGW target and its include paths onto clangd in VS Code, CLion and other projects. Flags are now passed to the app's own clangd only, and the file written by earlier versions is removed (only if it still carries the app's marker).
- **Session restore could silently stop working** once browser storage filled up (a large background image or many untitled checkpoints were enough). The session checkpoint, checkpoints of untitled tabs and theme background images/videos are now stored as files in the app's data folder; existing data is migrated automatically.
- **Restoring a checkpoint wiped the undo history** of the file. It is now a single edit: Ctrl+Z brings back the text from before the restore.
- **Opening a very large file could freeze the IDE.** Files over 16 MB are refused with a message instead; previously a failed open from the explorer or session showed nothing at all.
- Explorer state (folders, notes, statuses, collections, saved approaches) moved from browser storage to `userData/state/explorer.json` for the same reason as the session; existing data is migrated automatically.
- Previewing checkpoints created a new hidden editor every time and never freed it, and could switch the editor colour theme; the preview now reuses one editor.
- Checkpoints of an untitled tab were kept forever after the tab was closed; closed tabs stayed loaded in clangd for the whole session.
- Non-ASCII strings in the debugger's Variables panel were shown as digits.
- Dragging the split divider threw an error on release; resetting keybindings did not take effect until Settings was saved; Escape did not close Settings while the editor had focus; pasting many lines into the terminal input was slow; the app checked for updates three times per launch; Compile Only and Run All Tests ignored the "Use LLD Linker" setting.

### Security

- **Competitive Companion listener** now refuses requests coming from web pages (any site could previously push a "problem" into the IDE, creating files and stealing focus), limits the request size and validates the payload.
- Added a Content-Security-Policy (no inline scripts or inline event handlers) and blocked navigation and new windows in the main window.
- Imported themes and `.sameko` contest files can no longer inject markup into the UI.
- The checkpoint reader only reads checkpoint files; it used to read any path the renderer asked for.

### Removed

- **tree-sitter** (`tree-sitter`, `tree-sitter-cpp`): its only remaining jobs — a pre-check before the live syntax check and a fallback list of local variables for completion — are covered by clangd. Two native dependencies less to build and ship.
- Unused IPC surface: 18 preload functions nobody called, 13 handlers nothing could reach, and the constants, validators and legacy history channels behind them.
- `build-local.ps1`, superseded by `npm run build:win` (it pointed at an output folder that no longer exists).
- Eight renderer modules that were never loaded by `index.html` (`tab-manager.js`, `settings-manager.js`, `shortcuts-manager.js`, `panel-manager.js`, `build-system.js`, `snippets-manager.js`, `editor-core.js`, `split-manager.js`), the unused golden-layout theme, and a development HTTP server that was started but never used.

### Developer notes

- `npm run test:gui` now runs on a temporary profile instead of the developer's real session.
- **`src/renderer/app.js` (7,900 lines) is split into 17 files under `src/renderer/app/`**, cut at its existing section banners and loaded in the same order — no logic was moved between sections. `CODEBASE.md` §9 lists what is where.
- About 45 trace `console.log` calls removed from renderer code (theme customizer, explorer, update checks, init banners); warnings and errors are kept.
- Compile Only and Build & Run share one implementation (`buildActiveTab`) instead of two ~100-line copies.
- New: `app/shared/settings-store.js`, `app/ipc/state-handlers.js`, `app/services/compiler/run-launcher.js`, `src/renderer/boot.js`.
- `ld.lld.exe` is picked up from `Sameko-GCC/bin` when present, but measured only ~5% faster builds (link 154 → 122 ms) for +71 MB, so the packaging filter leaves it out even when a local toolchain has it.
- `npm run build:win` also builds `Sameko-Setup-<version>.exe` (`scripts/build-setup.js`): the window in `installer/setup/` is compiled with the C# compiler of .NET Framework 4.8, which ships with Windows, and the NSIS installer is embedded in it. `scripts/build-installer-art.js` draws the NSIS sidebar and header bitmaps.
- Linux builds pass `-c.productName=Sameko-Dev-CPP`: electron-builder 26 refuses the `+` of "Sameko Dev C++" in Linux file names. The menu entry keeps the full name.
- New `scripts/check-toolchain-deps.js`: after changing the toolchain filter in `package.json` or updating `Sameko-GCC`, build with `electron-builder --win dir` and run it; it fails if any packaged executable or DLL imports a DLL that was filtered out.

## [1.2.0] - 2026-08-01

### 🚀 Highlights & Major Features

- 🐛 **Integrated C++ Debugger (GDB)** ([`1ea1e5b`](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/commit/1ea1e5b)): Real source-level debugging inside Sameko! Features breakpoint gutters, conditional breakpoints, variable trees with STL pretty-printing (`vector`, `map`, `string`), Call Stack, hover evaluation, Auto dry run, and step history replay.
- 🐧 **Cross-Platform Linux Support** ([`1e0d1d6`](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/commit/1e0d1d6)): Sameko now natively supports Linux! Ships AppImage, `.deb`, and `.tar.gz` packages and auto-detects system `g++` and `gdb`.
- ⚡ **Blazing Fast Startup & Local Fonts** ([`b3f845c`](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/commit/b3f845c)): ~16% faster launch times via locally bundled fonts (no Google Fonts CDN dependency) and deferred Monaco editor loading.
- 📟 **Realtime Terminal Output Engine** ([`1588ea6`](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/commit/1588ea6)): High-performance xterm.js integration with C++ `std::cout` unbuffering for instant line-by-line output in competitive programming.
- 🎨 **SSOT Theme Architecture & Customizer** ([`74f5a9e`](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/commit/74f5a9e)): Single Source of Truth theme tokens, new dark backdrop customizer popup, and clean theme consistency.
- 🛠️ **GCC 16.1.0 Toolchain & C++26 Standard**: Updated WinLibs GCC 16.1.0 MinGW toolchain with official C++26 standard support.
- 📌 **Fixed Issues Sweep**: Fixes [#35](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/35), [#36](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/36), [#38](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/38), [#39](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/39), [#41](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/41), [#42](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/42), [#43](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/43), [#44](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/44), [#45](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/45), [#46](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/46), [#47](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/47), [#48](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/48).


### Added

- **[[FEATURE] Integrated C++ Debugger (GDB)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/commit/1ea1e5b)**:
  - The app now has a real source-level debugger built on the bundled MinGW GDB (Machine Interface), replacing the old "just run the exe" behavior. Debug a `-g` build without leaving the editor.
  - **Breakpoints**: click the left gutter to toggle a red breakpoint (the line number turns into a badge and the line is tinted, Dev-C++/Visual Studio style). `Alt`+click sets a **conditional** breakpoint (e.g. `i == n-1`); `Ctrl`+click **enables/disables** one without removing it. gdb-relocated breakpoints (off blank/comment lines) move automatically.
  - **Debug panel** (bug icon on the toolbar shows/hides it): a single smart **Run ▶ / Continue / Pause** button drives the whole session, plus **Step Over / Into / Out** and **Stop**. `F5` run/continue, `F10` step over, `F11` step into, `Shift+F11` step out, `Shift+F5` stop. Step Into stays in *your* code — it skips standard-library internals instead of diving into `std::` template guts.
  - **Variables & Watch**: locals and watch expressions are shown as expandable trees with full STL pretty-printing (`vector`, `map`, `string`, … expand to their elements). Values that changed since the last step are highlighted; double-click a numeric value to toggle **hex/decimal**.
  - **Call Stack** with clickable frames, **hover-to-evaluate** (hover any variable while paused to see its value), and **Run to Cursor** (right-click a line).
  - **Multi-file aware**: pausing in another file automatically opens/switches to it so the current-line arrow is visible.
  - **Beginner-friendly**: a one-time 3-step coach mark, a nudge when you start with no breakpoints, and program I/O routed cleanly to the terminal.
  - **Auto dry run**: one button walks the program a line at a time on its own while the Variables tree updates, so a loop can be watched instead of stepped by hand a hundred times. It needs no breakpoint — it starts the session paused at `main()` — steps *into* your own functions, and comes with a speed slider (0.15–3s per line, default 1s). **Pause**, `Esc`, or any manual step stops it.
  - **Back through the recording**: every pause is recorded (line + the values of the locals at that moment), and **Back** walks through that recording. GDB cannot run a program backwards on Windows, so this is an explicit read-only replay: the recorded line is marked with a hollow arrow, controls that would move the program are disabled, and **Back to live** (or `Esc`) returns to the present.
  - **Restart** stops the session and runs the whole program again from the top.
- **[[FEATURE] Cross-Platform Linux Support](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/commit/1e0d1d6)**: the app now runs on Linux, and the build produces Linux packages (AppImage, `.deb`, `.tar.gz`) alongside the Windows ones. Unlike the Windows build it does not bundle a compiler — install `g++` and `gdb` from your distribution and Sameko will detect them.
- **Active Contest Auto-Collapsing & Top Prioritization**:
  - Double-clicking a contest, clicking its quick-activate button, or opening any file inside it sets it as the active contest, automatically collapses all other contests, and expands the active one.
  - The active contest temporarily jumps/bubbles to the very top of the CONTEST list. Upon deactivation, it returns to the chronological "newest-first" sorting order.
- **Quick-Activation Button**:
  - Added a subtle lightning bolt button (`.cat-activate-btn`) next to non-active contest folders on hover, allowing quick activation with a single click.
- **PCH Cache-Clear with Background Rebuild**:
  - Added a "Clear PCH Cache" action to settings to delete corrupted or slow Precompiled Header files.
  - Wired it to an IPC call that runs asynchronously in the background to re-optimize/precompile libraries using the active compiler flags, keeping the UI smooth while restoring 200-400ms C++ compile speed.
- **[[FEATURE] Additional Compile Flags & Clangd Diagnostics Synchronization](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/commit/3a64f21)**:
  - Added a free-text "Additional Compile Flags" field (`compiler.extraFlags`) whose contents are appended to every compile command (e.g. `-DLOCAL -DDEBUG`), validated against unsafe flags (`-B`, `-plugin`, `@`, `--specs=`) before reaching the compiler.
  - The same flags and the chosen C++ standard now also drive clangd's `compile_flags.txt` and the live `-fsyntax-only` diagnostics, so IntelliSense, editor squiggles, and real builds agree on macros and `#ifdef` branches (e.g. code guarded by `-DLOCAL`).
- **[[FEATURE] Realtime program output with xterm.js & std::cout unbuffering](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/commit/1588ea6)**:
  - Rebuilt the output-unbuffering shim as C++ (`Sameko-GCC/lib/sameko_unbuffer.cpp`) so it also unit-buffers `std::cout`/`std::cerr`, not just C `stdio`. The old C-only `setvbuf` shim could not reach `std::cout`'s buffer, so programs using `ios_base::sync_with_stdio(false)` (standard in competitive programming) only showed output in one burst when the process exited.
  - Added a **Realtime Output** setting (Settings > Execution, default on). When disabled, the shim is not linked, restoring full buffering for maximum throughput on heavy output.
- **[[FEATURE] Add Save As support with Ctrl+Shift+S (Fixes #35)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/35)**:
  - Added `File > Save As...` and `Ctrl+Shift+S` for saving the active tab to a new path.
  - Updated tab title/path and file watching after Save As completes.
  - Preserved regular `Ctrl+S` behavior for saving to the current file path.

### Changed

- **Debug panel rebuilt around the data**:
  - Variables / Watch / Call Stack are now a flat accordion — hairline separators instead of three nested bordered boxes, a count badge on each header, its own scrollbar per section, and the open/closed state remembered between runs. Call Stack folds itself away while there is only one frame.
  - The static "Shortcuts & tips" footer, which cost about a fifth of the panel height, moved into a popover on a new **?** button. It now also explains what each mark in the gutter means.
  - When there is nothing to show, one centred message replaces the three per-section dashes.
  - The toolbar is a header row (title, status, **?**, close) over a transport row whose buttons share the width evenly and are 34px tall, so they stay easy to hit and cannot overflow at any panel width.
- **Gutter marks now say which is which**: a red dot is a breakpoint, a solid yellow arrow is where execution is paused, and the two combined (arrow inside the dot) is paused *on* a breakpoint. The first pause of each session also spells out the point beginners most often miss — the lines above a breakpoint have already run; a breakpoint stops the program, it does not start it.
- **Terminal input grows with its content**: the stdin box was clipped to one visible row, so a pasted multi-line test case could not be read back. It now grows up to a ceiling that adapts to the panel height, and always leaves room for the output above it.
- **Build produces every release artifact in one command**: `npm run build` now emits the three files a release needs — the Windows NSIS installer, the zipped portable Windows build, and the Linux AppImage — plus the update metadata (`latest.yml`, `latest-linux.yml` and `.blockmap`). Packing an AppImage needs permission to create symlinks, which Windows withholds outside an elevated terminal or Developer Mode, so `scripts/build-appimage.js` tests for it first and transparently runs the build through WSL when it is missing; the Windows targets are built first so they survive a Linux-side failure either way. `npm run build:linux` produces AppImage/deb/tar.gz (run it on Linux or WSL; `.deb` needs `fpm`, which has no Windows build), and `npm run build:all` does both. The standalone portable `.exe` was dropped — it was the same app as the `.zip`, only slower to start because it unpacks itself on every launch.
- **Clangd-Driven IntelliSense (Removed Hardcoded STL Tables)**:
  - Removed the hardcoded `STL_DOCS`, `STL_TYPE_METHODS`, and `STL_KEYWORDS` tables, the after-dot STL method completion logic, the STL hover provider, and the STL-only signature help provider from the C/C++ suggestion provider.
  - Member completions (e.g. `.push_back`, `.size`), hover info, and signature help are now served entirely by clangd, which is accurate and context-aware instead of pattern-matched.
  - Kept the custom snippets (CP template, `for`/`while`/`if`, `vec`, `ios`, `fre`, user-defined snippets), include-path completion, preprocessor directives, and language keywords as the fallback path when clangd has no result (e.g. unsaved files).
- **Bundled Completion Style**:
  - Switched clangd to `--completion-style=bundled` so overloaded members collapse into a single entry (e.g. `assign(…) [3 overloads]`, `push_back(…) [2 overloads]`) instead of one line per overload — a shorter, less noisy completion list better suited to competitive programming.
- **Explorer Rounded Cards and Thick-Border Aesthetic**:
  - Re-styled the outer file explorer sidebar container as a floating card with `border-radius: 16px`, `margin: 12px 0 12px 12px`, and a thick `2px solid var(--border)` outline, matching the layout of the main editor.
  - Re-styled collections and contests in the sidebar as floating rounded cards with explicit 2px borders, replacing flat borderless container boundaries.
  - Removed explicit borders from sub-items (chips and list items) by default to avoid nested border clutter, replacing them with a soft glass background that transitions to active borders only when selected.
  - Stripped solid backgrounds and bottom borders from the main CONTEST and COLLECTIONS section headers, turning them into clean, transparent, minimalist typography labels.
  - Tuned category section header margins: removed top margin from the first section (CONTEST) to eliminate excess top gap, and increased top margin on the second section (COLLECTIONS) for better vertical separation.
  - Increased list spacing gap to 6px and enabled floating pill backgrounds for category list items, matching the Kawaii rounded design system.
  - Normalized border colors for all explorer card containers and lists in Dracula, Nord, Monokai, and general dark themes.
- **Context Menu Danger Item & Layout Improvements**:
  - Styled the "Delete Collection" danger item to blend in with standard menu colors by default, turning red with a soft error background only on hover.
  - Prevented line wrapping in context menus using `white-space: nowrap`.
  - Upgraded submenus to use `min-width: max-content` for flexible, responsive widths that auto-fit the content text.
- **Visual Glow Removal**:
  - Removed pulsating drop-shadow glow animation (`lightning-glow`) and glowing filter from the active contest lightning bolt icon.
  - Eliminated colored box-shadow glows from active contest cards and active status badges, replacing them with flat solid borders.
  - Removed soft box-shadow glow (`var(--shadow-soft)`) from the editor panel container, replacing it with a clean, flat shadow (`var(--shadow-card)`).
  - Removed glow shadow from the header progress bar.
- **Active Contest & Test Case Runner State Synchronization**:
  - Wired compilation and execution events in the test case runner to the file explorer sidebar status updates.
  - Synchronized the active contest problems' statuses/tags dynamically with compilation and testing results (AC, WA, TLE, RE).
  - Updated the status decision matrix to allow downgrading/upgrading active contest tags on subsequent test executions (e.g. from AC to WA/TLE/RE if the latest run fails).
- **Settings Layout and C++26 Standard Option**:
  - Removed the "(Beta)" suffix from the C++26 compiler standard selector to reflect the official release status of the bundled GCC 16.1.0.
  - Cleaned up duplicate nested HTML `div` elements within the compiler settings block.
- **Bundled GCC 16.1.0 toolchain refresh and cleanup**:
  - Replaced the local `Sameko-GCC` bundle with the official WinLibs GCC 16.1.0 MinGW-w64 14.0.0 toolchain for newer C++ standard support.
  - Removed unused documentation, locale, Python test/GUI modules, and non-integrated helper tools from the bundled toolchain, reducing `Sameko-GCC` from ~918 MB to ~737 MB while preserving IDE compilation, syntax checking, `bits/stdc++.h`, and the realtime-output shim.
- **Faster app startup by bundling fonts locally (no Google Fonts CDN)**:
  - Replaced the runtime Google Fonts requests (`<link>` in `src/index.html` and the render-blocking `@import` in `src/styles/base.css`) with locally bundled `woff2` files served from `src/assets/fonts/` via `src/assets/fonts.css`.
  - Startup no longer waits on a network round-trip to `fonts.googleapis.com`/`fonts.gstatic.com`, so the IDE opens reliably and consistently even on a slow connection or fully offline. Measured `did-finish-load` dropped from ~1190ms to ~1004ms (~16% faster) in dev mode.
  - Bundled only the `latin` + `latin-ext` subsets of the three fonts in use (Fredoka, Nunito, JetBrains Mono), totaling ~596KB.
- **Terminal now renders with xterm.js instead of per-line DOM nodes**:
  - Output is written to an xterm.js terminal (canvas-based) rather than creating a `<pre>` element per output chunk. A tight `while(1) std::cout << ...` loop previously created thousands of DOM nodes per second and froze the UI.
  - Program output is written verbatim (program controls its own newlines/ANSI); IDE status/build messages render as discrete colored lines using the existing terminal color palette.
  - Kept the existing terminal UI: header, clear button, input textarea + send button, command history, Ctrl+C, docking, and per-theme colors.
  - The terminal now defaults to being docked at the bottom panel.

### Performance

- **Faster First-Launch (Packaging Trim)**:
  - Excluded ~1,870 files / ~115 MB of never-loaded assets from the packaged app: Monaco's `dev/`, `esm/`, and `min-maps/` folders (the app only uses `min/vs` via the AMD loader), tree-sitter-cpp's `src/` parser source and `.wasm`, non-Windows tree-sitter prebuilds (macOS/Linux/ARM), and source maps.
  - Smaller `app.asar` and far fewer files mean less to read from cold disk and less for Windows Defender to scan on the very first run — the slowest launch, before the OS file cache is warm.
- **Deferred (Lazy) Monaco Editor Load**:
  - Monaco (the editor engine) was the single biggest chunk of renderer startup (~46%, measured). It no longer blocks initial paint: the window shell, welcome screen, and UI theme appear first, and Monaco loads on demand the moment a file is opened/created (with an idle-time fallback so settings/snippet/theme-customizer/checkpoint panels still work if no file is opened).
  - Session restore now syncs restored tab content into the editor via an explicit editor-ready hook instead of a fragile fixed 300 ms delay, so reopened/restored files show reliably regardless of how long Monaco takes to load.
  - Measured `did-finish-load` dropped from ~1.44 s to ~1.0 s, with the shell interactive noticeably sooner.

### Fixed

- **Breakpoint marks were never actually visible**: the editor was created without `glyphMargin`, which Monaco defaults to `false`, collapsing the glyph strip to zero width. Every mark drawn there — the breakpoint dot, the paused-line arrow, the hover ghost, the compiler error glyph — was being painted into nothing, so a set breakpoint showed only as a tinted line.
- **Building while debugging failed with a linker error**: the debugger holds the program file open, so a build hit `cannot open output file … Permission denied` from `ld`, which reads like a broken toolchain. Compile / Build & Run / Run / Run tests are now refused with an explanation while a session is live. The old hint claimed it was "stopping background process..." while stopping nothing.
- **Stop then immediately run again could kill the new session**: a late `terminated`/`exited` event from the previous gdb arrived after the next session had started and tore it down.
- **Debug toolbar buttons no longer strobe** while auto-stepping — the session flickers between paused and running many times a second, and a click could land in a millisecond where the button was disabled.
- **`npm run clean` and `clean:dist` deleted the wrong directories**: `clean` removed `%APPDATA%/cpp-ide` while the settings folder is `sameko-dev-cpp`, and `clean:dist` removed `release_build` while the build output goes to `samekodevcpp` — so `rebuild:win` was not rebuilding from scratch. Both now use `scripts/clean.js` and work on Linux and macOS too.
- **Right-clicking the terminal input pasted the clipboard twice** (the handler was registered both directly and at the document level).
- **[[BUG] IntelliSense Completions & Hover Were Silently Disabled](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/commit/a9e6b69)**:
  - clangd-backed member completions (`v.` → `push_back`, `size`, …) and hover never fired: the C/C++ provider gated both features on `window.TabManager`, a module `index.html` never loads, so the condition was always false and the editor silently fell back to buffer-word suggestions (showing `main`/`v` instead of real STL members).
  - Rewrote the provider to resolve the active document from the app's own `App` tab state via a `clangdFileId(model)` helper that always yields a valid identifier (saved path → tab id → Monaco model URI), and removed the tab-existence gate so clangd is queried unconditionally — a missing or stale tab can no longer drop IntelliSense to the fallback.
  - Fixed a latent `afterDot is not defined` ReferenceError in the completion provider (the flag was declared only in a sibling function's scope) that would otherwise throw the moment the clangd branch became reachable.
- **Clangd Member Completions for `bits/stdc++.h`**:
  - clangd 22.1.6 (bundled) now correctly resolves member completions like `vector::begin`, `vector::push_back`, `string::size` for files using `<bits/stdc++.h>` — the previous combination of clangd 18 and missing include flags was returning zero or only-prefix-matched items.
  - Added a `compile_flags.txt` writer in `app/services/syntax/clangd-service.js` that queries `g++ -Wp,-v` for the MinGW system include paths and writes them to `<basePath>/compile_flags.txt` once at startup. clangd walks up from each source file's directory to find it, so untitled tabs (mocked as `temp_untitled_tab-N.cpp` under the base path) and saved files both pick it up.
  - The `--target=x86_64-pc-windows-gnu` flag is passed in `compile_flags.txt` so clangd uses the MinGW ABI; `--query-driver=...g++*` is also passed so clangd will fall back to invoking g++ for system include extraction if needed.
  - Stable URI for untitled tabs in `getFileUri()`: the previous code generated a fresh random URI per call, which forced clangd to re-open the file on every keystroke and wiped its parsed state. Now untitled tabs map deterministically to `temp_untitled_<tabId>.cpp` so `didChange` (incremental) is used instead of `didOpen` (full re-parse).
  - Completion items now use clangd's `textEdit.range` when present (for correct insertion at member-access points like `v.b|` → `v.begin()`), falling back to the current word range otherwise.
- **Monaco Word-Based Suggestions Conflict**:
  - Set `wordBasedSuggestions: 'off'` in `src/renderer/app.js` (both editor instances) so Monaco no longer pollutes the dropdown with tokens scraped from the document (e.g. showing `main` when typing `v`). clangd's results are complete enough on their own; the previous `'allDocuments'` setting caused duplicate, context-free suggestions to out-rank clangd's typed results.
- **[[BUG] Premature Auto-Update Restart Trigger](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/commit/f5f9f02)**:
  - Prevented the "Restart to Update" button from appearing before an update is completely downloaded by requiring both the installer `.exe` and the corresponding `update-info.json` file to exist in the pending directory before declaring it as downloaded from a previous session.
  - Reset the `updateDownloaded` state and hid the restart button on update check start, update availability, download start, and update errors to ensure users cannot click the restart button while a new download is in progress.
  - Reverted update button styling to a flat ocean theme color with clean hover animations (1px translation and soft shadow) without visual gradients or outer glow animations to keep it consistent with the overall IDE theme.
- **Competitive Companion Import Target Setting** ([#46](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/46)):
  - Added an option in the CC popup to choose where imported tests land: **"Open in a new tab"** (default, existing behavior) or **"Import into current tab"** (keeps your code, only updates tests).
  - When importing into the current tab, users can choose to **replace** existing tests or **append** new ones.
  - Setting is persisted in `settings.json` under `oj.importTarget` and `oj.importMerge`.
- **[[BUG] Snippet button position, empty selection copy & Ctrl+C output pollution (Fixes #38, #44, #45)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/38)**:
  - Fixed snippet button placement in editor toolbar.
  - Prevented empty text selection copy operations from overwriting clipboard content with empty strings.
  - Prevented Ctrl+C in terminal output from polluting output stream.
- **[[UI] Vietnamese language string cleanup and terminal element structure (Fixes #36, #42, #43, #47, #48)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/42)**:
  - Completed localization pass by replacing lingering Vietnamese strings with clean English UI labels.
  - Re-architected terminal container into unified element structure to avoid CSS conflicts.
- **Main-process output flooding**: stdout/stderr chunks are now coalesced and flushed on a short timer (or at a 64KB threshold) instead of emitting one IPC message per `data` event, with a guaranteed flush before process exit.
- **Unbounded memory growth on infinite output**: removed the write-only `output`/`errorOutput` accumulators that grew without limit under `while(1)`-style loops.
- **Docked terminal height**: the xterm terminal now fills the full panel height when docked and re-fits after dock/undock/resize/show transitions.
- **[[BUG] Startup untitled.cpp is marked unsaved even when untouched (Fixes #41)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/41)**:
  - Treats generated startup/template content as the clean tab baseline.
  - Prevents untouched generated `untitled.cpp` tabs from triggering unsaved-change prompts.
  - Avoids restoring untouched generated untitled tabs as recoverable unsaved work.
- **[[BUG] Switching tabs reuses the previous tab scroll position (Fixes #39)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/39)**:
  - Saves Monaco editor view state per tab before switching away.
  - Restores each tab's own scroll/cursor viewport when switching back.
  - Resets new tabs without saved view state to the top of the file.

## [1.1.0] - 2026-04-06

### Added
- **Run All diagnostics metadata**: Added per-test debug metadata for `Run All` failures (exit/signal, timeout flag, stderr preview, and output hashes) to help investigate intermittent verdict issues.
- **Shared judge utility module**: Added `app/shared/judge.js` as a single source of truth for output normalization and output comparison.
- **[[FEATURE] Allow users to customize the editor font (Fixes #28)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/28)**:
  - Added clean support for both built-in font options and custom font-family input.
  - Normalized font-family persistence so custom values apply consistently across sessions.
- **Editor productivity shortcuts (VS Code-style, tier 1)**: Added default keybindings for `Ctrl+/`, `Ctrl+D`, `Ctrl+Shift+L`, `Alt+Up/Down`, and `Shift+Alt+Up/Down`.
- **Smart WA Diff Viewer + Single Test Run**:
  - Added character-level WA diff highlighting (actual vs expected) with better readability in Input/Expected panel.
  - Added per-test "Run" action directly in TESTS list to quickly run one testcase without running all.
  - Enabled `Ctrl + Mouse Wheel` zoom support inside diff view (same panel font scaling behavior as IO/terminal).

### Fixed
- **[[BUG] Random "RTE" (Runtime Error) when using the "Run All" feature for Test Cases (Fixes #27)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/27)**:
  - Unified output normalization/comparison rules between normal run comparison and batch `Run All` judging.
  - Fixed expected-output comparison guard so empty expected output is still judged correctly.
  - Improved runtime error details to include exit signal/code and stderr preview.
- **Preload reliability regression**: Prevented preload startup failure from breaking `window.electronAPI` exposure when optional judge import is unavailable.
- **[[BUG] Editor does not support multi-cursor selection with modifier-click (Fixes #31)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/31)**: Enabled configurable Monaco `multiCursorModifier` with clean platform-aware fallback.
- **[[BUG] Window reopens off-screen after disconnecting a secondary monitor (Fixes #30)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/30)**: Added display-change safety checks to revalidate and reposition the main window when monitor topology changes.
- **[[FEATURE] Improve startup session restore behavior with configurable On Startup options (Fixes #32)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/32)**:
  - Unified startup restore messaging and behavior with the configured `On Startup` option.
  - Improved restore notification copy and session summary clarity for safer restore decisions.
- **[[BUG] Input/Expected panel state is shared across tabs (Fixes #33)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/33)**: Input/Expected data is now persisted per-tab and restored on tab switch, preventing cross-tab overwrite.
- **[[BUG] Terminal log severity classes become inconsistent with aliases (Fixes #34)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/34)**: Normalized log type aliases (`warn`/`ok`) before applying classes and color mapping to keep terminal status styling consistent.
- **CP status regression on tab/file switch**: Prevented accepted status from being downgraded to editing/coding when switching/opening tabs without actual content edits.
- **Explorer startup + reveal behavior**: Explorer now starts closed and auto-reveals only when opening a file if it was open in the previous session.
- **Test diff visibility reliability**: Fixed missing diff after `Run Single`/`Run All` by normalizing `actualOutput` handling.
- **Responsive editor clipping on different aspect ratios**: Fixed Monaco editor being visually covered by side panels instead of shrinking correctly.

### Improved
- **Run All timing stability**: Added warm-up execution before measured test loop to reduce first-test cold-start skew.
- **Shortcut map behavior**: Shortcut mapping now merges saved keybindings with defaults, so newly added defaults stay available without forcing users to reset settings.
- **[[FEATURE] Improve Checkpoint recovery for unsaved files (Fixes #29)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/29)**:
  - Kept checkpoint persistence flow centralized and startup-aware to avoid stale or conflicting restores.
  - Improved session restore summary to clearly distinguish unsaved and modified files before recovery.
- **Responsive behavior and layout consistency**: Improved responsive handling across panels/layout breakpoints for better usability on different window sizes.
- **Performance mode animation behavior**: `Reduce Animations` now disables UI transitions/animations globally for a clearly smoother low-motion mode.
- **Compile speed workflow**:
  - Added startup background compiler warm-up + default PCH prebuild to reduce first-run compile latency.
  - Added `Single-file Compile Mode` (default ON, configurable in Compiler settings) for faster CP-style builds.
  - Added linker-error hint when single-file mode is ON, suggesting multi-file mode for project-style builds.
  - Improved multi-file auto-linking strategy by resolving only include-related source candidates instead of scanning the full folder.
  - Reduced compile pipeline overhead by trimming unnecessary pre-compile waits and keeping debug builds lightweight by default.
- **External terminal reliability**:
  - Fixed premature "process finished" notifications in external terminal mode.
  - External run summary now reports completion timing and peak memory after the external CMD session actually exits.
- **Startup compiler preparation**: Compiler warmup + default PCH are now prepared in background after app launch to reduce first Build/Run latency.
- **Debug-build compile speed**: `-s` stripping is skipped for non-optimized builds (`-O0`) to reduce compile overhead in normal coding workflow.


## [1.0.4] - 2026-02-15

### Added
- **[[FEATURE] Syntax highlighting for special characters (\\n, \\t, \\0) (Fixes #25)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/25)**: Added highlighting for escaped special characters.
- **[[FEATURE] Adjustable Font Size for Input, Output, and Terminal panels (Fixes #23)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/23)**: Added font size controls for Input, Output, and Terminal panels.

### Fixed
- **[[BUG] Enter key intermittently fails to insert new line after brace (Fixes #26)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/26)**: Fixed intermittent newline insertion after brace.
- **[[BUG] Menu shortcut label does not update after customization (Fixes #24)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/24)**: Menu shortcut labels now refresh after customization.
- **Monaco color scheme**: Adjusted Monaco editor color palette for better consistency.

## [1.0.3] - 2026-02-23

### Added
- **Custom Confirm Popup**: Replaced native browser `confirm()` dialogs with custom, theme-aware confirmation modals with smooth animation and backdrop blur.
- **Delete All Test Cases**: Added "Delete All" button in TESTS panel header to quickly remove all test cases at once.
- **Per-Test Delete Button**: Each test case now shows a delete button on hover for quick individual removal.
- **Test Result Diff on Switch**: Selecting a test case after "Run All" now displays the expected vs actual output diff inline.
- **Auto-Expand TESTS Panel**: Problems panel automatically expands when test cases are present, similar to docked terminal behavior.

### Fixed
- **[[BUG] Testcase result shows "Failed" even when Expected aligns with Input (Fixes #22)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/22)**:
  - *Case 2*: Fixed Permission Denied error when closing tab (Ctrl+W) while a program is running — process is now stopped before closing.
  - *Case 3*: Synced disable state between main terminal input and docked terminal input to prevent ambiguous input sources.
  - *Case 4*: Fixed keyboard input freeze after deleting all test cases — editor focus is now restored properly.
- **[[BUG] Unsaved changes indicator (dot) appears on unchanged files (Fixes #21)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/21)**: Corrected file change detection to prevent false-positive unsaved indicators.
- **[[BUG] Expected output panel incorrectly displays input data (Fixes #20)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/20)**: Fixed panel data binding to properly show expected output instead of input.
- **[[BUG] Remaining Vietnamese Strings (Fixes #19)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/19)**: Completed localization by translating remaining Vietnamese strings to English.
- **[[BUG] Output buffering: Input prompts appear after user input in C programs (Fixes #18)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/18)**: Improved terminal buffer handling to ensure proper prompt/input ordering.
- **[[UI] Window size and position resets on restart (Fixes #16)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/16)**: Window bounds are now persisted and restored correctly across sessions.
- **[[Editor] Auto-indentation missing after control statements (if/loop) (Fixes #15)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/15)**: Fixed automatic indentation after control structures.
- **Native Confirm Dialog Blocking Input**: Fixed issue where native confirm dialogs would block all input until window regain focus via alt-tab.
- **Auto-Update Stuck at 100%**: Fixed issue where auto-update would get stuck at 100% download progress for unsigned builds due to signature verification error.
- **Panel Gap After Undocking**: Fixed empty space appearing in TESTS panel after undocking terminal or I/O.

### Improved
- **Lazy Loading Optimization**: Implemented lazy loading for Monaco Editor to prevent initialization conflicts and reduce startup time.
- **Input/Output Color Scheme**: Enhanced color differentiation between input and output panels for better readability.
- **Terminal Buffer Optimization**: Improved buffer management and input handling performance for faster and more responsive text input.
- **Confirm Dialog UX**: All confirmation dialogs now use theme-aware styling with CSS variables, ensuring proper contrast across all themes (including Sakura).
- **Sakura Theme Test Results**: Improved text contrast for test result status, summary stats, and action buttons on light backgrounds.
- **Performance Enhancements**: General performance optimizations for smoother operation.

## [1.0.2] - 2026-01-31

### Added
- **Auto-Update UI**: Added download progress bar to the update notification to show download status clearly.
- **Update Optimization**: Optimized the update process for better reliability.

### Fixed
- **[[BUG] Shortcut customization not working (Fixes #14)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/14)**: Resolved issue where custom keybindings were not being saved/applied correctly.
- **[[BUG] Random keyboard input freeze in editor (Fixes #13)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/13)**: Fixed intermittent input freezing requiring restart.
- **[[BUG] Linker/Build error when switching C++ versions quickly (Fixes #12)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/12)**: Fixed race condition by using settings snapshot during build and deferring compiler settings changes until build completes.
- **[[BUG] Test Detail View ignores trailing output (Fixes #10)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/10)**: Corrected output comparison logic to handle trailing output/whitespace properly.
- **[[BUG] Lỗi bản portable (Fixes #9)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/9)**: Addressed issues with the portable distribution build.

### Improved
- **Video Background Performance**: Video backgrounds now pause when window loses focus, reducing CPU/GPU usage when alt-tabbing.
- **Theme Customizer Cleanup**: Fixed potential video memory leak when closing theme customizer with video preview.
- **CSS Transition Optimization**: Replaced ~50 instances of `transition: all` with specific properties, reducing browser repaint overhead during hover/active states.
- **Panel Resizer Throttling**: Added requestAnimationFrame throttling to panel resize handlers for smoother dragging.

## [1.0.1] - 2026-01-29

### Fixed
- **[[Performance] High CPU/Memory usage or UI Lag observed (Fixes #6)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/6)**:
    - Implemented `Performance Mode` which optimizes background rendering (using `scroll` instead of `fixed` attachment) to reduce repaint lag.
    - Disabled heavy visual effects like `backdrop-filter` and minimap rendering in Performance Mode.
    - Limited terminal buffer size to 1000 lines to prevent DOM overload.
- **[[UI] Background Blur setting has no effect on main window (Fixes #5)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/5)**: Adjusted window transparency handling and backdrop filter application.
- **[[BUG] G++ fails to initialize on startup on specific machines (Fixes #4)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/4)**: Improved compiler path detection and initialization logic (LLD linker adjustments).
- **[[BUG] Created snippets do not trigger/expand (Fixes #3)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/3)**: Fixed snippet registration logic to correctly load user-defined snippets from `App.settings`.
- **[[BUG] Competitive Companion parser does not load template (Fixes #2)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/2)**: Fixed issue where the default code template was not applying when receiving problems from OJ.


### Added
- **External Terminal Integration**: Launch external terminal for interactive debugging and testing
- **Video Background Support**: Use custom video files as editor background with opacity control
- **Enhanced C++ IntelliSense**: Improved suggestions for STL functions, keywords, and common patterns
- **Performance Optimizations**: Faster compilation, improved editor responsiveness, optimized memory usage

### Changed
- Bundled GCC/MinGW compiler included in all distributions for seamless setup
- Improved theme rendering and editor performance

### Fixed
- Various stability improvements and bug fixes from beta releases

## [1.0.0-beta.9] - 2026-01-18

### Added
- **Documentation Overhaul**: Rewrote README, CONTRIBUTING with wiki-style format
- **Visual Badges**: New Wiki, Download, Website buttons in Sameko ocean style
- **Batch Testing UI**: Enhanced competitive programming test runner

### Changed
- **Modular Architecture**: Refactored main.js into app/ directory structure
- **PCH Logging**: Clearer precompiled header build status messages

### Fixed
- Various UI stability improvements and theme consistency fixes

## [1.0.0-beta.8] - 2026-01-01

### Added
- Maintenance release for stability improvements.
- Updated dependencies and internal optimizations.

## [1.0.0-beta.7] - 2025-12-29

### Added
- **AStyle Integration**: Professional C++ code formatting with `Ctrl + Shift + A`.
- **Auto-Save**: Customizable auto-save functionality with configurable intervals.
- **Template Manager**: Create and manage code templates for new files.
- **Custom Keybindings**: Ability to redefine shortcuts for various IDE actions.

## [1.0.0-beta.6] - 2025-12-28

### Added
- **Snippet Editor**: Built-in tool to create and manage custom IntelliSense code snippets.
- **IntelliSense Enhancements**: Improved keyword and snippet suggestions.
- **UI Glitches Fixes**: Improved modal backgrounds and theme consistency.

## [1.0.0-beta.5] - 2025-12-22

### Added
- **Smart Header Linking**: Automatically detects and links corresponding `.cpp` files when using `#include "header.h"`.
- **File Watcher**: Real-time detection of external file changes with prompt to reload.
- **Multi-file Compilation**: Improved handling of projects with multiple source files.

## [1.0.0] - 2025-12-14

### Added
- Initial release
- Monaco Editor integration with C++ syntax highlighting
- Multi-tab file management
- Split editor support
- Integrated terminal with interactive I/O
- Input/Expected output panels for testing
- Problems panel for compilation errors
- Kawaii Ocean theme (light and dark variants)
- Dracula theme
- Precompiled headers (PCH) support for faster compilation
- Customizable settings:
  - Font size and family
  - Tab size
  - Minimap toggle
  - Word wrap
  - C++ standard selection (C++11/14/17/20)
  - Optimization level
  - Time limit for execution
  - Custom background image
  - Accent color
- Keyboard shortcuts for all major actions
- Custom frameless window with native controls

[Unreleased]: https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/compare/v1.3.1...HEAD
[1.3.1]: https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/compare/v1.0.4...v1.1.0
[1.0.4]: https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/compare/v1.0.0...v1.0.4
[1.0.0]: https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/releases/tag/v1.0.0

