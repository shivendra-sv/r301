# Prompt 05 — Health endpoint + smoke v1 + deploy SHA wiring

You are an implementation session for r301.dev. Follow the CLAUDE.md **implementation-session protocol** (read it now). This file is your entire scope.

## Context

Foundation + telemetry exist (03–04). This prompt closes M0: the unauthenticated health endpoint, a v1 smoke script (health-only — the full lifecycle smoke arrives in prompt 20, after the endpoints it exercises exist), and the CI wiring that stamps deploys with the git SHA. After this, the deploy pipeline is green end-to-end once Shivendra completes runbook Phase A.

**Read first:** `CLAUDE.md` · `PROGRESS.md` · PRD D25, §15 · `docs/api-contract.md` §health · `docs/testing.md` §5 · `.github/workflows/deploy-*.yml`.

**Verify first:** prompt 04's acceptance commands.

## Objective

`GET /v1/health` → `{status:"ok", version:<git sha|"dev">, env}` with no auth; `scripts/smoke.ts` v1 checks health against `SMOKE_API_BASE`; both deploy workflows pass `--var GIT_SHA:${{ github.sha }}` and Sentry `release` uses it.

## Out of scope

- The full smoke sequence (create/redirect/stats/delete) — **prompt 20**. Smoke v1 must not require `SMOKE_API_KEY`.
- Any other endpoint; uptime monitors (runbook Phase D).

## Spec references

- `docs/api-contract.md`: health shape, unauthenticated, 200.
- `docs/design.md` §9: Sentry release = GIT_SHA; PRD D25: "which deploy broke it" via health SHA.
- `docs/testing.md` §5: smoke runs via `pnpm --filter @r301/api smoke` (script entry already exists), driven by env vars, exits non-zero on mismatch.

## TDD mandate

Invoke **superpowers:test-driven-development**. Behaviors to test:

1. `GET /v1/health` → 200 `{status:"ok", version, env}`; `env` mirrors the `ENVIRONMENT` var.
2. No `Authorization` header required (and none consulted).
3. `version` falls back to `"dev"` when `GIT_SHA` is unset; equals the var when set.
4. Wrong method → 405 envelope (foundation already handles; assert on this route).
5. Smoke script (unit-test its pure parts; run it for real in acceptance): non-2xx or wrong body → exit 1 with a clear message; success → exit 0.

Workflow edits (`deploy-staging.yml`, `deploy-production.yml`): append `--var GIT_SHA:${{ github.sha }}` to the `wrangler deploy` commands. YAML is config, not TDD-able — eyeball + `git diff`.

## Acceptance criteria

```bash
pnpm test && pnpm typecheck
pnpm --filter @r301/api dev &
curl -s http://127.0.0.1:8787/v1/health | jq .            # {"status":"ok","version":"dev","env":"local"}
SMOKE_API_BASE=http://127.0.0.1:8787 pnpm --filter @r301/api smoke && echo SMOKE-OK
git diff --stat .github/workflows                          # both deploy files touched, --var GIT_SHA present
```

## Done ritual

1. From repo root: `pnpm test` and `pnpm typecheck` — both green.
2. Update `PROGRESS.md`: row 05 → done (date, notes: **M0 complete** — flag that runbook Phase A+B can now be exercised); next pointer → prompt 06.
3. Commit: `feat(api): health endpoint + smoke v1 + deploy SHA [prompt 05]`.
4. Stop. Do not start prompt 06. Anything off-spec → deviation log with a question.
