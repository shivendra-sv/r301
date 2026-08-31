# Prompt 10 — POST /v1/links: create, tags, KV write-through

You are an implementation session for r301.dev. Follow the CLAUDE.md **implementation-session protocol** (read it now). This file is your entire scope.

## Context

Auth (06), validation (08), and slugs (09) exist. This prompt ships the first real endpoint: create — D1 insert with implicit tags, the **awaited** KV write-through (D20), and the canonical Link serialization every other endpoint reuses. Build the route with `@hono/zod-openapi` route definitions so the OpenAPI spec accrues (D22; assembled in prompt 19).

**Read first:** `CLAUDE.md` · `PROGRESS.md` · PRD §7.1 Create, §7.3, §9 KV note (D20) · `docs/api-contract.md` §POST /v1/links + §Link resource · `docs/design.md` §3, §10.

**Verify first:** prompt 09's acceptance commands.

## Objective

`POST /v1/links` (authenticated): schema → slug service → D1 insert (links + implicit `tags`/`link_tags`) → awaited KV put `{d,t,x,a}` → **201** Link. Plus `src/kv/redirects-cache.ts` (put/remove helpers — the only module that writes `REDIRECTS`) and `src/serializers/link.ts` (ISO timestamps, `short_url` from an env→redirect-host map, nulls for unset, **no counts**, D26).

## Out of scope

- Idempotency (11 wraps this route). Batch (17). Read/update/delete (14–16). Redirect serving (12).

## Spec references

- `docs/api-contract.md`: 201 body = Link resource exactly; error paths `invalid_request`/`destination_invalid`/`slug_reserved`/`slug_taken` with statuses per the table.
- D20 / design §3: D1 commits first, then the KV put is **awaited**; KV failure → 500 `internal` (the api-contract documents "retry with the same Idempotency-Key — it converges").
- §7.3: tags created implicitly on first use; ≤10 enforced by schema (08).
- D12: `created_by_key_id` = the authenticated key (attribution only).

## TDD mandate

Invoke **superpowers:test-driven-development**. Integration tests hit the route with a seeded key. Behaviors:

1. Minimal body (destination only) → 201; auto-slug shape; defaults (302, active, null expiry/external_id, `[]` tags); `short_url` uses the local redirect base; timestamps ISO 8601 Z.
2. Full body (custom slug, 301, future expiry, 3 tags, external_id) → 201 echoing all.
3. KV effect: after 201, `REDIRECTS[slug]` holds exactly `{d,t,x,a}` (a=1; x null or epoch-ms).
4. Tags: new names create `tags` rows once; reusing a name links to the existing row (no dup); `link_tags` rows correct.
5. Error paths: bad destination → 422 `destination_invalid`; reserved → 422; taken (live and tombstoned seed) → 409; unknown field → 400 naming it; unauthenticated → 401.
6. KV-put failure (stub the KV binding to throw): response 500 `internal`; the D1 row **exists** (documented state — idempotent retry heals in prompt 11); Sentry captured.
7. `created_by_key_id` recorded = the calling key's id.

## Acceptance criteria

```bash
pnpm test && pnpm typecheck
pnpm --filter @r301/api exec wrangler d1 migrations apply DB --local
pnpm --filter @r301/api mint-key --env local --name dev  # take the printed key
pnpm --filter @r301/api dev &
curl -s -X POST http://127.0.0.1:8787/v1/links -H "Authorization: Bearer <key>" \
  -H "Content-Type: application/json" -d '{"destination":"https://example.com"}' | jq .
# → 201-shaped Link JSON with slug + short_url
```

## Done ritual

1. From repo root: `pnpm test` and `pnpm typecheck` — both green.
2. Update `PROGRESS.md`: row 10 → done (date, notes); next pointer → prompt 11.
3. Commit: `feat(api): create link endpoint + KV write-through [prompt 10]`.
4. Stop. Do not start prompt 11. Anything off-spec → deviation log with a question.
