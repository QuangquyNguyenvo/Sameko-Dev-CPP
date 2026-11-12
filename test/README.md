# Tests

```powershell
npm test                     # everything: unit first, then gui + e2e side by side
npm run test:unit            # plain Node only, a few seconds
npm run test:gui             # the real app on a temp profile (Playwright + Electron)
npm run test:e2e             # the bundled toolchain (gdb)
node test/run.js checker oj  # suites whose name contains a word
node test/run.js --list      # every suite, its group and file
node test/run.js -v gui      # print each suite's whole output
```

| Folder | What goes there | Speed |
|---|---|---|
| `unit/` | Plain Node: no Electron, no compiler. Pure logic (judge rules, theme tokens, the OJ bridge on a local port). | seconds |
| `gui/` | The real app through Playwright, on a throwaway profile (never the developer's own). | 10–60 s each |
| `e2e/` | Needs the bundled toolchain: gdb. Skips itself when the toolchain is missing. | ~5 s |
| `helpers/` | `app.js`: `launchApp()` and `checker()` (PASS/FAIL lines) for gui suites. | |

The browser extension keeps its own tests in `extension/test/`; `run.js` lists them too.

## Adding a suite

1. Write `test/<group>/<name>.js`. Print `  PASS  <check>` / `  FAIL  <check>` lines and exit
   non-zero on a failure; `run.js` counts those lines. A gui suite starts from
   `helpers/app.js` instead of copying the launch code of `gui/app.js`.
2. Add one line to `SUITES` in `run.js`.

Keep a suite about one feature. When one file grows past a few hundred lines, split it.
