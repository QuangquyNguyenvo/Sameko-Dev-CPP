# Sameko Companion — protocol and adapter contract (v1)

The browser extension in this folder connects an online judge (OJ) page in the user's own
browser to the Sameko Dev C++ desktop app. The app never sees cookies or passwords: it sends
"submit this source to this problem" over localhost and the extension does it inside the
browser session the user is already logged in to.

This file is the contract between the two sides. Change it in the same commit as the code.

```
 app renderer ──IPC──► app main ◄──HTTP 127.0.0.1:27121──► extension service worker ──► content script (OJ tab)
 (Submit button)        (bridge)      /sameko/v1/*            (jobs, tabs)                (adapter: parse / fill / verdict)
```

## 1. Transport

- The app already listens on `127.0.0.1:27121` for Competitive Companion (`POST /`). That
  route is unchanged. The extension uses `/sameko/v1/*` on the same server.
- Plain HTTP + JSON, long polling. No WebSocket, no new npm dependency.
- The extension always initiates. The app answers; commands for the extension ride on the
  response of a long poll.
- Every `/sameko/v1/*` request must carry an `Origin` of `chrome-extension://…` or
  `moz-extension://…`. Anything else (a web origin, or none) gets `403`. Web pages can reach
  127.0.0.1 but cannot forge `Origin`.
- Bodies are UTF-8 JSON, at most 4 MiB. Responses are JSON with `Content-Type: application/json`.
- No CORS headers are needed (the extension has host permission for `http://127.0.0.1/*`).

### Pairing

An extension origin must be approved once in the app before it can receive source code.

1. Extension sends `hello`. Unknown origin → app answers `paired:false` and shows the user a
   prompt ("A browser extension wants to connect — Allow / Deny").
2. Extension repeats `hello` every 2 s until `paired:true` (or the user denies: `denied:true`,
   then it stops and the popup offers "Try again").
3. Approved origins persist in the app (`userData/state/oj-extension.json`,
   `{ "approved": ["chrome-extension://<id>"] }`). A denial lasts until the app restarts or
   until the extension sends `hello` with `"retry": true` (the popup's "Try again"), which
   clears the denial and prompts the user again.
4. The app prompts once per origin (not on every 2 s `hello`). The prompt that is still
   unanswered is exposed as `pendingPair` in the bridge status (§5), so a renderer that
   started late can still show it.

### Endpoints

#### `POST /sameko/v1/hello`
```jsonc
// request
{ "protocol": 1, "extVersion": "0.1.0", "browser": "chrome",
  "retry": false,              // true: forget an earlier denial of this origin and prompt again
  "adapters": [ { "id": "codeforces", "name": "Codeforces", "hosts": ["codeforces.com"] } ] }
// response 200
{ "ok": true, "paired": true, "denied": false, "protocol": 1,
  "app": { "name": "Sameko Dev C++", "version": "1.4.2" },
  "theme": { /* §4, may be null */ } }
```
`protocol` mismatch → `200 { ok:false, error:"protocol", protocol:1 }`.

#### `POST /sameko/v1/poll`
Body `{ "wait": 25 }`. It is a POST because Chromium sends no `Origin` header on a GET from an
extension that has host permission (seen in Edge 157), and the Origin check needs one.
Held open up to `wait` seconds (clamped 1–30) until a command is queued.
```jsonc
// 200
{ "commands": [ /* §2, possibly empty */ ], "theme": { /* §4 or null, only when it changed since the last poll */ } }
// 401 when the origin is not paired
{ "error": "unpaired" }
```
One poller at a time: a newer poll makes the older one return `{ "commands": [] }` at once.
The app considers the extension **connected** while a poll is pending or one ended < 5 s ago.

#### `POST /sameko/v1/events`
```jsonc
{ "events": [ /* §3 */ ] }     →  200 { "ok": true }      (401 when unpaired)
```

## 2. Commands (app → extension)

```jsonc
{ "type": "submit", "id": "s_1731300000000_1",
  "url": "https://codeforces.com/contest/1900/problem/A",   // the problem URL
  "source": "#include <bits/stdc++.h>\n…",
  "language": "cpp",            // cpp | c | python | java | pascal | rust | go | kotlin | csharp | javascript
  "std": "c++17",               // optional hint, cpp/c only
  "fileName": "a.cpp",
  "autoSubmit": true }          // false: fill the form and stop

{ "type": "fetchProblem", "id": "f_1731300000000_2",
  "url": "https://atcoder.jp/contests/abc300/tasks/abc300_a" }   // url omitted/null: the OJ problem tab the user looked at last
```
A command nobody polled for within 60 s is dropped; the app reports it to the renderer as
failed with `error.code = "no-extension"`.

## 3. Events (extension → app)

```jsonc
{ "type": "problem",
  "requestId": "f_…",        // present when answering fetchProblem
  "auto": false,             // true: sent because the user opened the page with auto-send on
  "problem": {               // Competitive Companion's shape; the app sanitises it the same way
    "name": "A. Cover in Water", "group": "Codeforces - Round 911",
    "url": "https://codeforces.com/contest/1900/problem/A",
    "timeLimit": 1000, "memoryLimit": 256,          // ms, MB
    "tests": [ { "input": "…\n", "output": "…\n" } ] } }

{ "type": "fetchFailed", "requestId": "f_…",
  "error": { "code": "no-problem-tab", "message": "No online judge problem is open in the browser." } }

{ "type": "submitStatus", "id": "s_…",
  "state": "opened",          // opened → filled → submitted → judging → done   |   failed
  "message": "Running on test 7",        // optional, free text from the judge (judging)
  "submissionUrl": "https://…",          // when known
  "verdict": {                           // only with state "done"
    "code": "WA",              // AC WA TLE MLE RE CE OLE IE PARTIAL OTHER
    "text": "Wrong answer on test 7",    // the judge's own wording
    "test": 7, "timeMs": 46, "memoryKb": 1024, "points": null },
  "error": {                             // only with state "failed"
    "code": "not-logged-in",   // not-logged-in | unsupported-site | language-not-found | form-not-found
                               // | rejected | timeout | tab-closed | no-extension | internal
    "message": "Log in to Codeforces in this browser, then submit again." } }
```
`filled` is the terminal state when `autoSubmit` is false.

## 4. Theme snapshot (app → extension)

So the popup looks like the app's current theme. All colours are CSS colour strings.
```jsonc
{ "id": "kawaii-dark", "variant": "dark",
  "bg": "#1a1b26", "surface": "#24283b", "border": "#414868",
  "text": "#c0caf5", "textMuted": "#565f89",
  "accent": "#ff9eb5", "accentText": "#1a1b26",
  "success": "#9ece6a", "warning": "#e0af68", "error": "#f7768e" }
```
The extension caches the last snapshot in `chrome.storage.local` and falls back to a built-in
copy of the app's default dark/light theme (by `prefers-color-scheme`) before the first one.

## 5. App IPC (renderer ↔ main)

| preload function | channel | direction | payload |
|---|---|---|---|
| `ojBridgeStatus()` | `oj-bridge-status` | invoke | → `{ running, connected, paired, browser, extVersion, adapters, pendingPair }` (`pendingPair`: `{ origin, browser, extVersion }` or null) |
| `onOjBridgeStatus(cb)` | `oj-bridge-status-changed` | main → renderer | same object |
| `ojSubmit(job)` | `oj-submit` | invoke | `{ url, source, language, std, fileName, autoSubmit }` → `{ success, id }` or `{ success:false, error }` |
| `ojFetchProblem(req)` | `oj-fetch-problem` | invoke | `{ url? }` → `{ success, id }` |
| `onOjSubmitStatus(cb)` | `oj-submit-status` | main → renderer | a `submitStatus` event (§3) |
| `onOjFetchFailed(cb)` | `oj-fetch-failed` | main → renderer | a `fetchFailed` event (§3) |
| `onOjPairRequest(cb)` | `oj-pair-request` | main → renderer | `{ origin, browser, extVersion }` |
| `ojPairRespond(r)` | `oj-pair-respond` | invoke | `{ origin, allow }` → `{ success }` |
| `ojSetTheme(t)` | `oj-set-theme` | invoke | a theme snapshot (§4) |
| `onProblemReceived(cb)` | `problem-received` (existing) | main → renderer | the problem, plus `via: "sameko"`, `auto`, `requestId` when it came from this extension |

`adapters` is the list from `hello`; the renderer uses `hosts` to tell whether a problem URL can
be submitted. A problem that arrives with `auto: true` must not raise or focus the app window.

## 6. Extension layout

Manifest V3, Chromium ≥ 116 first; no build step (load unpacked from this folder). Use only
`chrome.*` APIs that also exist as promise APIs in Firefox, so a Firefox manifest can follow.

```
extension/
  manifest.json
  background/service-worker.js     classic worker; importScripts() the files below
  background/bridge.js             hello / poll loop / events, pairing, reconnect
  background/jobs.js               submit + fetch job state machine, tab tracking
  shared/adapters.js               globalThis.SamekoAdapters registry + pure helpers (language picking, verdict codes)
  adapters/<id>.js                 one per OJ; loaded by the worker AND as content scripts
  content/main.js                  runs on OJ pages: asks the worker for its job, drives the adapter
  content/page-world.js            functions executed in the page's MAIN world (set Ace/Monaco/CodeMirror text)
  popup/popup.{html,css,js}        status, pairing, toggles, recent submissions
  icons/
  test/                            node tests with a fake chrome.*, fixtures, mock OJ
```

Keeping the worker alive: while the app is reachable the poll loop keeps it awake (each cycle
also calls a cheap `chrome.*` API). When the app is not running the worker may sleep; a
`chrome.alarms` alarm every 30 s, any OJ page load and opening the popup all retry `hello`.

### Submit job

1. Worker gets `submit` → finds the adapter by URL (`unsupported-site` if none) → opens
   `adapter.submitUrl(url)` in a tab (reusing the previous submit tab of that adapter if it is
   still open) → records `{ job, stage:"fill" }` for that tab in `chrome.storage.session` →
   event `opened`.
2. `content/main.js` on that tab asks the worker `whoami`; gets the job and stage.
3. Stage `fill`: `adapter.isLoggedIn()` (else `not-logged-in`), `adapter.fillAndSubmit()`.
   The content script tells the worker `submitted` **before** triggering navigation, so the
   stage is already `watch` when the next page loads.
4. Stage `watch`: on each page the tab lands on, `adapter.readVerdict()` is called on DOM
   changes and at least once a second; non-final results → `judging`, final → `done`.
5. Limits: 60 s to reach `submitted`, 10 min to reach `done`, tab closed → `tab-closed`.

### Adapter contract

An adapter file must not touch the DOM at load time (the worker imports it too).

```js
SamekoAdapters.register({
  id: 'codeforces',
  name: 'Codeforces',
  hosts: ['codeforces.com'],                    // exact hosts; also listed in manifest.json matches

  // pure — usable in the worker
  classify(url)            // → { kind: 'problem' | 'submit' | 'status' | 'other' }
  submitUrl(problemUrl)    // → URL of the page that holds the submit form, or null

  // DOM — content script only
  parseProblem(doc, url)   // → problem object (§3) or null when this is not a problem page
  isLoggedIn(doc)          // → boolean
  async fillAndSubmit(doc, job, h)
      // job: the submit command (§2). Fill the form; when job.autoSubmit, call
      // `await h.aboutToSubmit()` and then submit. Throw h.error(code, message) on failure.
  readVerdict(doc, url, job)
      // → null (nothing yet) or { final, code, text, test, timeMs, memoryKb, points, submissionUrl }
      // In the watch stage `job.submittedAt` (ms) is set; use it, and anything the adapter saved in
      // the page's sessionStorage before submitting, so an older submission's verdict is never reported.
  readSubmitError(doc, url, job)
      // optional → message string when the judge re-showed the form with an error
      // (reported as failed / rejected), else null
});
```

Helpers passed as `h`: `h.error(code, message)`, `h.aboutToSubmit()`,
`h.pickLanguage(options, job, preferences)` (options: `[{ value, text }]`),
`h.setValue(el, text)` (native setter + input/change events), `h.setFile(input, name, text)`,
`h.setEditorText(selector, text)` (MAIN world: Ace / CodeMirror / Monaco behind `selector`),
`h.waitFor(fn, timeoutMs)`.

`fetchFailed` codes: `no-problem-tab`, `unsupported-site`, `parse-failed`, `timeout`,
`tab-closed`, `no-extension`, `internal`.

Adapters are written from the real page HTML, never from memory. Each has fixture HTML under
`test/fixtures/<id>/` and a `test/adapters/<id>.cases.js` covering `classify`, `submitUrl`,
`parseProblem` and `readVerdict`, run by `test/adapter-fixtures.js` (format in its header).
