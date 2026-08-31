# Prompt 13 — Click counting + UA denylist

You are an implementation session for r301.dev. Follow the CLAUDE.md **implementation-session protocol** (read it now). This file is your entire scope.

## Context

Redirects serve (12) but count nothing. This prompt adds the async counter and the bot filter that keeps the pilot's delivery-to-click metric honest (D21 — pilot channels are SMS + WhatsApp + email, all of which prefetch links).

**Read first:** `CLAUDE.md` · `PROGRESS.md` · PRD §7.4 (amended — drift definition, bot filtering), D21 · `docs/design.md` §7 (filter chain + starter denylist — copy it, including the UptimeRobot exclusion comment) · `docs/testing.md` §3 Services-counting.

**Verify first:** prompt 12's acceptance commands.

## Objective

`src/bot-denylist.ts` (versioned lowercase-substring list per design §7, with the explicit comment that the uptime probe UA is deliberately absent — it's the drift ruler) and `src/services/counting.ts` (`shouldCount(method, ua)` + `recordClick` doing the single-statement increment) wired into the redirect route via `ctx.waitUntil`, try/caught into Sentry. Redirect-path log lines now include the `ua` field (pilot tuning, D21/D23-compatible).

## Out of scope

- Stats endpoints (18). Any dedupe/IP logic (explicitly rejected for v1 — PRD §21 backlog). Queues (P2, §16).

## Spec references

- PRD §7.4: only successful 30x **GET**s count; HEAD never; 404/410 never; increment = `UPDATE links SET click_count = click_count + 1, last_clicked_at = ? WHERE slug = ? AND deleted_at IS NULL`; response never waits.
- design §7: denylist matching = lowercase substring; failure of the counter is captured to Sentry, never thrown into the response.
- D23: the UA may appear in redirect-path logs — it is on the allowlist; destinations still never are.

## TDD mandate

Invoke **superpowers:test-driven-development**. Behaviors:

1. `shouldCount`: GET + normal browser UA → true; HEAD + anything → false; GET + each denylist family (`WhatsApp/2.x`, `facebookexternalhit/1.1`, `Mozilla/5.0 (compatible; Googlebot/2.1)`, `curl/8`, SafeLinks-style) → false; case-insensitive; missing UA header → **true** (count it — absence isn't bot proof; note this in the docs comment).
2. Integration: successful 302 GET with plain UA → after `waitOnExecutionContext`, `click_count` incremented and `last_clicked_at` set.
3. Denylisted UA → 302 still served, count unchanged. HEAD → served, unchanged. 404/410 paths → unchanged.
4. Two sequential clicks → count 2 (single-statement increment, no lost update).
5. Counter failure (stub DB update to throw) → redirect still 302, Sentry captured (spy), nothing propagates.
6. Redirect log line includes `ua`; API-surface log lines do not.

## Acceptance criteria

```bash
pnpm test && pnpm typecheck
# dev-server check: curl a created slug twice (default curl UA is denylisted!) with
#   curl -A "Mozilla/5.0" -s -o /dev/null http://127.0.0.1:8787/<slug>
# then query: pnpm --filter @r301/api exec wrangler d1 execute DB --local --command \
#   "SELECT click_count FROM links" → 2
```

## Done ritual

1. From repo root: `pnpm test` and `pnpm typecheck` — both green.
2. Update `PROGRESS.md`: row 13 → done (date, notes); next pointer → prompt 14.
3. Commit: `feat(api): click counting + UA denylist [prompt 13]`.
4. Stop. Do not start prompt 14. Anything off-spec → deviation log with a question.
