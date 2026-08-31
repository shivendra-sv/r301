# Prompt 03 — HTTP foundation: routing skeleton, request-id, error envelope

You are an implementation session for r301.dev. Follow the CLAUDE.md **implementation-session protocol** (read it now). This file is your entire scope.

## Context

Harness (01) and schema (02) exist; the Worker still 404s everything. This prompt builds the contract's *global* HTTP behaviors — the two-surface routing skeleton, request IDs, the error envelope, and content-type enforcement — so every later route inherits them instead of reimplementing them.

**Read first:** `CLAUDE.md` · `PROGRESS.md` · `docs/api-contract.md` §Global conventions + §Error envelope · `docs/design.md` §1, §8, §10 (module layout).

**Verify first:** prompt 02's acceptance commands.

## Objective

A structured Hono app (per design.md §10 layout) with: hostname-based surface split (API hosts mount `/v1/*`; redirect hosts mount slug + housekeeping routes — placeholder 404s for now), `X-Request-Id` on every response, the canonical error envelope for every error path, 405 handling, and JSON-only enforcement.

## Out of scope

- Auth (06), telemetry (04), health (05), any real /v1 or redirect logic (10+/12).
- The slug route's actual behavior — it exists only as "redirect surface returns 404 with minimal text, not JSON".

## Spec references

- `docs/api-contract.md`: envelope shape `{error:{code,message,field?,request_id}}`; code→status table; JSON-only (415 carries code `invalid_request`); strict-parse malformed JSON → 400.
- `docs/design.md` §1: surface split by hostname (production `r301.dev`/`api.r301.dev`, staging equivalents; **local/tests: both surfaces on any host** — `/v1/*` never collides with a slug since `v1` is reserved and slugs are single-segment).
- `docs/design.md` §8: request-id = `crypto.randomUUID()`, echoed in header, envelope, and (later) logs.

## TDD mandate

Invoke **superpowers:test-driven-development**. Behaviors to test (set the `Host` header explicitly in tests):

1. Every response — success, 404, 405, 500 — carries `X-Request-Id` (UUID shape).
2. Unknown `/v1/*` path on the API surface → 404 JSON envelope with `code: "not_found"`, `request_id` matching the header.
3. Wrong method on a known route shape → 405 `method_not_allowed` (register a throwaway test route or assert on `/v1/health` shape later — a placeholder route in test-only wiring is acceptable).
4. `POST` to `/v1/*` with a body and no/wrong `Content-Type` → 415, envelope code `invalid_request`.
5. `POST` with `Content-Type: application/json` but malformed JSON body → 400 `invalid_request`.
6. An unexpected thrown error inside a handler → 500 `internal` envelope (message generic — no stack/details leak).
7. Redirect-surface unknown path (e.g. `Host: r301.dev`, path `/nope!` …) → 404 **plain text**, not JSON.

## Acceptance criteria

```bash
pnpm test        # all above green
pnpm typecheck   # green
pnpm --filter @r301/api dev
curl -si http://127.0.0.1:8787/v1/nope | head -12   # 404 JSON envelope + X-Request-Id header
```

## Done ritual

1. From repo root: `pnpm test` and `pnpm typecheck` — both green.
2. Update `PROGRESS.md`: row 03 → done (date, notes); next pointer → prompt 04.
3. Commit: `feat(api): routing skeleton, request-id, error envelope [prompt 03]`.
4. Stop. Do not start prompt 04. Anything off-spec → deviation log with a question.
