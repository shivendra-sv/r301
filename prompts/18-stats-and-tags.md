# Prompt 18 — Stats + tags endpoints

You are an implementation session for r301.dev. Follow the CLAUDE.md **implementation-session protocol** (read it now). This file is your entire scope.

## Context

Counting works (13); the full link lifecycle works (10–17). This prompt exposes the numbers: per-link stats, per-tag aggregates (Curastax's per-clinic reporting), and the tag list.

**Read first:** `CLAUDE.md` · `PROGRESS.md` · PRD §7.3, §7.4 · `docs/api-contract.md` §stats + §tags (incl. D26.6: `/v1/tags` unpaginated in v1) · `docs/testing.md` §3 Routes-stats.

**Verify first:** prompt 17's acceptance commands.

## Objective

Three authenticated endpoints: `GET /v1/links/{slug}/stats` → `{slug, click_count, last_clicked_at, created_at}`; `GET /v1/stats?tag=x` → `{tag, link_count, click_count}`; `GET /v1/tags` → `{tags:[{name, link_count}]}` sorted by name.

## Out of scope

- Rollups/time-series (P2). Pagination on `/v1/tags` (D26.6). Any counting logic changes.

## Spec references

- PRD §7.4: stats shapes; counts documented at-least-approximate.
- `docs/api-contract.md`: `/v1/stats` without `tag` → 400 `invalid_request`; unknown slug → 404; unknown tag → 200 with zeros (a tag that never existed aggregates nothing — `{tag, link_count:0, click_count:0}`).
- D15: every aggregate excludes tombstoned links (live rows only).

## TDD mandate

Invoke **superpowers:test-driven-development**. Seed links with tags and drive real clicks through the redirect route (13) for at least one case. Behaviors:

1. Link stats: fresh link → `click_count: 0`, `last_clicked_at: null`; after 2 counted clicks → 2 + ISO timestamp. Unknown/tombstoned slug → 404.
2. Tag aggregate: 3 links tagged `tenant:42` with counts 2/1/0 → `{link_count: 3, click_count: 3}`; other tags unaffected.
3. Tombstone exclusion: delete one tagged link → its clicks and its membership vanish from the tag aggregate and from `/v1/tags` link_count.
4. Deactivated links still aggregate (they exist — only tombstones vanish).
5. `/v1/stats` with no `tag` → 400. Unknown tag → zeros, 200.
6. `/v1/tags`: sorted by name; counts = live links only; tag whose only link was tombstoned still lists with `link_count: 0` (row exists — consistent with D15's no-pruning; assert and document).
7. All three require auth (401 without).

## Acceptance criteria

```bash
pnpm test && pnpm typecheck
# dev server: click a tagged link twice (browser UA), then
curl -s -H "Authorization: Bearer <key>" "http://127.0.0.1:8787/v1/stats?tag=tenant:42" | jq .   # counts present
```

## Done ritual

1. From repo root: `pnpm test` and `pnpm typecheck` — both green.
2. Update `PROGRESS.md`: row 18 → done (date, notes); next pointer → prompt 19.
3. Commit: `feat(api): stats + tags endpoints [prompt 18]`.
4. Stop. Do not start prompt 19. Anything off-spec → deviation log with a question.
