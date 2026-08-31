# Prompt 12 — The redirect path (hot path, no counting yet)

You are an implementation session for r301.dev. Follow the CLAUDE.md **implementation-session protocol** (read it now). This file is your entire scope.

## Context

Links can be created (10–11). This prompt ships the product's reason to exist: `GET r301.dev/{slug}` — KV-first lookup, D1 fallthrough with backfill, the full status matrix, and the housekeeping routes. Counting is deliberately the *next* prompt so this one stays focused on correctness of the serving matrix.

**Read first:** `CLAUDE.md` · `PROGRESS.md` · PRD §7.5 (amended: matrix + evaluation order + notes), §10, D17, D20 · `docs/design.md` §2–3 · `docs/api-contract.md` §Redirect host · `docs/testing.md` §3 Routes-redirect.

**Verify first:** prompt 11's acceptance commands.

## Objective

The redirect surface, complete: housekeeping (`/` landing text, `/robots.txt` → `Disallow: /`, `/favicon.ico` → 204), slug parsing (exact, single-segment), KV-hit evaluation, KV-miss → D1 → conditional backfill, and every row of the response matrix with correct status/`Location`/`Cache-Control`/body.

## Out of scope

- Click counting + UA denylist (13). Any `/v1` route. CDN/cache API usage (design §2 forbids it).

## Spec references

- `docs/api-contract.md` §Redirect host — the matrix is the test plan.
- `docs/design.md` §2: evaluation order (unknown/tombstoned → 404, inactive → 404, expired → 410 — deactivation outranks expiry); query strings dropped; HEAD = GET uncounted; other methods → 405 plain text; `no-store` on all 4xx; 301/308 `public, max-age=3600`, 302/307 `no-store`.
- D20 / design §3: miss → D1; **no row or tombstoned → 404 with NO KV write** (no negative caching — assert absence); live row (any active/expiry state) → backfill `{d,t,x,a}` via `waitUntil`.

## TDD mandate

Invoke **superpowers:test-driven-development**. Table-driven: encode the api-contract matrix as data, one assertion block runs all rows. Seed via the create service or direct D1+KV writes. Behaviors:

1. Active 302 (default) → 302, `Location` = stored destination **verbatim**, `Cache-Control: no-store`; 307 same; 301/308 → `public, max-age=3600`.
2. Query string on the short URL (`/abc?utm=x`) → dropped: `Location` has no `utm` (D17).
3. Expired → 410, body contains "expired", `no-store`. Inactive → 404. Inactive AND expired → **404** (order). Tombstoned → 404. Unknown → 404.
4. KV-hit path serves without touching D1 (stub/spy DB to prove no query on hit).
5. KV-miss + live row → serves correctly AND backfills KV (`waitOnExecutionContext`, then KV has `{d,t,x,a}`).
6. KV-miss + unknown slug → 404 and KV **remains empty** for that key. Same for tombstoned.
7. Housekeeping: `/` → 200 text; `/robots.txt` → `Disallow: /`; `/favicon.ico` → 204 empty.
8. `/abc/` and `/a/b` → 404; slug regex bounds respected; `HEAD /{slug}` → same status/headers, empty body; `POST /{slug}` → 405 plain text.
9. Every redirect-surface response carries `X-Request-Id`.

## Acceptance criteria

```bash
pnpm test && pnpm typecheck
pnpm --filter @r301/api dev &   # create a link via curl (prompt 10 flow), then:
curl -si http://127.0.0.1:8787/<slug> | head -6     # 302 + Location + no-store  (any Host works locally)
curl -s  http://127.0.0.1:8787/robots.txt            # Disallow: /
```

## Done ritual

1. From repo root: `pnpm test` and `pnpm typecheck` — both green.
2. Update `PROGRESS.md`: row 12 → done (date, notes); next pointer → prompt 13.
3. Commit: `feat(api): redirect path + status matrix [prompt 12]`.
4. Stop. Do not start prompt 13. Anything off-spec → deviation log with a question.
