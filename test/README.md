# Tests

```powershell
npm test                     # everything: unit first, then gui + e2e side by side
npm test -- --list           # IDs, names and files, no tests run
npm test -- 2-3 6            # suites 2 through 3, plus suite 6
npm test -- unit theme       # only matching suites in the unit group
npm test -- checker oj       # suites whose names contain either word
npm test -- -v docking       # one feature, with full suite output
npm run test:unit            # unit group
npm run test:gui             # the real app on a temp profile (Playwright + Electron)
npm run test:e2e             # the bundled toolchain (gdb)
```

IDs refer to the current catalog and stay the same when `--list` is filtered. Use names
or listed file paths in scripts that need to keep working as suites are added. The runner
checks the Monaco bundle once when it reaches a stage with selected GUI suites. Listing,
unit-only and debugger-only runs skip that step.

For a copy or documentation edit, review the diff and check the syntax of any edited code.
For a behavior change, select the suites that exercise it. Use the full run for changes
that affect several parts of the app or for release validation.

| Folder | What goes there | Speed |
|---|---|---|
| `unit/` | Plain Node: no Electron, no compiler. Pure logic (judge rules, theme tokens, the OJ bridge on a local port). | seconds |
| `gui/` | The real app through Playwright, on a throwaway profile (never the developer's own). | 10–60 s each |
| `e2e/` | Needs the bundled toolchain: gdb. Skips itself when the toolchain is missing. | ~5 s |
| `helpers/` | `app.js`: `launchApp()` and `checker()` (PASS/FAIL lines) for gui suites. | |

The browser extension keeps its own tests in `extension/test/`; `run.js` lists them too.

## UI previews

```powershell
npm run dev:preview -- theme-customizer
npm run dev:preview -- test-graph --screenshot
npm run dev:preview -- theme-customizer --theme kawaii-light --screenshot
```

`theme-customizer` opens Backgrounds with the theme's built-in video and a sample editor image.
`test-graph` opens a test row's editor with a directed, weighted graph. Both use the real
app on a temporary profile. Leave off `--screenshot` to interact with the preview until
you close it. With `--screenshot`, the command saves a 1440 × 900 PNG in your temp directory,
prints its path, and closes the app. Keep the same scenario and theme for before/after shots.

## Adding a suite

1. Write `test/<group>/<name>.js`. Print `  PASS  <check>` / `  FAIL  <check>` lines and exit
   non-zero on a failure; `run.js` counts those lines. A gui suite starts from
   `helpers/app.js` instead of copying the launch code of `gui/app.js`.
2. Add one line to `SUITES` in `run.js`.

Keep a suite about one feature. When one file grows past a few hundred lines, split it.
