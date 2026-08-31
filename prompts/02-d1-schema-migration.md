# Prompt 02 — D1 schema: migration 0001

You are an implementation session for r301.dev. Follow the CLAUDE.md **implementation-session protocol** (read it now). This file is your entire scope.

## Context

The workspace and test harness exist (prompt 01) with an empty `migrations/`. This prompt ships the full v1 schema as the first migration and proves the migrations-from-zero loop works — every future test run applies the chain.

**Read first:** `CLAUDE.md` · `PROGRESS.md` · PRD §9 (the amended schema is normative) · PRD §14 Migrations · `docs/testing.md` §2–3.

**Verify first:** prompt 01's acceptance commands (`pnpm test`, `pnpm typecheck`, dev-server 404).

## Objective

`apps/api/migrations/0001_init.sql` creates the complete PRD §9 schema (links, tags, link_tags, api_keys, idempotency_keys + all indexes); the vitest setup applies it so tests see real tables.

## Out of scope

- Any TypeScript beyond the test files and (if needed) the setup wiring from prompt 01.
- Query helpers/db module (prompt 06+), seed data, key minting.
- Any schema addition not in PRD §9 — that would be a deviation.

## Spec references

- PRD §9 — copy the DDL faithfully: CHECKs on `redirect_type`/`is_active`, `deleted_at`, `external_id`, the three links indexes, `prefix TEXT UNIQUE` (20-char comment, D11), composite PK on `idempotency_keys`, `request_hash`/`response_status`/`response_body` columns.
- PRD §14 / CLAUDE.md — numbered, forward-only, additive-first; this is `0001`.
- D15 — `UNIQUE(slug)` spans tombstones (no partial index).

## TDD mandate

Invoke **superpowers:test-driven-development**. Behaviors to test (red first — these fail until the SQL exists):

1. Migration applies from zero: all 5 tables + 4 named indexes exist (`sqlite_master`).
2. `links.slug` UNIQUE: second insert with same slug throws — **including when the first row has `deleted_at` set** (tombstone blocks reuse, D15).
3. CHECK constraints: `redirect_type = 303` insert throws; `is_active = 2` throws.
4. FK enforcement: inserting a link with nonexistent `created_by_key_id` throws; deleting a link row cascades `link_tags` (`ON DELETE CASCADE`).
5. `idempotency_keys` composite PK: same `(key, api_key_id)` twice throws; same `key` with different `api_key_id` is fine.
6. `tags.name` UNIQUE.

## Acceptance criteria

```bash
pnpm test        # all green, including the 6 schema behaviors above
pnpm typecheck   # green
pnpm --filter @r301/api exec wrangler d1 migrations apply DB --local   # applies 0001 cleanly on a fresh local DB
```

## Done ritual

1. From repo root: `pnpm test` and `pnpm typecheck` — both green.
2. Update `PROGRESS.md`: row 02 → done (date, notes); next pointer → prompt 03.
3. Commit: `feat(api): D1 schema migration 0001 [prompt 02]`.
4. Stop. Do not start prompt 03. Anything off-spec → deviation log with a question.
