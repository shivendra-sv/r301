# Prompt 14 — GET /v1/links/{slug} + GET /v1/links (filters, cursor pagination)

You are an implementation session for r301.dev. Follow the CLAUDE.md **implementation-session protocol** (read it now). This file is your entire scope.

## Context

Create/redirect/count exist (10–13). This prompt adds the read side: fetch-one and the filterable, cursor-paginated list — the endpoints Curastax uses to reconcile links.

**Read first:** `CLAUDE.md` · `PROGRESS.md` · PRD §7.1 Read (amended), §8 Pagination, D12, D19 · `docs/api-contract.md` §GET one + §GET list · `docs/testing.md` §3 Routes-list.

**Verify first:** prompt 13's acceptance commands.

## Objective

`GET /v1/links/{slug}` → 200 Link | 404 (unknown AND tombstoned identical). `GET /v1/links` → `{links, next_cursor}`: filters `tag`, `active`, `created_after`, `external_id` (AND-combined), ordered `created_at DESC`, keyset cursor `(created_at, id)` encoded opaque base64url, `limit` 1–100 default 25.

## Out of scope

- Update/delete (15–16). Stats/tags endpoints (18). Any per-key filtering — D12: every live key sees all links (v1 single owner).

## Spec references

- `docs/api-contract.md` §GET list — normative for filters/order/cursor semantics ("opaque, valid indefinitely", `next_cursor: null` at end).
- D19: `external_id` exact-match filter (index exists). §7.3: `tag` exact match via join.
- D15: tombstoned links never appear in reads or lists.

## TDD mandate

Invoke **superpowers:test-driven-development**. Seed a spread of links with controlled `created_at` (injected clock), including ties. Behaviors:

1. Fetch-one: existing → 200 Link (same serializer as create — no counts); unknown → 404; tombstoned → 404 indistinguishable (same envelope).
2. Default list: 25 max, `created_at DESC`; `limit=2` → 2 + non-null cursor; walking cursors to exhaustion visits **every** link exactly once, no dupes/gaps — including with identical `created_at` values (tie-break by `id`).
3. Cursor round-trip: `next_cursor` is opaque (base64url), survives URL encoding; garbage cursor → 400 `invalid_request`.
4. Filters, each alone: `tag=x` (only tagged), `active=false` (only deactivated), `created_after` (strictly newer), `external_id` (exact). Then combined: `tag` + `active` AND-combine.
5. Tombstoned links absent from every list/filter result.
6. `limit=0`, `limit=101`, `active=maybe` → 400 (schema from 08).
7. Pagination stability under interleaving: create new links between page fetches → earlier cursor still yields the original older pages (keyset property — no offset drift).

## Acceptance criteria

```bash
pnpm test && pnpm typecheck
# dev server: create 3 links, then
curl -s -H "Authorization: Bearer <key>" "http://127.0.0.1:8787/v1/links?limit=2" | jq '.links|length, .next_cursor'  # 2, non-null
```

## Done ritual

1. From repo root: `pnpm test` and `pnpm typecheck` — both green.
2. Update `PROGRESS.md`: row 14 → done (date, notes); next pointer → prompt 15.
3. Commit: `feat(api): read + list with cursor pagination [prompt 14]`.
4. Stop. Do not start prompt 15. Anything off-spec → deviation log with a question.
