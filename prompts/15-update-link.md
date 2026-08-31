# Prompt 15 — PATCH /v1/links/{slug}: update + KV convergence

You are an implementation session for r301.dev. Follow the CLAUDE.md **implementation-session protocol** (read it now). This file is your entire scope.

## Context

Reads exist (14). This prompt adds mutation: PATCH with the amended mutable-field set — including deactivation (the takedown tool) and the KV write-through that makes edits converge at the edge. "Mutable destinations are a feature" (PRD §7.1) — this is that feature.

**Read first:** `CLAUDE.md` · `PROGRESS.md` · PRD §7.1 Update (amended), D17, D20 · `docs/api-contract.md` §PATCH + D26 items 3/5 · `docs/design.md` §3.

**Verify first:** prompt 14's acceptance commands.

## Objective

`PATCH /v1/links/{slug}` (authenticated): strict subset schema (08), full revalidation of changed fields, D1 update + `updated_at` bump, tags wholesale replace, **awaited** KV put reflecting the new state (deactivate → `a:0`), → 200 updated Link.

## Out of scope

- Delete (16). Slug changes — `slug` in the body is an unknown field → 400 (immutable, §7.1).

## Spec references

- `docs/api-contract.md` §PATCH: mutable = `destination, redirect_type, expires_at, is_active, tags, external_id`; empty body → 400; `null` clears `expires_at`/`external_id`; tags **replace** the set (D26.5).
- D20: same ordering invariant as create — D1 first, KV put awaited, failure → 500 (client retries PATCH; it's naturally idempotent for the same payload).
- D26.3: a *new* `expires_at` must be strictly future; `is_active:false` is the kill switch.

## TDD mandate

Invoke **superpowers:test-driven-development**. Behaviors:

1. Change destination → 200; D1 row updated; `updated_at` > `created_at` (fake clock); KV `d` updated (awaited — assert immediately after response).
2. `is_active:false` → KV holds `a:0`; redirect route (12) now 404s the slug. Reactivate → redirect serves again (round-trip through the real routes).
3. `expires_at` set → KV `x` updated; past date → 400; `null` → cleared in D1 and KV.
4. `redirect_type` 302→301 → KV `t` updated; redirect now emits 301 + `public, max-age=3600`.
5. Tags replace wholesale: link with `[a,b]` PATCHed to `[b,c]` → exactly `[b,c]`; `[]` clears all; orphaned tag rows may remain in `tags` (documented — no pruning in v1).
6. `external_id` set/cleared; list filter (14) reflects it.
7. Strictness: `slug` in body → 400 naming the field; empty body `{}` → 400; unknown/tombstoned slug → 404; invalid new destination → 422 (full battery applies).
8. KV-put failure stub → 500, D1 already updated (documented convergence-by-retry).

## Acceptance criteria

```bash
pnpm test && pnpm typecheck
# dev server: PATCH a link {"is_active":false} → 200, then curl its short URL → 404; PATCH true → 302 again
```

## Done ritual

1. From repo root: `pnpm test` and `pnpm typecheck` — both green.
2. Update `PROGRESS.md`: row 15 → done (date, notes); next pointer → prompt 16.
3. Commit: `feat(api): update link + KV convergence [prompt 15]`.
4. Stop. Do not start prompt 16. Anything off-spec → deviation log with a question.
