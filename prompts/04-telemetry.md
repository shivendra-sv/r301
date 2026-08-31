# Prompt 04 — Telemetry: allowlist logger + Sentry with pinned scrubber

You are an implementation session for r301.dev. Follow the CLAUDE.md **implementation-session protocol** (read it now). This file is your entire scope.

## Context

The HTTP foundation exists (03). This prompt adds the two telemetry channels — structured logs and Sentry — under the **no-sensitive-telemetry rule (D23)**: allowlist-only, enforced by pinned tests that future sessions must never weaken. This lands *before* any feature endpoint so no request data can ever leak by default.

**Read first:** `CLAUDE.md` (Telemetry hard rule) · `PROGRESS.md` · PRD §12 D23, §15 · `docs/design.md` §9 · `docs/testing.md` §3 Telemetry.

**Verify first:** prompt 03's acceptance commands.

## Objective

`src/telemetry/logger.ts` (allowlist structured log line per request) and `src/telemetry/sentry.ts` (`@sentry/cloudflare` wiring with a `beforeSend` scrubber), both wired into the app; two **pinned** test files proving the rule.

## Out of scope

- The UA field's redirect-path wiring (arrives with prompt 12/13 — the logger accepts an optional `ua` field now).
- Sentry releases/GIT_SHA (prompt 05 wires the var), tracing (stays `tracesSampleRate: 0` forever in v1), counting failures (13).

## Spec references

- PRD D23 (test-enforced allowlist) + §15 (log line fields: request_id, route template, method, status, latency_ms, key_prefix?, ua?).
- `docs/design.md` §9: DSN optional — absent (local/tests) → Sentry disabled, zero errors; `beforeSend` strips request bodies, query strings, headers, cookies, and any URL down to origin+path-template.
- Wrapper API: verify the current `@sentry/cloudflare` integration pattern (withSentry / compat flags — `nodejs_als` is pre-set in wrangler.toml) against current docs via context7; do not trust memory.

## TDD mandate

Invoke **superpowers:test-driven-development**. Behaviors to test:

1. A handled request emits exactly one log line: JSON with **only** allowlist fields; `route` is the template (`/v1/links/:slug`), never the raw path.
2. Logger drops/refuses forbidden fields: passing `destination`, `body`, `query`, or `authorization` in the fields object → they never appear in output (type-level exclusion + runtime strip).
3. **Pinned (D23) — Sentry scrubber:** an event carrying request body, query string, `Authorization`/`Cookie` headers, and a full URL with query → after `beforeSend`, none survive; `request_id` tag does. Mark both test files with a header comment: `D23 pinned — never weaken or delete (CLAUDE.md hard rule)`.
4. **Pinned (D23) — logger allowlist** (the runtime-strip test from #2 lives in the pinned file too).
5. No DSN configured → app boots and serves; Sentry calls are no-ops (no throw, no fetch).
6. 500-path integration: the prompt-03 thrown-error test now *also* asserts a Sentry capture happened (spy/transport stub) with scrubbed payload.

## Acceptance criteria

```bash
pnpm test        # all green incl. both pinned files
pnpm typecheck   # green
grep -r "D23 pinned" apps/api/src apps/api/test* -l | wc -l   # ≥2 (or equivalent test paths)
```

## Done ritual

1. From repo root: `pnpm test` and `pnpm typecheck` — both green.
2. Update `PROGRESS.md`: row 04 → done (date, notes); next pointer → prompt 05.
3. Commit: `feat(api): allowlist logger + sentry scrubber (D23) [prompt 04]`.
4. Stop. Do not start prompt 05. Anything off-spec → deviation log with a question.
