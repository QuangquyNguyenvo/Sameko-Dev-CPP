# Sameko Dev C++ Companion (browser extension)

A Manifest V3 extension that connects online-judge pages in your own browser to the
Sameko Dev C++ app. The app asks it, over `http://127.0.0.1:27121/sameko/v1/*`, to submit a
source file or to read a problem. The extension does the work inside the browser session you are
already logged in to, so the app never sees cookies or passwords. `PROTOCOL.md` is the contract.

Supported judges in v1: Codeforces (with the m1/m2/m3 mirrors), AtCoder, CSES, DMOJ, VNOI and
LQDOJ. The four adapters in `adapters/` are **stubs for now**: they register, but treat every
page as `other`.

## Load it unpacked (Chrome / Edge ≥ 116)

1. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
2. Click **Load unpacked** and pick this `extension/` folder. There is no build step.
3. Start Sameko Dev C++. When the app shows the extension's pairing request, click **Allow**.
   The toolbar popup shows the connection state.

After you edit a file, click the reload icon on the extension's card, then reload any open OJ
tabs. Content scripts in tabs that were already open keep the old code.

## Debugging

- **Service worker:** on the extension card, click *Inspect views: service worker*. The bridge
  and jobs log with the `[Sameko]` prefix. `chrome.storage.session.get(null)` in that console
  shows the connection state, jobs per tab (`jobTabs`), the event queue and other state.
- **Content script:** open DevTools on the OJ tab and choose the extension's context in the
  console's context dropdown.
- **Popup:** right-click the popup and choose *Inspect*.

## Adding an adapter

1. Copy `test/mock-oj/adapter.js`. It is a complete, commented adapter and the worked example.
   Write `adapters/<id>.js` from the judge's real HTML, not from memory, and save that HTML under
   `test/fixtures/<id>/`.
2. Add the file to `content_scripts[0].js` in `manifest.json`, before `content/main.js`, and add
   each host to both `content_scripts[0].matches` and `host_permissions`. The worker imports
   adapters from that manifest list, so nothing else needs to change.
3. Do not touch the DOM at load time, because the worker loads the file too. Use the shared
   helpers: `pickLanguage`, `normalizeVerdict`, `isPendingVerdict`, `parseTimeMs` and
   `parseMemoryKb` in `shared/adapters.js`, plus `h.*` in `fillAndSubmit`.
4. Add tests for `classify`, `submitUrl`, `parseProblem` and `readVerdict` against your fixtures.

## Tests

```sh
node extension/test/run.js          # unit + integration (also part of `npm test`), ~4 s
node extension/test/e2e.js          # real browser: Edge/Chrome headless, mock OJ + stub app (not in npm test)
```

`run.js` covers the registry and `pickLanguage`, runs the bridge against an in-test server that
implements PROTOCOL §1, runs the job state machines against a fake `chrome`, and smoke-tests
the mock OJ. `e2e.js` loads a dev copy into a locally installed Chromium browser (`--browser
<path>` to pick one, `--headful` to watch it) and does a whole submit, a rejected resubmit, both
kinds of `fetchProblem`, and a check of the popup.

### Trying it by hand against the mock OJ

```sh
node extension/test/mock-oj/server.js            # http://localhost:27190/
node extension/test/stub-app.js --approve        # stand-in app on 127.0.0.1:27121 (or run the real app)
node extension/test/make-dev.js                  # writes extension/.dev/ (adds the mock adapter)
```

Load `extension/.dev/` unpacked instead of `extension/`. Log in at
`http://localhost:27190/login?as=alice&next=/problem/A`, then queue commands on the stub app:

```sh
curl -X POST http://127.0.0.1:27121/stub/queue -d "{\"type\":\"submit\",\"id\":\"s1\",\"url\":\"http://localhost:27190/problem/A\",\"source\":\"int main(){}\",\"language\":\"cpp\",\"std\":\"c++17\",\"autoSubmit\":true}"
curl -X POST http://127.0.0.1:27121/stub/queue -d "{\"type\":\"fetchProblem\",\"id\":\"f1\"}"
```

The stub app prints every event it receives. To point the dev copy at a stub on another port,
use `make-dev.js --app-url http://127.0.0.1:<port>`. `.dev/` is gitignored. Run `make-dev.js`
again after you edit files.

The icons in `icons/` are generated placeholders, not the app's artwork.
