# Prompt 16 — DELETE /v1/links/{slug}: tombstone + KV removal

You are an implementation session for r301.dev. Follow the CLAUDE.md **implementation-session protocol** (read it now). This file is your entire scope.

## Context

Create/read/update exist. This prompt completes single-link lifecycle with tombstoned delete (D15) — the design that makes slug takeover impossible and keeps the DELETE contract stable through public launch.

**Read first:** `CLAUDE.md` · `PROGRESS.md` · PRD §7.1 Delete (amended), D15, D17, D20 · `docs/api-contract.md` §DELETE · `docs/design.md` §6.

**Verify first:** prompt 15's acceptance commands.

## Objective

`DELETE /v1/links/{slug}` (authenticated): `UPDATE links SET deleted_at = now` + **awaited** KV delete → **204** empty. Tombstones are invisible everywhere except the slug-uniqueness rule.

## Out of scope

- The 30-day purge cron — P1 (stub prompt 28). Hard deletes — never in v1.

## Spec references

- D15/`docs/api-contract.md`: 204; unknown OR already-tombstoned → 404; recreate of the slug → 409 `slug_taken` (already enforced by 09 — re-assert end-to-end here).
- D17/design §2: tombstoned redirect → 404, indistinguishable from unknown.
- D20: KV delete awaited, same failure semantics (500 → retry converges; DELETE is idempotent-shaped, but a completed tombstone then 404s — acceptable and documented in api-contract).

## TDD mandate

Invoke **superpowers:test-driven-development**. Behaviors:

1. Delete existing → 204 empty body; D1 row has `deleted_at` set (row NOT removed); KV entry gone (awaited — assert immediately).
2. Redirect for that slug → 404 (KV-miss path must not backfill it — ties to 12's no-negative-cache).
3. `GET /v1/links/{slug}` → 404; list (14) excludes it; its tags disappear from link counts (verified fully in 18).
4. Second DELETE of the same slug → 404. Unknown slug → 404.
5. Recreate same slug via POST → 409 `slug_taken` (end-to-end through the route).
6. `link_tags` rows: **kept** (the row survives; cascade only fires on real row deletion at P1 purge) — assert they still exist, and that nothing user-visible shows them.
7. KV-delete failure stub → 500, D1 tombstone already set (retry converges).

## Acceptance criteria

```bash
pnpm test && pnpm typecheck
# dev server: create → DELETE → curl short URL → 404 → POST same slug → 409 slug_taken
```

## Done ritual

1. From repo root: `pnpm test` and `pnpm typecheck` — both green.
2. Update `PROGRESS.md`: row 16 → done (date, notes); next pointer → prompt 17.
3. Commit: `feat(api): tombstoned delete [prompt 16]`.
4. Stop. Do not start prompt 17. Anything off-spec → deviation log with a question.
