# Prompt 20 — Full smoke test + M1 exit sweep

You are an implementation session for r301.dev. Follow the CLAUDE.md **implementation-session protocol** (read it now). This file is your entire scope.

## Context

All P0 endpoints exist (01–19). This prompt closes M1: upgrade the smoke script from health-only (05) to the full lifecycle round-trip CI runs after every deploy, then sweep the milestone — prove the PRD's P0 list is actually covered and leave PROGRESS.md telling Shivendra exactly what manual steps remain before the pilot.

**Read first:** `CLAUDE.md` · `PROGRESS.md` · `docs/testing.md` §5 (the smoke sequence — normative) · PRD §6 P0 list, §14, §18 · `.github/workflows/deploy-*.yml` · `docs/runbook.md` Phases B–D.

**Verify first:** prompt 19's acceptance commands.

## Objective

`scripts/smoke.ts` implements the full §5 sequence (health → create tagged `smoke` → fetch → manual-redirect check → stats → delete → redirect-404) against `SMOKE_API_BASE`/`SMOKE_REDIRECT_BASE`/`SMOKE_API_KEY`; **missing `SMOKE_API_KEY` → hard fail** with a message pointing at runbook Phase C. Plus the M1 sweep recorded in PROGRESS.md.

## Out of scope

- New endpoints or behavior changes. Fixing non-trivial gaps the sweep finds — log them as open questions instead (protocol rule 3).

## Spec references

- `docs/testing.md` §5: exact sequence, ~8 requests (D25 quota discipline), exit non-zero on any mismatch, no count assertion (async counting).
- PRD §14: smoke runs post-deploy on both envs; workflows already wire env vars — verify names match the script exactly.

## TDD mandate

Invoke **superpowers:test-driven-development** for the script's testable core: extract the sequence as pure steps (request builder + response asserter) unit-tested with a stubbed fetch; the CLI wrapper stays thin. Behaviors:

1. Each step's asserter: correct pass/fail on shape mismatches (wrong status, wrong Location, missing fields).
2. Redirect step uses `redirect: "manual"` and asserts 302 + exact `Location`.
3. Missing `SMOKE_API_KEY`/base URLs → exit 1 with the runbook-C message; any step failure → exit 1 naming the step; success → exit 0 with a one-line summary.
4. Cleanup: the smoke link is deleted even when a later step fails (best-effort finally).

**M1 sweep (recorded, not coded):** build a table in PROGRESS.md notes mapping every PRD §6 P0 item → the prompt/test that covers it; run `pnpm test` and `pnpm typecheck` fresh; list any uncovered item as an open question. Confirm workflows' smoke env var names match the script.

## Acceptance criteria

```bash
pnpm test && pnpm typecheck
pnpm --filter @r301/api exec wrangler d1 migrations apply DB --local
pnpm --filter @r301/api mint-key --env local --name smoke-local    # take key
pnpm --filter @r301/api dev &
SMOKE_API_BASE=http://127.0.0.1:8787 SMOKE_REDIRECT_BASE=http://127.0.0.1:8787 \
  SMOKE_API_KEY=<key> pnpm --filter @r301/api smoke && echo FULL-SMOKE-OK
```

## Done ritual

1. From repo root: `pnpm test` and `pnpm typecheck` — both green.
2. Update `PROGRESS.md`: row 20 → done; **M1 complete** — milestone checklist updated; note for Shivendra: staging deploy + runbook Phases B–D are what stand between here and the Curastax pilot (M2).
3. Commit: `feat(api): full smoke + M1 sweep [prompt 20]`.
4. Stop. M2 is pilot soak (no prompts); M3 prompts are stubs awaiting pilot learnings — do not detail them.
