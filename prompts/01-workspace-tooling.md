# Prompt 01 — Workspace tooling: dependencies + test harness

You are an implementation session for r301.dev. Follow the CLAUDE.md **implementation-session protocol** (read it now). This file is your entire scope.

## Context

The repo is a scaffold: docs + config exist, zero dependencies installed, zero source files. This prompt makes the workspace real: install the approved dependency set, stand up the Vitest Workers test harness, and prove it with a walking-skeleton Worker. Everything later builds on this harness.

**Read first:** `CLAUDE.md` · `PROGRESS.md` · `docs/decisions.md` D27 · `docs/testing.md` §2 · `apps/api/wrangler.toml`.

**Verify first (prompt 00 = scaffold):** `ls apps/api/migrations prompts docs` shows the Phase 2 layout; `git log --oneline` shows the scaffold commit.

## Objective

`pnpm install` from root succeeds with a committed lockfile; `pnpm test` runs real tests **inside workerd** with `DB`/`REDIRECTS` bindings; `pnpm typecheck` green; `pnpm --filter @r301/api dev` serves a 404-everything Worker.

## Out of scope

- Any endpoint, route logic, schema/migration, auth, telemetry (prompts 02+).
- Pinning dependency versions by hand — install current stable, let the lockfile pin.
- CI changes.

## Spec references

- `docs/decisions.md` **D27** — the approved dependency set. Nothing beyond it (`tsx` included). New need → ADR first.
- `docs/testing.md` §2 — harness requirements: workers pool reads `wrangler.toml`, isolated storage per test, migrations-from-zero in setup.
- PRD D25 — local-first: tests/dev touch zero Cloudflare resources.

## TDD mandate

Invoke **superpowers:test-driven-development**; red → green → refactor. Infrastructure counts: write the failing test, then make the harness/config pass it. Behaviors to test, in order:

1. A fetch to the Worker for any path returns **404** (walking skeleton: `src/index.ts` exports a fetch handler; minimal Hono app is fine).
2. The test env exposes a working **D1 binding** (`env.DB`: trivial `SELECT 1`).
3. The test env exposes a working **KV binding** (`env.REDIRECTS`: put → get roundtrip).
4. Storage isolation: a value put in one test is absent in the next (`isolatedStorage`).

Implementation notes: `vitest.config.ts` uses `@cloudflare/vitest-pool-workers` pointed at `wrangler.toml`; add a setup file that applies every file in `migrations/` in order (dir is empty today — must be a no-op that prompt 02 lights up; see `cloudflare:test` `applyD1Migrations` in current pool-workers docs — verify current API via context7/docs, do not trust memory). Hand-write `src/types.ts` `Env` (DB, REDIRECTS, ENVIRONMENT; SENTRY_DSN?, GIT_SHA? optional for later prompts). Record **resolved versions** of all D27 packages in PROGRESS notes.

## Acceptance criteria

```bash
pnpm install                      # succeeds; pnpm-lock.yaml created and committed
pnpm test                         # ≥4 tests, all green, running in the workers pool
pnpm typecheck                    # green, strict flags intact (no tsconfig loosening)
pnpm --filter @r301/api dev       # then: curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/anything → 404
```

## Done ritual

1. From repo root: `pnpm test` and `pnpm typecheck` — both green.
2. Update `PROGRESS.md`: row 01 → done (date, notes incl. **resolved dependency versions**); next pointer → prompt 02.
3. Commit: `chore(api): workspace deps + vitest workers harness [prompt 01]`.
4. Stop. Do not start prompt 02. Anything off-spec → deviation log with a question.
