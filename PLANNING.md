# Planning rules (for AI agents and contributors)

How multi-session work is planned in this repo. Read this before creating anything under `plans/`.

`plans/` is **gitignored** — this file lives at the repo root so the rules survive a fresh clone
even though the plans themselves do not.

## Structure

Every plan is a folder named after the feature:

```
plans/<feature-slug>/
├── CONTEXT.md              # Immutable facts: why, architecture, verified truths, out-of-scope
├── CHECKLIST.md            # Mutable state: phase table, execution order, deviations, session log
├── phase-01-<slug>.md      # One phase = one session. Self-contained.
├── phase-02-<slug>.md
└── _baseline/              # optional: screenshots, measurements, original outputs to diff against
```

Older plans (`plans/debugger/`, `plans/linux-support/`, `plans/theme-customizer/`) use a single
merged `00-OVERVIEW.md` instead of `CONTEXT.md` + `CHECKLIST.md`. That is fine — **do not migrate
them**. New plans use the split.

Why split: agents update progress constantly. When state and facts share a file, the facts get
rewritten and the plan loses its ground truth. `CONTEXT.md` is read-only for the executing agent.

## Hard rules

1. **Each phase is self-contained.** Full paths, verbatim current-code snippets, the replacement
   code, verify commands, acceptance criteria. Assume the reader has never seen the conversation
   that produced the plan — because after a compact, it hasn't.
2. **Size a phase to one session**: ≤ 5 files, ≤ ~200 lines of diff. Bigger → split it.
3. **Write plans against real code.** Read the files first; record `git rev-parse --short HEAD` in
   `CONTEXT.md`. Every "Current code" block is a snapshot at that commit — line numbers drift.
4. **Every phase needs a `## Deviations` section.** If the real code differs from the plan, the
   executing agent **stops and writes it down** instead of improvising.
5. **Acceptance criteria must be measurable.** At least one command with a PASS/FAIL output.
   Anything that cannot be checked on the dev machine is marked `⛔ MANUAL` so nobody ticks it blind.
6. **Fence the scope.** Each phase states *"do NOT touch X — that belongs to phase Y."*
7. **Never commit** unless the user asks. Never commit under an AI identity (see `CLAUDE.md`).

## Phase header

```
> Prereq: phase 1 | Risk: 🟢/🟠/🔴 | Files: a.js, b.js | Rollback: git checkout -- <files>
```

- 🟢 near copy-paste · 🟠 editing existing logic · 🔴 substantial new code or order-sensitive logic
- **🔴 phases require a human diff review.** Do not trust a self-reported "done" on those.

## Repo-specific notes

- There is **no test runner and no linter**. The default smoke test is `npm start` — the app opens
  with no red console errors. Phrase acceptance criteria around that.
- Run `npm run codegraph:sync` after a phase edits code, so the next session's lookups are accurate.
- `src/renderer/app.js` is ~7,800 lines. A phase touching it must name exact line ranges and cap the
  expected diff (`git diff --stat src/renderer/app.js`). Never instruct an agent to read it whole.
- Theme work has a single source of truth (`ThemeManager._getHardcodedThemes`, `ThemeTokens`) — a
  plan that re-hardcodes colors elsewhere is wrong by construction. See `CLAUDE.md` › Theme system.
- Main process (`app/`) vs renderer (`src/`) is a hard boundary. State which side a phase operates on.

## Audit pass

Before handing a plan to another session or a smaller model, audit it against the real code:

- Does any step produce a value (empty string, missing file, wrong literal) that makes a *later*
  phase's acceptance criteria unreachable?
- Is every "this file already exists" assumption verified with an actual command?
- If a sentence has a second reasonable reading, what breaks under that reading?

Report blockers (plan cannot reach its goal) separately from quality issues, and fix the plan files
directly rather than only listing the findings in chat.
