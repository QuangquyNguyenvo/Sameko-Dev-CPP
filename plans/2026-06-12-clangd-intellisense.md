# Clangd IntelliSense Integration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate a standalone `clangd` LSP server into Sameko Dev C++ to provide smart, context-aware autocompletion, hover signatures, and diagnostics in Monaco Editor, optimized for low-end machines.

**Architecture:** Electron Main process runs a background child process of `clangd.exe` with low priority. It communicates using JSON-RPC over stdio. A custom lightweight bridge translates Monaco Editor completion/hover requests into JSON-RPC messages and returns them to the Renderer process.

**Tech Stack:** Node.js (`child_process`), Electron IPC, Monaco Editor Providers.

---

### Task 1: Create Clangd Service in Main Process

**Files:**
- Create: `app/services/syntax/clangd-service.js`
- Modify: `app/services/syntax/index.js`

**Step 1: Write the service implementation**
Create a service that manages `clangd.exe`, handles standard LSP JSON-RPC messages, and initializes/sends document synchronization notifications (`didOpen`, `didChange`).

**Step 2: Export from syntax index**
Modify `app/services/syntax/index.js` to initialize the `clangd` service and export functions for completions and hovers.

**Step 3: Verification**
Verify that importing `clangd-service.js` does not throw syntax errors, and the process spawns successfully when running `npm start`.

---

### Task 2: Implement IPC Communication Bridge

**Files:**
- Modify: `app/ipc/format-handlers.js`
- Modify: `preload.js`

**Step 1: Add IPC handlers in Main process**
Register IPC listeners for `get-clangd-suggestions` and `get-clangd-hover` in `app/ipc/format-handlers.js` that call the `clangd` service.

**Step 2: Expose IPC methods in Preload**
Add `getClangdSuggestions` and `getClangdHover` to `window.electronAPI` in `preload.js`.

**Step 3: Verification**
Verify that the IPC channels are registered and correctly exposed to the renderer context.

---

### Task 3: Hook Monaco Editor Providers to Clangd

**Files:**
- Modify: `src/features/suggestions/cpp-suggestions.js`

**Step 1: Register Monaco Completion Item Provider for Clangd**
Integrate `electronAPI.getClangdSuggestions` into Monaco's `registerCompletionItemProvider` for C/C++ files, falling back to local snippets if clangd is unavailable or returns empty results.

**Step 2: Register Monaco Hover Provider for Clangd**
Hook `electronAPI.getClangdHover` into Monaco's `registerHoverProvider` to display rich tooltips.

**Step 3: Verification**
Run `npm start` and verify autocomplete and hovers work on user-defined structs, classes, and STL containers.
