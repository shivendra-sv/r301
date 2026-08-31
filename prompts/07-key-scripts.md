# Prompt 07 — Key mint/revoke scripts (the v1 control plane)

You are an implementation session for r301.dev. Follow the CLAUDE.md **implementation-session protocol** (read it now). This file is your entire scope.

## Context

Auth works (06) but no key can exist outside tests. Per D14 there are **no key endpoints and no admin token** — the control plane is two local scripts that Shivendra runs. These unblock runbook Phase C (CI smoke keys + the Curastax pilot key).

**Read first:** `CLAUDE.md` · `PROGRESS.md` · PRD §7.6 Bootstrap (D14) · `docs/design.md` §10 (scripts live outside Worker code) · `docs/runbook.md` Phase C (the exact invocations it promises).

**Verify first:** prompt 06's acceptance commands.

## Objective

`apps/api/scripts/mint-key.ts` and `revoke-key.ts` (run via `tsx`; package.json gains `mint-key` / `revoke-key` script entries): mint generates locally via `services/keys.ts`, INSERTs **only prefix + hash + name + environment + created_at** through `wrangler d1 execute … --env <env> --remote` (or `--local`), prints the secret **exactly once** with a "shown once" warning; revoke sets `revoked_at` by prefix.

## Out of scope

- Any HTTP surface. Key listing beyond a trivial `--list` (skip unless free). Rotation automation (runbook procedure covers it).

## Spec references

- PRD §7.6/D14: secret never leaves the machine unhashed; DB stores prefix+hash only.
- `docs/runbook.md` Phase C: `pnpm mint-key --env staging --name ci-smoke` must work exactly as written (args: `--env staging|production|local`, `--name <label>`; local maps to `--local` against the top-level binding).
- D27: `tsx` is the approved runner.

## TDD mandate

Invoke **superpowers:test-driven-development**. The wrangler shell-out is thin glue; everything else is pure and tested:

1. Arg parsing: valid combos accepted; missing/unknown env or name → usage message, exit 1.
2. SQL construction: parameterized/escaped correctly; INSERT carries prefix (20), hash (64 hex), name, environment, created_at — and **never** the raw key.
3. Output: raw key printed exactly once to stdout with the warning; prefix echoed for later revoke reference.
4. Revoke SQL: `UPDATE api_keys SET revoked_at = … WHERE prefix = ? AND revoked_at IS NULL`; reports rows affected (0 → "not found / already revoked", exit 1).
5. Integration (in vitest, against the test D1 — not via subprocess): a row inserted with the exact SQL the script builds authenticates through prompt 06's middleware; after the revoke SQL runs, the same key → 401.

## Acceptance criteria

```bash
pnpm test && pnpm typecheck
pnpm --filter @r301/api exec wrangler d1 migrations apply DB --local
pnpm --filter @r301/api mint-key --env local --name smoke-dev     # prints r301_live_… once + prefix
pnpm --filter @r301/api revoke-key --env local --prefix <printed prefix>   # reports 1 row revoked
```

## Done ritual

1. From repo root: `pnpm test` and `pnpm typecheck` — both green.
2. Update `PROGRESS.md`: row 07 → done (date, notes: **runbook Phase C is now unblocked** — flag for Shivendra); next pointer → prompt 08.
3. Commit: `feat(api): mint/revoke key scripts [prompt 07]`.
4. Stop. Do not start prompt 08. Anything off-spec → deviation log with a question.
