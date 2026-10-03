# Planning rules

Read this only when creating, auditing, or executing a **persistent** plan under `plans/`.
Ordinary work that fits the current session does not need a plan file.

## Choose the smallest format

- **Compact plan (default):** `plans/<feature>/PLAN.md` for approval, resume, or a few tightly
  related changes.
- **Handoff plan:** `CONTEXT.md` + `CHECKLIST.md` + phase files only when work genuinely spans
  sessions/models or the user explicitly requests phased handoff.
- Claude Plan Mode and a plan on disk are alternative deliverables. Do not write the same plan twice.
- Keep legacy layouts in `debugger/`, `linux-support/`, and `theme-customizer/` unchanged.
- In a handoff plan, mutable progress goes in `CHECKLIST.md` only; do not copy phase details into it.

## Content

A compact `PLAN.md` needs only: goal/done, decisions, affected paths and symbols, implementation
outline, out of scope, and verification.

For a handoff plan:

- `CONTEXT.md`: shared verified facts, decisions, architecture/invariants, and out of scope.
- `CHECKLIST.md`: phase table, current status, material deviations, and short session log.
- Each phase: goal, files/symbols, intended behavior, non-obvious invariants, exclusions, verify,
  and deviations. Number phases in execution order.

Prefer `path` + symbol/section + intended behavior. Include a short exact snippet only when syntax,
ordering, a literal, or an API contract would otherwise be ambiguous. Never copy both the full
current code and full replacement code by default.

Soft budgets: `PLAN.md` 40–120 lines; `CONTEXT.md` 40–100; `CHECKLIST.md` 20–60; each phase
40–120. Remove repetition before creating more files.

## Execution and safety

1. Inspect the relevant real code first; use CodeGraph before broad text search. Record the commit
   SHA only for a handoff whose snapshots depend on it.
2. Split by independently verifiable outcomes, not an arbitrary file count. A file may appear in
   multiple phases when necessary; state ownership and avoid overwrite assumptions.
3. Use observable acceptance criteria and at least one automated check when the repo provides one.
   Mark UI/external checks as manual.
4. Harmless drift: record briefly and continue. Stop only when drift changes architecture, scope,
   data, permissions, public contracts, or risk.
5. Do not prescribe destructive rollback (`git checkout --`, hard reset) for a dirty worktree.
   Describe the inverse change or rely on a reviewed diff/approved commit boundary.
6. Never commit unless the user asks.

## Repo-specific verification

- The available checks are `npm run test:debugger`, `npm run test:gui` and a manual `npm start`;
  see "Verifying a change" in `AGENTS.md`. Mark UI behavior that none of them covers as manual.
- Run `npm run codegraph:sync` after code edits that should be visible to the next session.
- The invariants and context-budget rules in `AGENTS.md` apply to every phase; reference them
  instead of restating them in plan files.

## Audit before handoff

Check that dependencies make later phases reachable, referenced files/APIs/commands exist,
verification measures behavior, scope and rollback are safe, and no explanation or code snapshot is
duplicated across files. Report blockers before quality issues. Audit alone does not authorize code
or plan edits unless the user asks for them.
