# r301.dev — Testing

The TDD protocol every implementation session follows, the tooling patterns, and what each layer must prove. Derives from PRD §14 (pipeline), D21/D23 (pinned behaviors), and the CLAUDE.md protocol.

## 1. TDD protocol (mandatory, every session)

Invoke the superpowers **test-driven-development** skill at session start and follow it strictly:

1. **Red** — write one failing test for the next behavior in the prompt's list. Run it; watch it fail for the *right reason*.
2. **Green** — write the minimum implementation to pass. Run the test.
3. **Refactor** — clean up with tests green. Then commit (small, green, prompt-tagged).
4. Repeat until the prompt's acceptance criteria all pass.

No implementation code before its failing test. If you find yourself writing code "to see how it should work", stop — that exploration belongs in a test. Tests are named for behavior (`"expired link returns 410 with no-store"`), not for methods.

## 2. Tooling

- **Vitest + `@cloudflare/vitest-pool-workers`**: tests execute *inside* workerd with real (local, Miniflare-backed) `DB` (D1) and `REDIRECTS` (KV) bindings read from `apps/api/wrangler.toml` — zero platform usage (D25: local-first).
- `vitest.config.ts` (created by prompt 01): the Vitest 4 `cloudflareTest` plugin pointed at `wrangler.toml`. It also reads every file in `migrations/` in order via `readD1Migrations` and hands them to the Worker as a `TEST_MIGRATIONS` binding.
- `test/setup.ts` (registered as `setupFiles`) gives every test a clean slate: `beforeEach` applies the migration chain from zero to the test D1 — so the chain is proven on every run (PRD §14: "N−1 code on N schema" starts with "migrations apply from zero") — and `afterEach` calls `reset()` from `cloudflare:test`, which clears every attached binding (D1 + KV). **Isolated storage per test** is what this pair buys. The pool's declarative `isolatedStorage` option was removed in `@cloudflare/vitest-pool-workers` 0.22, so isolation is *asserted by a harness test* rather than assumed from config — never delete that test. Migrations are applied per-test rather than per-file because `reset()` also drops the `d1_migrations` bookkeeping table.
- Integration style: build the Hono app and call `app.request(...)`, or drive the Worker entry with `exports.default.fetch(...)` imported from `cloudflare:workers` — full middleware chain, no HTTP server needed. (`SELF` and `env` from `cloudflare:test` are deprecated as of pool 0.22; prefer the `cloudflare:workers` module. `cloudflare:test` is still the home of `reset()` and `applyD1Migrations()`.)
- **Determinism:** no wall-clock, no raw randomness in logic under test. Time is injected (a `now()` dependency or fake timers) for expiry/TTL/last_used_at; the slug generator takes an injectable RNG so collision/retry paths are testable.
- **No network** in unit/integration tests. Nothing may call staging from a test (D25).

## 3. What each layer must prove

**Validation (Zod schemas)** — every constraint in `docs/api-contract.md` §Field constraints:
slug regex bounds (2/3/64/65 chars, bad chars); every destination rejection class (scheme, `javascript:`/`data:`/`file:`, private/loopback/link-local IPs, `localhost`, IDN-punycode evasion attempt, credentials-in-URL, self-domain, > 2048, unparseable); `expires_at` in past; tags count/length; `external_id` length; unknown-field strictness (D22); missing `Content-Type` → 415.

**Services**:
- Slug: auto-slug shape (7 chars, alphabet), rejection-sampling uniformity is *not* statistically tested — instead test the sampler contract (rejects out-of-range bytes); collision retry ≤3 then error; reserved check case-insensitive on custom AND auto paths (D16); tombstoned slug → `slug_taken` (D15).
- Idempotency (D18/D26): fresh key executes; byte-identical replay returns stored status+body+header; different payload → 409; in-flight < 60 s → 409; abandoned ≥ 60 s → taken over; > 24 h → expired, re-executes; failed operation deletes the reservation; opportunistic purge deletes old rows.
- Counting (D21): HEAD not counted; 404/410 not counted; denylisted UA not counted; plain GET counted; counter failure is caught and reported, never thrown into the response path.

**Middleware**:
- Auth (D10–D12): missing/malformed header, unknown prefix, wrong secret (right prefix), revoked key → all 401 with envelope; valid key attaches context; `last_used_at` updated only when > 1 h stale (fake clock); hash compare uses the constant-time API (assert by contract/spy, not by timing).
- Request-id: header present on every response incl. redirects and errors; echoed in envelope.
- Errors: every thrown/returned error renders the envelope with correct code→status per api-contract.

**Routes (integration, real local D1+KV)**:
- Full CRUD lifecycle round-trip incl. KV write-through effects (create → KV entry exists; PATCH → KV updated; deactivate → KV `a:0`; delete → KV gone, D1 row tombstoned).
- Redirect matrix **table-driven** from api-contract's table: every row × status/`Location`/`Cache-Control`/body, evaluation order (inactive+expired → 404), query-string dropping, exact-match (trailing slash, multi-segment), housekeeping routes (`/`, `robots.txt`, `favicon.ico`), KV-miss fallthrough + backfill, no-negative-caching (miss leaves no KV entry), 405 on POST to slug.
- Batch: order preserved, partial success, >100 rejected, ≤2 s is *not* asserted in tests (perf budgets aren't unit-testable) — sequential execution is.
- List: pagination walks to exhaustion without dupes/gaps under interleaved creates; every filter; filters AND-combine; tombstones invisible.
- Stats/tags: aggregates exclude tombstoned links; unknown slug 404.

**Telemetry (D23 — the pinned tests; never weaken or delete)**:
- Sentry `beforeSend` scrubber: feed an event containing request body, query string, `Authorization` header, and a destination URL → assert none survive.
- Logger: emits allowlist fields only; a log call handed a destination/body/header field drops it.

**Scripts**: `mint-key` output shape (prefix length 20, key shown once, hash stored — tested against local D1); `revoke-key` sets `revoked_at`.

## 4. Coverage stance

No numeric coverage gate. The gate is: **every behavior named in the current prompt's acceptance criteria has at least one test that fails without the implementation.** Reviewers (and the next session's verification step) check that mapping, not a percentage.

## 5. Smoke test (PRD §14 — runs in CI against real envs, never in unit runs)

`apps/api/scripts/smoke.ts`, driven by env vars `SMOKE_API_BASE`, `SMOKE_REDIRECT_BASE`, `SMOKE_API_KEY`:

1. `GET /v1/health` → 200, `status: "ok"`.
2. Create link (auto-slug, tag `smoke`, destination `https://example.com`) → 201.
3. `GET /v1/links/{slug}` → 200.
4. `GET {redirect}/{slug}` with `redirect: "manual"` → 302 + correct `Location`.
5. `GET /v1/links/{slug}/stats` → 200 (no count assertion — counting is async).
6. `DELETE` → 204; redirect now 404.

~8 requests total (quota discipline, D25). Exits non-zero on any mismatch; CI fails the deploy.
