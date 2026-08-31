# Prompt 06 — Auth middleware + key-material module

You are an implementation session for r301.dev. Follow the CLAUDE.md **implementation-session protocol** (read it now). This file is your entire scope.

## Context

M0 is done (01–05). This prompt opens M1 with API-key auth: a shared key-material module (generation/format/hash — reused by prompt 07's scripts), the D1 lookup path, and the middleware guarding `/v1/*`. There is deliberately no key cache and no admin surface (D10/D14).

**Read first:** `CLAUDE.md` · `PROGRESS.md` · PRD §7.6 (whole section, amended), D4, D10–D12 · `docs/design.md` §4 · `docs/testing.md` §3 Middleware.

**Verify first:** prompt 05's acceptance commands.

## Objective

`src/services/keys.ts` (pure: `generateKey(env)` → `{key, prefix, hash}`; `hashKey`; format/regex constants — prefix = **first 20 chars**, D11), `src/db` api_keys query, `src/middleware/auth.ts` enforcing PRD §7.6 on every `/v1/*` route **except** `/v1/health` and `/v1/openapi.json`, attaching `{keyId, environment}` context and echoing `key_prefix` into the log line.

## Out of scope

- Mint/revoke scripts (07). Any link endpoint. Test keys (P1, D13). Rate limiting (P1, D6/D24).
- Any KV involvement in auth — D10 forbids a key cache.

## Spec references

- PRD §7.6: format `r301_live_` + 32 base62 (~190 bits); SHA-256 unsalted; constant-time compare; prefix-20 UNIQUE lookup; `last_used_at` lazy (>1 h stale → `waitUntil` UPDATE, zero extra state).
- `docs/design.md` §4: the exact 6-step flow, including revoked → 401 and the visibility note (v1: any live key sees all live links — enforcement is simply "authenticated"; there is no per-key filtering, D12).
- `docs/api-contract.md`: all failures → 401 `unauthorized` envelope; never 403 in v1.

## TDD mandate

Invoke **superpowers:test-driven-development**. Seed keys in tests by inserting rows built with `keys.ts` itself. Behaviors:

1. `generateKey`: shape `^r301_live_[0-9A-Za-z]{32}$`; prefix = first 20 chars; hash = sha256 hex of the full key; two calls never collide.
2. Missing header / non-Bearer / malformed key shape → 401 envelope (no D1 query for malformed shapes).
3. Unknown prefix → 401. Right prefix + wrong secret → 401 (compare via `crypto.subtle.timingSafeEqual` on equal-length buffers — assert the code path by contract/spy, not timing).
4. Revoked key (`revoked_at` set) → 401 — immediately, no cache (D10).
5. Valid key → request proceeds; context carries `{keyId, environment}`; log line includes `key_prefix`.
6. `last_used_at`: NULL or >1 h stale → exactly one `waitUntil` UPDATE (fake clock; use `waitOnExecutionContext` from `cloudflare:test`); fresh (<1 h) → no write.
7. `/v1/health` still serves with no header (exemption holds).

## Acceptance criteria

```bash
pnpm test && pnpm typecheck    # all green
# integration proof inside tests: seeded key passes auth on a stub protected route; tampered key 401s
```

## Done ritual

1. From repo root: `pnpm test` and `pnpm typecheck` — both green.
2. Update `PROGRESS.md`: row 06 → done (date, notes); next pointer → prompt 07.
3. Commit: `feat(api): api-key auth middleware + key material [prompt 06]`.
4. Stop. Do not start prompt 07. Anything off-spec → deviation log with a question.
