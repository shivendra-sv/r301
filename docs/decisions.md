# r301.dev — Decision Log (ADRs)

Canonical text for D1–D25 lives in the PRD §5 (v1.0, signed off 31 Aug 2026) — this file indexes them and carries **all decisions made after sign-off** (D26+).

**Process:** any new dependency, any deviation from PRD/docs, and any contract change gets a D-row here, `status: proposed`, plus a question in the PROGRESS.md deviation log. Only Shivendra flips a row to `approved`. Implementation sessions never act on a `proposed` row.

## Index of signed-off decisions (PRD §5)

| # | Decision | Choice (abbreviated — PRD §5 is canonical) |
|---|---|---|
| D1 | v1 feature set | Custom slugs + expiry + counts + bulk + tags; no custom domains |
| D2 | Analytics depth | Click counts only |
| D3 | Tenancy | Single owner, many API keys |
| D4 | Auth | Static keys, SHA-256 hashed, prefixed |
| D5 | Redirect semantics | Per-link type, default 302 |
| D6 | Rate limiting | None per-key during pilot; mandatory pre-launch (see D24) |
| D7 | Runtime | TypeScript + Hono on Cloudflare Workers |
| D8 | Hosting | Workers + KV + D1 |
| D9 | Budget | ≤ $10/mo pre-launch |
| D10 | Key lookup | D1 SELECT per request; no key cache; immediate revocation |
| D11 | Key prefix | First 20 chars stored, UNIQUE |
| D12 | Visibility | Owner + environment scoped; attribution-only `created_by_key_id` |
| D13 | Test keys | Deferred to P1; staging is the pilot test bed |
| D14 | Key management | Local mint/revoke scripts; no `/v1/keys`, no `ADMIN_TOKEN` in v1 |
| D15 | Deletes | Tombstoned from day one; P1 purge cron (30 d) |
| D16 | Slug rules | Case-sensitive match; case-insensitive reserved check; full base62 |
| D17 | Redirect edge | 410 expired / 404 otherwise; query strings dropped; exact match |
| D18 | Idempotency | P0, stored in D1; 409 on conflict/in-flight |
| D19 | `external_id` | Nullable, ≤128, non-unique, indexed, filterable |
| D20 | KV contract | D1-first + awaited put; no negative caching; ≤60 s staleness accepted |
| D21 | Count integrity | GET-only + versioned UA denylist; canary = drift instrument |
| D22 | Contract completions | Strict validation; batch 200 + per-item; expanded codes; `request_id` |
| D23 | Telemetry | Allowlist-only, P0, test-enforced |
| D24 | Flood posture | Free tier + zone per-IP rule + upgrade playbook |
| D25 | Ops | Health endpoint + probe; local-first dev; N−1 gate; verify Time Travel |

---

## D26 — Phase 2 contract elaborations · approved 31 Aug 2026

**Context:** writing `docs/api-contract.md` required a handful of calls the PRD doesn't literally spell out. None contradict it; all are recorded here for review.

**Decisions:**
1. The Link resource **excludes** `click_count`/`last_clicked_at` — stats endpoints own counts (§7.4's separation, one source of truth).
2. Link responses include a convenience `short_url` field.
3. `expires_at` must be strictly in the future at write time (creating pre-expired links is a footgun; `is_active=false` is the kill switch).
4. Error code→status mapping fixed as tabled in api-contract.md (409 for `slug_taken`/`idempotency_conflict`; 422 for `slug_reserved`/`destination_*`).
5. `PATCH` with `tags` replaces the whole tag set; `null` clears nullable fields; empty PATCH body → 400.
6. `GET /v1/tags` is unpaginated in v1 (tiny pilot cardinality); revisit past ~1,000 tags.
7. Success statuses: create 201, delete 204, everything else 200.
8. Idempotency payload identity = hash of raw body bytes (retries must be byte-identical); abandoned in-flight reservations (> 60 s, no response) are taken over by the retry.

**Consequences:** implementation sessions treat these as spec. Changing any of them later is a contract change → new ADR.

## D27 — Initial dependency set · approved 31 Aug 2026

**Context:** CLAUDE.md forbids new dependencies without an ADR; the starting set needs one. The PRD §13 stack table is the authority.

**Decision:** the approved initial set, installed by the first implementation prompt at current stable versions (exact resolved versions recorded in PROGRESS.md notes and pinned by `pnpm-lock.yaml`):
- Runtime deps: `hono`, `zod`, `@hono/zod-openapi`, `@sentry/cloudflare`
- Dev deps: `typescript`, `wrangler`, `@cloudflare/workers-types`, `vitest`, `@cloudflare/vitest-pool-workers`, `tsx` (runs `scripts/*.ts` — mint-key, smoke — outside the Worker)

**Consequences:** anything beyond this list — however small — is a new ADR row (`proposed`) + a PROGRESS.md question first. Version *upgrades* within this set are routine maintenance, not ADRs.

---

## Template for new rows

```
## D<n> — <title> · proposed <date> · asked in PROGRESS.md deviation log #<k>
**Context:** <what forced a decision>
**Decision:** <what is proposed/decided>
**Consequences:** <what it changes; PRD/docs sections affected>
```
