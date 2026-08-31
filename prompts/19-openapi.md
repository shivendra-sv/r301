# Prompt 19 — GET /v1/openapi.json

You are an implementation session for r301.dev. Follow the CLAUDE.md **implementation-session protocol** (read it now). This file is your entire scope.

## Context

Every /v1 route exists and was built on `@hono/zod-openapi` definitions (10+). This prompt assembles and serves the spec — after which **code becomes canonical over docs/api-contract.md** (that file says so itself).

**Read first:** `CLAUDE.md` · `PROGRESS.md` · PRD §8 Spec (D22) · `docs/api-contract.md` (cross-check target) · current `@hono/zod-openapi` doc-route docs (via context7 — do not trust memory).

**Verify first:** prompt 18's acceptance commands.

## Objective

`GET /v1/openapi.json` (unauthenticated): OpenAPI **3.1** document covering every /v1 endpoint with request/response schemas, the error envelope as a shared component, bearer security scheme applied to authenticated routes, `info.version` = the deployed version string.

## Out of scope

- The Scalar docs UI (P1, `docs.r301.dev`). The apex redirect surface (not part of the /v1 API spec). Restructuring existing routes beyond what spec assembly requires.

## Spec references

- PRD §8/D22: OpenAPI 3.1 from Zod, served at `/v1/openapi.json`, P0, unauthenticated.
- `docs/api-contract.md` — the spec must agree with it; disagreements are deviations to log, not silently resolve.

## TDD mandate

Invoke **superpowers:test-driven-development**. Behaviors:

1. `GET /v1/openapi.json` → 200, no auth, `openapi` field starts `3.1`.
2. Paths present (exact set): `/v1/links`, `/v1/links/batch`, `/v1/links/{slug}`, `/v1/links/{slug}/stats`, `/v1/stats`, `/v1/tags`, `/v1/health`, `/v1/openapi.json` may self-omit — assert the first seven.
3. Methods per path match the contract (e.g. `/v1/links`: get+post; `/v1/links/{slug}`: get+patch+delete).
4. The error envelope appears as a component and is referenced by at least the 4xx responses of `/v1/links` post.
5. Bearer security scheme declared; applied to protected routes; absent on `/v1/health`.
6. Spec cross-check test: every route registered in the Hono app under `/v1` (introspect the router) appears in the spec — a new route added without spec coverage fails this test forever after.
7. **405 sweep** (PROGRESS question 5, resolved 31 Aug 2026): assert that **every** registered `/v1` path answers **405**, not 404, to a bogus method. Hono has no built-in 405 — `methodNotAllowed(app, path)` must be called per path after that path's handlers (prompt 03), so a route prompt that forgets it fails silently as a 404. Drive the sweep from the same route list the OpenAPI document is generated from, so a new path cannot escape it.

## Acceptance criteria

```bash
pnpm test && pnpm typecheck
pnpm --filter @r301/api dev &
curl -s http://127.0.0.1:8787/v1/openapi.json | jq '.openapi, (.paths|keys)'   # "3.1.x" + the path list
```

## Done ritual

1. From repo root: `pnpm test` and `pnpm typecheck` — both green.
2. Update `PROGRESS.md`: row 19 → done (date, notes: **api-contract.md now commentary; code canonical**); next pointer → prompt 20.
3. Commit: `feat(api): openapi.json [prompt 19]`.
4. Stop. Do not start prompt 20. Anything off-spec → deviation log with a question.
