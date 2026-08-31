# Prompt 08 — Validation: Zod schemas, destination validator, reserved slugs

You are an implementation session for r301.dev. Follow the CLAUDE.md **implementation-session protocol** (read it now). This file is your entire scope.

## Context

Auth exists (06–07); link endpoints come next. Before any endpoint, this prompt builds the pure validation layer — the create/patch/list schemas, the destination-safety battery, and the reserved-slug list. It is the highest-test-count prompt; everything here is endpoint-independent and fast to test.

**Read first:** `CLAUDE.md` · `PROGRESS.md` · PRD §7.1 (amended validation rules), D16, D22 · `docs/api-contract.md` §Field constraints + §Global (strictness) · `docs/testing.md` §3 Validation.

**Verify first:** prompt 07's acceptance commands.

## Objective

`src/schemas/` (create-link, patch-link, list-query — built with `@hono/zod-openapi`'s `z` so OpenAPI accrues for free, D22/prompt 19), `src/services/destination.ts` (the full §7.1 battery), `src/reserved-slugs.ts` (versioned list + case-insensitive checker). All schemas `.strict()`.

## Out of scope

- Endpoints, slug *generation* (09), D1/KV. Batch wrapper schema (17).

## Spec references

- `docs/api-contract.md` §Field constraints — normative for every rule below.
- PRD §7.1: destination rules incl. credentials-in-URL, self-domain (`r301.dev` + subdomains), IDN punycode-normalize-then-check, private/loopback/link-local IP ranges (v4 + v6), `localhost`/`*.localhost`, ≤2048, WHATWG-parseable, http/https only.
- D16: reserved list case-insensitive; seed it with the PRD §7.1 examples + `~200` system/brand words (curate a sensible list: api, v1, v2, docs, admin, status, www, abuse, login, signup, dashboard, static, assets, health, robots, favicon, well-known, r301, curastax, common brands…). D26: `expires_at` strictly future.

## TDD mandate

Invoke **superpowers:test-driven-development**. Table-driven tests are ideal here. Behaviors:

1. **Destination accepts:** normal https/http URLs; IDN host (normalized to punycode internally); 2048-char boundary.
2. **Destination rejects** (each its own case): `javascript:`/`data:`/`file:`/`ftp:` schemes; unparseable; >2048; `user:pass@`; `r301.dev` and `staging.r301.dev`; `localhost`, `foo.localhost`; `127.0.0.1`, `10.x`, `172.16–31.x`, `192.168.x`, `169.254.x`, `0.0.0.0`; `[::1]`, `[fc00::…]`, `[fe80::…]`; decimal/hex IPv4 forms (`http://2130706433/` — the WHATWG parser normalizes these; assert the check runs on the *parsed* host).
3. **Slug schema:** regex bounds (2/3/64/65 chars, illegal chars); reserved hits case-insensitively (`API`, `Admin`); non-reserved passes.
4. **Create schema:** required destination; defaults (`redirect_type` 302); `expires_at` must parse ISO 8601 and be future (past/now → fail); tags ≤10, each trimmed non-empty ≤64; `external_id` ≤128; **unknown field → error naming the field** (D22).
5. **Patch schema:** all-optional subset; empty object → invalid; `slug` present → unknown-field error; `null` legal for `expires_at`/`external_id`.
6. **List-query schema:** `limit` clamps/rejects out of 1–100; `active` parses `"true"/"false"` only; `created_after` ISO 8601.

## Acceptance criteria

```bash
pnpm test && pnpm typecheck     # green; this prompt should add a large, fast, pure test suite
```

## Done ritual

1. From repo root: `pnpm test` and `pnpm typecheck` — both green.
2. Update `PROGRESS.md`: row 08 → done (date, notes incl. reserved-list size); next pointer → prompt 09.
3. Commit: `feat(api): validation schemas + destination battery + reserved slugs [prompt 08]`.
4. Stop. Do not start prompt 09. Anything off-spec → deviation log with a question.
