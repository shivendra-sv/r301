# r301.dev — Product Requirements Document

| | |
|---|---|
| **Product** | r301.dev — developer-focused URL shortener, API-first |
| **Version** | v1.0 |
| **Date** | 31 Aug 2026 |
| **Owner** | Shivendra |
| **Status** | **Signed off 31 Aug 2026** — Phase 1 red-team review complete; decisions D10–D25 recorded |

---

## 1. Summary

r301.dev is an API-first URL shortening service built for developers. v1 ships **no UI** — the product is a clean, fast, well-documented REST API plus a globally distributed redirect edge. It will be validated in production as the link infrastructure for Curastax (ClinicOS) before opening to public developer signups.

The name is the pitch: HTTP 301, permanent redirect. The product promise is the same — links that are fast everywhere and never break.

## 2. Problem & Opportunity

Existing shorteners fall into two camps: consumer tools with APIs bolted on as an afterthought (Bitly — expensive, quota-stingy free tier) or open-source self-hosted options that demand ops work (Shlink, Kutt). Developers who just want `POST /links → short URL` inside their own product flows — SMS notifications, transactional emails, CLI output, QR pipelines — are underserved at the "generous free tier, honest API" price point.

**Wedge use case (validated by pilot):** transactional links in SMS/WhatsApp messages, where character limits make long URLs expensive and raw tracking of delivery-to-click matters.

## 3. Goals / Non-Goals

**Goals (v1)**
1. A production-grade REST API for link CRUD, bulk operations, tags, and click counts.
2. Redirects served from the edge: p50 < 50 ms, p99 < 150 ms globally (measured at Cloudflare edge, excluding client RTT).
3. Run Curastax's transactional links in production for ≥ 4 weeks as the pilot tenant.
4. Total infra cost ≤ $10/mo through pilot ($0 target) and public launch ($5 target).
5. Public developer launch with docs, OpenAPI spec, and abuse controls in place.

**Non-Goals (v1)**
- Web dashboard / UI of any kind (explicit priority 2; begins only after API is fully functional and pilot-proven).
- Custom / bring-your-own domains (v2 — see §21).
- Deep analytics (geo, device, referrer, event streams, webhooks) — click counts only.
- Workspaces, orgs, team features — single-owner model with multiple API keys.
- Monetization/billing — free during pilot and initial public phase.

## 4. Users

| Persona | v1? | Needs |
|---|---|---|
| **Curastax backend (pilot)** | ✅ | Server-to-server link creation for SMS/WhatsApp appointment links, invoice links, review requests. Bulk creation, per-clinic tagging, reliable counts. |
| **Indie/API-first developer (public)** | ✅ post-pilot | Simple key auth, generous free usage, copy-paste quickstart, OpenAPI spec, predictable errors. |
| **Non-technical marketer** | ❌ | Out of scope — no UI in v1. |

## 5. Decision Log (from requirements questionnaire)

| # | Decision | Choice | Consequence |
|---|---|---|---|
| D1 | v1 feature set | Custom slugs + expiry, click analytics, bulk ops + tags. **Not** custom domains. | All links live on `r301.dev/*` in v1. |
| D2 | Analytics depth | Click counts only | No event pipeline; a counter + timestamps per link. Massive infra simplification. |
| D3 | Tenancy | Single owner, many API keys | No orgs/users tables; keys are the unit of access. Public launch adds a minimal `users` table (one user → many keys) — additive, no migration pain. |
| D4 | Auth | Static API keys, hashed, prefixed | `r301_live_*` / `r301_test_*`; SHA-256 at rest; prefix-indexed lookup. |
| D5 | Redirect semantics | Per-link configurable, **default 302** | Accurate counts by default; 301 available for SEO/permanence use cases (with the caveat documented). |
| D6 | Rate limiting | None during pilot; mandatory before public launch | Pilot is private (keys never published). Launch gate M3 → M4 (§18). |
| D7 | Runtime | **TypeScript + Hono on Cloudflare Workers** | See §13 rationale. |
| D8 | Hosting topology | **Cloudflare edge: Workers + KV + D1** | Global redirect latency at $0–5/mo; no servers. |
| D9 | Budget | ≤ $10/mo pre-launch | Fits: $0 pilot (free tier), $5/mo at launch (Workers Paid). |
| D10 | Key lookup path | Auth = one indexed D1 SELECT per request; no KV key cache in v1 | Revocation genuinely immediate; zero invalidation logic. Escape hatch: cache at public scale. |
| D11 | Key prefix | Stored lookup prefix = **first 20 chars** (10 random), `UNIQUE` kept | Fixes collision bug: 12 chars left only 2 random → mint failures likely by ~73 keys vs §19's 100-key goal. |
| D12 | Key↔link visibility | Owner + environment scoped; `created_by_key_id` = attribution only | Any owner key manages all owner links; revoking a key never strands links; key rows never hard-deleted. At P1 "owner" becomes "user" additively. |
| D13 | Test keys | **Deferred to P1** (resolves open Q1) | Pilot tests end-to-end on staging with ordinary keys; `r301_test_` format stays reserved. Drops slug-prefixing, auto-expiry, and env-isolation code from P0. |
| D14 | Key management | Local mint/revoke scripts (`wrangler d1 execute`); no `/v1/keys` endpoints, no `ADMIN_TOKEN` in v1 | Zero public admin surface; secret generated locally, only prefix+hash stored. Endpoints arrive P1 with signup. |
| D15 | Delete semantics | Tombstone from day one: soft delete, slug stays blocked; P1 cron purges after 30 days (resolves open Q2) | No takeover-via-reuse ever; recreate → `slug_taken`; DELETE contract never changes at launch. |
| D16 | Slug rules | Case-sensitive match; **case-insensitive reserved check** on both custom and auto slugs; full base62 confirmed | `Admin`/`API` can't bypass reservation; max entropy kept; links are tapped, not transcribed. |
| D17 | Redirect edge semantics | Expired→410, deactivated/tombstoned/unknown→404 (deliberate split); query strings dropped; exact-match slugs only | Helpful 410 for recipients of expired transactional links; takedowns look never-existed; signed destination URLs never corrupted. |
| D18 | Idempotency | **P0**, stored in **D1** (resolves §8/§9 hedge); scope (api_key, key), 24 h; mismatch or in-flight duplicate → `409 idempotency_conflict` | Atomic, immediately consistent — retry-after-timeout actually works; KV write budget untouched. |
| D19 | `external_id` | Added in M0: nullable TEXT ≤128, **non-unique**, indexed, filterable (resolves open Q3) | Correlation without a Curastax mapping table; dedupe stays Idempotency-Key's job. |
| D20 | KV contract | D1 commits first, then **awaited** KV put; no negative caching; no `cacheTtl` override; ≤60 s staleness accepted for **all** mutations | KV is a rebuildable pure cache; slug scanners can't burn the 1k/day write budget; honest convergence story. |
| D21 | Count integrity | GET-only + **repo-versioned UA denylist** (messenger previews, email scanners, bots, tooling); canary doubles as drift instrument; `waitUntil` failures → Sentry | SMS/WhatsApp/email preview+scanner traffic filtered; residual documented honestly, not hidden. |
| D22 | Contract completions | Strict request validation (unknown fields → 400); batch = HTTP 200 + per-item results; codes gain `forbidden`/`method_not_allowed`/`idempotency_conflict`; `request_id` in envelope; cross-user objects present as 404 at P1; no CORS in v1; JSON-only; `openapi.json` ships P0 | Fail-loud DX; no existence probing; interop-safe batch. |
| D23 | Telemetry rule | **P0, test-enforced**: allowlist-only telemetry — destinations, bodies, query strings, auth headers never reach Sentry or logs | Patient-adjacent tokens can't leak; pinned by a unit test on the Sentry `beforeSend` scrubber. |
| D24 | Pilot flood posture | Stay free tier + day-one zone per-IP rate rule + budget alert with one-click upgrade playbook (D6 reworded) | Naive floods blocked; free-tier hard-stop risk bounded and monitored; $0 pilot target kept. |
| D25 | Ops additions | `GET /v1/health` + API-host probe; local-first dev, staging = smoke only, no free-tier load tests; "N−1 code on N schema" promotion gate; SLA wording softened; verify Time Travel window | Deploy verification + honest availability claims; prod protected from staging accidents. |

## 6. Scope & Prioritization

| Priority | Item |
|---|---|
| **P0** (pilot blocker) | Shorten endpoint; redirect edge; custom slugs; expiry; deactivate; click counting (UA-denylist filtered, D21); API key auth; bulk create; tags; delete (tombstoned, D15); update destination; idempotency (D1-backed, D18); `external_id` passthrough (D19); key mint/revoke scripts (D14); `GET /v1/health` (D25); no-sensitive-telemetry rule (D23); zone rate rule on redirect path (D24); staging + prod environments; D1 migrations; Sentry error reporting |
| **P1** (public-launch blocker) | Rate limiting + quotas; destination safety checks (Safe Browsing); reserved-slug list hardening; abuse report endpoint; API docs site + OpenAPI docs UI; key self-service signup + `/v1/keys` endpoints (D14); test keys (D13); tombstone purge cron (D15); GitHub secret-scanning registration; uptime monitoring hardening; D1 → R2 scheduled backups |
| **P2** (post-launch) | Web dashboard (the UI); daily click rollups; QR endpoint; custom domains; webhooks |

## 7. Functional Requirements

### 7.1 Link lifecycle
- **Create** — `POST /v1/links` with `destination` (required), optional `slug`, `redirect_type`, `expires_at`, `tags[]`, `external_id` (D19).
  - Auto-slug: 7-char base62 (~3.5 × 10¹²  space), cryptographically random, retry on collision (unique index enforces).
  - Custom slug: 3–64 chars, `[a-zA-Z0-9_-]`, case-sensitive match but **reserved-word blocked case-insensitively** (`api`, `v1`, `docs`, `admin`, `status`, `www`, `abuse`, top ~200 brand/system words; list versioned in-repo; the check also runs on auto-slugs, retrying on the absurd-odds hit — D16).
  - Destination validation: `http(s)` scheme only; reject `javascript:`, `data:`, `file:`; reject private/loopback/link-local IPs and `localhost`; reject credentials-in-URL (`user:pass@`); reject destinations on `r301.dev` itself (self-redirect loops); IDN hosts punycode-normalized before the IP/localhost checks; max 2048 chars; must parse as a valid WHATWG URL. (Scope note: hostnames that privately *resolve* to internal IPs are outside v1's threat model — the service never fetches destinations.)
- **Read** — `GET /v1/links/{slug}` and `GET /v1/links` (cursor-paginated, filterable by `tag`, `active`, `created_after`, `external_id`).
- **Update** — `PATCH /v1/links/{slug}`: mutable fields = `destination`, `redirect_type`, `expires_at`, `is_active`, `tags`, `external_id`. Slug is immutable (delete + recreate under a new slug; the old slug stays tombstoned per D15). *Mutable destinations are a feature, not a bug — it's why 302 is the default.*
- **Delete** — `DELETE /v1/links/{slug}`: **tombstoned** (soft delete, `deleted_at` set — D15). The slug stays blocked (`UNIQUE(slug)` spans tombstones; recreate returns `slug_taken`) until the P1 cron purges tombstones older than 30 days. Deactivation (`is_active=false`) remains the reversible alternative.
- **Expiry** — lazy evaluation at redirect time: `expires_at < now` → `410 Gone`. No cron sweep needed in v1.

### 7.2 Bulk operations
- `POST /v1/links/batch` — up to **100 link objects** per request. Response is **HTTP 200** with per-item results in request order (`slug` or `error` each, per-index status — D22); the batch never all-or-nothing fails on one bad item.
- Items execute sequentially (D1's `batch()` is a transaction that aborts on first error, which contradicts per-item semantics), so batch is excluded from the standard API latency NFR with its own ≤ 2 s budget at 100 items. One `Idempotency-Key` covers the whole batch.

### 7.3 Tags
- Free-form strings, ≤ 64 chars, ≤ 10 tags per link. Created implicitly on first use.
- `GET /v1/tags` lists tags with link counts. `GET /v1/links?tag=x` filters.
- **Pilot convention:** Curastax tags every link `tenant:{clinic_id}` and `kind:{appointment|invoice|review}` — giving per-clinic, per-type counts with zero shortener-side tenancy work.

### 7.4 Analytics (counts only — D2)
- Per link: `click_count` (lifetime total), `last_clicked_at`, `created_at`.
- `GET /v1/links/{slug}/stats` returns the above; `GET /v1/stats?tag=x` returns aggregate count across tagged links.
- Counting is **asynchronous and best-effort**: the redirect response never waits on the counter write (`ctx.waitUntil`, body wrapped in try/catch → Sentry so silent loss is visible). Documented as "at-least-approximate"; drift target < 0.1%.
- **Drift definition (D21):** |counted − true served| / true served, where "true served" = successful 30x GETs after bot filtering. Measured continuously for free: the §15 uptime canary hits its slug at a known cadence (60 s → 1,440/day expected), so weekly `click_count` vs expected is the loss meter. Consequences: the probe's UA stays deliberately countable (it's the ruler) and the canary link stays untagged (never pollutes tag aggregates).
- **Bot filtering v1 (D21):** only successful 30x GETs count — HEAD serves the redirect but never counts; 404/410 never count. On top: a **repo-versioned user-agent denylist** covering messenger preview fetchers (WhatsApp, RCS/Google Messages, iMessage), email link scanners (Outlook SafeLinks, Proofpoint, Mimecast patterns), social/crawler bots, monitoring and HTTP tooling — pilot channels are SMS + WhatsApp + email, all of which prefetch. Redirect-path logs include the UA during pilot to tune the list from real traffic. Honest docs note: stealthy scanners with browser-like UAs slip through; the residual is documented, and Curastax sanity-checks counts against appointment confirmations.

### 7.5 Redirect behavior
| Condition | Response |
|---|---|
| Active link | `redirect_type` (301/302/307/308, default **302**) + `Location` |
| 301/308 links | `Cache-Control: public, max-age=3600` (bounded permanence — counts still mostly work) |
| 302/307 links | `Cache-Control: no-store` |
| Expired | `410 Gone`, minimal "link expired" text body (deliberate — helps recipients of stale transactional links; an existence leak on random slugs is worthless, D17) |
| Unknown slug | `404 Not Found`, minimal text body |
| Deactivated | `404` (owner takedown looks never-existed) |
| Tombstoned (deleted) | `404` (the tombstone is an implementation detail, not a public state) |
| Root `r301.dev/` | Redirect → docs site (later); pilot: plain landing text |
| `/robots.txt` | Static `Disallow: /` (short links shouldn't be crawled; also trims well-behaved-bot count noise) |
| `/favicon.ico` | `204 No Content` |

Evaluation order: unknown/tombstoned → 404, inactive → 404, expired → 410, else redirect (deactivation outranks expiry). Slugs match exactly — `/abc/` and `/a/b` → 404. **Query strings on short URLs are dropped** (D17): the redirect targets the stored destination verbatim, so appended params can never corrupt signed/tokenized destination URLs; per-link opt-in forwarding sits in the v2 backlog. All 4xx redirect-path responses carry `Cache-Control: no-store` so reactivation via PATCH isn't fought by intermediary caches. No CDN-layer caching of redirect responses in v1 — `Cache-Control` governs clients/intermediaries only; edge execution on every hit is what makes counting work.

### 7.6 API keys & control-plane bootstrap
- Format: `r301_live_` (or the P1-reserved `r301_test_`) + 32 chars base62 (~190 bits). Shown **once** at creation.
- Storage: SHA-256 hash (unsalted is sound at this entropy — salts defend low-entropy passwords, not 190-bit randoms); **first 20 chars** stored plaintext as the `UNIQUE` indexed `prefix` for O(1) lookup (D11 — 12 chars left only 2 random beyond the fixed `r301_live_`, colliding by ~73 keys); constant-time hash compare.
- **Lookup path (D10):** every authenticated request performs one indexed D1 SELECT — no KV key cache in v1. Revocation is therefore genuinely immediate. `last_used_at` updates lazily with zero extra state: compare the timestamp already fetched during auth; if > 1 h stale, `waitUntil` an UPDATE.
- **Visibility (D12):** access is scoped to **owner + environment** — any live key of the owner manages all the owner's live links; `created_by_key_id` is attribution only; revoking a key never strands its links. At P1, "owner" becomes "user" additively. Key rows are never hard-deleted (`revoked_at` soft revoke — the links FK depends on the row).
- **Test keys (D13):** deferred to P1. Pilot end-to-end testing happens on the staging environment with ordinary keys.
- **Bootstrap (D14):** no key-management endpoints and no admin token in v1. Keys are minted/revoked via local scripts (`pnpm mint-key` / `pnpm revoke-key`): the secret is generated locally, only `prefix` + hash are INSERTed via `wrangler d1 execute`, and the key prints exactly once. Rotation runbook: mint new → switch client → revoke old. CI smoke keys (per env) and the canary's key are minted into GitHub Actions secrets. Public launch (P1) introduces email-based signup and self-service `/v1/keys`.

## 8. API Design

- **Base URL:** `https://api.r301.dev/v1` (redirects on apex `https://r301.dev/{slug}`; both routes served by the same Worker).
- **Auth:** `Authorization: Bearer r301_live_...` on every `/v1/*` route. Missing/invalid → `401` with machine-readable code.
- **Versioning:** URL path (`/v1/`). Breaking changes → `/v2/`; additive changes are non-breaking by contract.
- **Errors:** consistent envelope:
  ```json
  { "error": { "code": "slug_taken", "message": "Slug 'launch' is already in use.", "field": "slug" } }
  ```
  Canonical codes: `invalid_request`, `unauthorized`, `forbidden`, `not_found`, `method_not_allowed`, `slug_taken`, `slug_reserved`, `destination_invalid`, `destination_blocked`, `idempotency_conflict`, `rate_limited` (reserved until P1), `internal`. The envelope also carries `request_id` (mirrors `X-Request-Id`) for supportability (D22).
  Semantics: credential problems (missing/malformed/unknown/revoked key) → 401; at P1, cross-user objects present as **404** (no existence probing); 403 is reserved for explicit capability denials. Requests are validated **strictly** — unknown or misspelled body fields → 400 naming the field. Responses may gain fields at any time; clients must ignore unknown *response* fields (tolerant reader). JSON only: request bodies require `Content-Type: application/json` (else 415). No CORS headers in v1 (server-to-server product; revisited for the P1 docs console).
- **Idempotency (P0, D18):** `Idempotency-Key` header honored on `POST /v1/links` and `/batch`; scope (api_key, key), 24 h window, **stored in D1** — atomic and immediately consistent, where KV's eventual consistency would make retry-after-timeout (the exact case that matters for SMS sends) best-effort. Identical replay → stored response + `Idempotency-Replayed: true`; same key with a different payload, or a concurrent in-flight duplicate → `409 idempotency_conflict` (message differentiates).
- **Pagination:** opaque cursor (`?cursor=`, `?limit=` ≤ 100, default 25); response carries `next_cursor`.
- **Spec:** OpenAPI 3.1 auto-generated from Zod schemas (`@hono/zod-openapi`), served at `/v1/openapi.json` (P0 — free once schemas exist); docs UI (Scalar) at `docs.r301.dev` (P1).

### Endpoint summary
| Method + Path | Purpose | Priority |
|---|---|---|
| `POST /v1/links` | Create link | P0 |
| `POST /v1/links/batch` | Bulk create (≤100) | P0 |
| `GET /v1/links` | List/filter links | P0 |
| `GET /v1/links/{slug}` | Fetch one | P0 |
| `PATCH /v1/links/{slug}` | Update mutable fields | P0 |
| `DELETE /v1/links/{slug}` | Delete | P0 |
| `GET /v1/links/{slug}/stats` | Counts for one link | P0 |
| `GET /v1/stats?tag=` | Aggregate counts by tag | P0 |
| `GET /v1/tags` | List tags | P0 |
| `GET /v1/health` | Unauthenticated: status, git SHA, env (D25) | P0 |
| `GET /v1/openapi.json` | OpenAPI 3.1, generated from Zod (D22) | P0 |
| `POST/GET/DELETE /v1/keys` | Self-service key management (arrives with signup — D14) | P1 |
| `POST /v1/abuse-reports` | Public abuse reporting | P1 |
| `GET /{slug}` (apex) | Redirect | P0 |

## 9. Data Model (D1 / SQLite)

```sql
CREATE TABLE links (
  id            INTEGER PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,           -- UNIQUE spans tombstones: blocks reuse (D15)
  destination   TEXT NOT NULL,
  redirect_type INTEGER NOT NULL DEFAULT 302 CHECK (redirect_type IN (301,302,307,308)),
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  expires_at    INTEGER,                        -- epoch ms, NULL = never
  deleted_at    INTEGER,                        -- tombstone (D15); live queries filter IS NULL
  external_id   TEXT,                           -- ≤128 chars, correlation passthrough (D19)
  click_count   INTEGER NOT NULL DEFAULT 0,
  last_clicked_at INTEGER,
  created_by_key_id INTEGER NOT NULL REFERENCES api_keys(id),  -- attribution only (D12)
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_links_key_created ON links(created_by_key_id, created_at DESC);  -- serves P1 per-user scoping
CREATE INDEX idx_links_created ON links(created_at DESC);      -- owner-global listing (D12)
CREATE INDEX idx_links_external ON links(external_id);         -- ?external_id= filter (D19)

CREATE TABLE tags (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE link_tags (
  link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id),
  PRIMARY KEY (link_id, tag_id)
);
CREATE INDEX idx_link_tags_tag ON link_tags(tag_id);

CREATE TABLE api_keys (
  id           INTEGER PRIMARY KEY,
  prefix       TEXT NOT NULL UNIQUE,            -- first 20 chars (D11), lookup index
  key_hash     TEXT NOT NULL,                   -- sha256 hex
  name         TEXT NOT NULL,
  environment  TEXT NOT NULL DEFAULT 'live',    -- live|test (test unused until P1 — D13)
  created_at   INTEGER NOT NULL,
  revoked_at   INTEGER,                         -- soft revoke; rows never hard-deleted (D12)
  last_used_at INTEGER
);

CREATE TABLE idempotency_keys (                  -- canonical store (D18); 24 h TTL enforced on read, expired rows purged opportunistically on insert
  key             TEXT NOT NULL,
  api_key_id      INTEGER NOT NULL,
  request_hash    TEXT NOT NULL,                 -- payload mismatch → 409 idempotency_conflict
  response_status INTEGER,
  response_body   TEXT,                          -- NULL while in-flight
  created_at      INTEGER NOT NULL,
  PRIMARY KEY (key, api_key_id)
);
```

**KV namespace `REDIRECTS`** (hot path cache, write-through):
```
key:   slug
value: { d: destination, t: redirect_type, x: expires_at|null, a: is_active }
```
Written on link create/update/delete (delete → KV delete; deactivate writes `a:0`). **Ordering invariant (D20):** D1 commits first, then the KV put is *awaited* — a KV failure returns 500 and the idempotent retry converges; a fire-and-forget KV write that silently failed would leave a stale entry backfill can never heal (stale ≠ miss). D1 remains the source of truth; KV miss falls through to D1 and backfills. **No negative caching** — misses never write KV entries, or a random-slug scanner would spend the 1k/day write budget filling the cache with garbage. KV holds zero unique state (counts live only in D1) and is always rebuildable from D1.

## 10. Architecture & Redirect Path

```
                    Cloudflare edge (300+ PoPs)
  GET r301.dev/{slug}
      │
      ▼
  Worker (Hono router)
      │ 1. KV get(slug)  ──hit──► build 30x response ──► client   (~1 KV read, <1ms CPU)
      │ 2. miss → D1 SELECT → backfill KV → respond
      │ 3. ctx.waitUntil(  D1: UPDATE links SET click_count = click_count+1,
      │                       last_clicked_at = ?  WHERE slug = ?  )
      ▼
  api.r301.dev/v1/* → same Worker, API routes → D1 (+ KV write-through)
```

Key properties:
- **Redirect never blocks on the counter** — `waitUntil` runs after the response is flushed.
- **Consistency note (D20):** KV propagation is eventual (typically ≤ 60 s globally), and **every mutation** — edit, deactivate, delete — may take that long to converge at distant PoPs. Accepted and documented for v1; no `cacheTtl` override (it would widen the window). Escape hatch if a customer ever needs instant repointing: D1 read replication (Sessions API).
- **Free-tier ceilings, honest math:** with idempotency in D1 (D18) and test keys deferred (D13), a create costs 1 KV write; at the pilot's 50–200 links/day plus updates and miss-backfills that's ~100–400 KV writes/day against the 1,000/day cap — **2.5–10× headroom**, shared account-wide with staging (hence local-first dev and staging-as-smoke-only, §14). D1's 100k rows/day covers < 5k clicks/day 20×. Redirect-path flood exposure on free-tier ceilings is handled by D24 (zone rule + upgrade playbook, §12). Public scale path in §16.

## 11. Non-Functional Requirements

| Attribute | Target |
|---|---|
| Redirect latency | p50 < 50 ms, p99 < 150 ms (edge-measured) |
| API latency | p50 < 150 ms, p99 < 500 ms |
| Availability | 99.9% **target**, measured by external probes (redirect canary + API health — D25). No credit-backed SLA exists at this pricing tier; the probe is the contract. |
| Count accuracy | Drift < 0.1% vs true redirects served |
| Durability | D1 Time Travel PITR — **verify the actual free-tier window at setup** (likely 7 d, not 30; runbook item, D25) + weekly export to R2 (P1) |
| Data location | Cloudflare-managed; D1 primary region auto-selected (choose APAC hint for Curastax proximity on writes) |

## 12. Security & Abuse

**v1 (pilot — private surface):**
- Keys hashed (SHA-256), never logged; constant-time comparison; revocation immediate — auth reads D1 directly, no key cache (D10).
- HTTPS everywhere — `.dev` is HSTS-preloaded, so plain HTTP never even connects.
- Destination validation per §7.1 (scheme allowlist, private-IP block, credentials-in-URL block, self-domain block, length cap).
- **No-sensitive-telemetry rule (P0, D23):** telemetry is allowlist-only — route template, method, status, latency, request-id, key prefix (+ user-agent on the redirect path during pilot, D21). Destination URLs, request bodies, query strings, and auth headers **never** reach Sentry or logs; a unit test pins the Sentry `beforeSend` scrubber so an implementation session can't silently regress it.
- **Redirect-path flood posture (D24):** day-one Cloudflare zone rate rule (per-IP, ~100 req/10 s, threshold tuned on staging — far above carrier-NAT click bursts) + the §15 budget alert armed with a documented one-click upgrade playbook to Workers Paid. Rationale: the redirect path is public and unauthenticated by design, and free-tier daily ceilings otherwise let one naive single-IP flood take down all already-sent links until midnight UTC.
- Secrets via `wrangler secret` (v1 needs only `SENTRY_DSN` — D14 removed `ADMIN_TOKEN`); no secrets in repo; least-privilege Cloudflare API token for CI.

**P1 (public-launch gate):**
- **Malicious-URL screening:** Google Safe Browsing v4 lookup at creation time + async re-check batch (cron trigger, daily) for stored destinations; hits → link deactivated + key flagged. *Shorteners' #1 operational risk is phishing abuse — this is a launch blocker, not a nice-to-have.*
- Rate limiting: Workers Rate Limiting binding per API key (e.g., 60 writes/min, 600 reads/min) + Cloudflare zone rules on redirect path for L7 floods.
- `POST /v1/abuse-reports` + `abuse@r301.dev`; deactivate-on-report SLA of 24 h.
- Reserved-slug and banned-destination-domain lists maintained in repo.
- GitHub secret-scanning partner registration for the `r301_live_` key pattern (free leak protection).

## 13. Tech Stack (final)

| Layer | Choice | Rationale |
|---|---|---|
| Runtime | **Cloudflare Workers** (V8 isolates) | Edge-global, zero cold start pain, $0→$5/mo fits budget, no servers to patch. |
| Language/framework | **TypeScript + Hono** | Native to Workers; Zod-typed routes → auto OpenAPI; you already write TS. |
| Primary store | **D1** (SQLite) | Relational fits links/tags/keys; migrations; Time Travel PITR; 5 GB free ≈ tens of millions of links. |
| Hot cache | **Workers KV** | Sub-ms edge reads on the redirect path. |
| Idempotency store | **D1 table** (D18) | Atomic + immediately consistent (KV's eventual consistency breaks retry-after-timeout); 24 h TTL enforced on read, purged opportunistically. |
| Background jobs | Cloudflare **Cron Triggers** (P1: Safe Browsing re-checks, R2 backups) | Built-in, free. |
| Error tracking | **Sentry** (`@sentry/cloudflare`) | You already run Sentry; one DSN, source-mapped stack traces. |
| CI/CD | **GitHub Actions + Wrangler** | `wrangler deploy` per env; D1 migrations via `wrangler d1 migrations apply`. |
| IaC | `wrangler.toml` (envs: `staging`, `production`) | Bindings, routes, secrets declared in-repo. |
| Docs | Scalar on `docs.r301.dev` from OpenAPI (P1) | Zero-maintenance reference docs. |
| Monitoring | Workers analytics + external uptime probe (UptimeRobot free) | Independent availability measurement. |

**Alternatives considered & rejected**
- *Spring Boot on AWS (ECS/Fargate + ALB + RDS):* home-turf skills, but ~$40–60/mo floor (4–6× budget), single region, always-on JVM for a workload that idles for weeks. Wrong physics for this product.
- *Go on Hetzner VPS (~$5/mo):* fits budget, but single-region latency, self-managed TLS/backups/patching, no scaling story — contradicts the "scaling strategy" requirement.
- *AWS Lambda + DynamoDB:* viable and near-free, but worse global redirect latency than edge, more moving parts (API GW, CloudFront, IAM), and JVM is off the table anyway.

## 14. Environments, CI/CD, Migrations

- **Envs:** `staging` (staging.r301.dev + api-staging.r301.dev, own D1 + KV) and `production`. Both defined in `wrangler.toml`.
- **Pipeline:** PR → typecheck + unit tests (Vitest + Miniflare) → deploy to staging on merge to `main` → smoke test (create/redirect/stats round-trip) → manual promote (tag) → production deploy → post-deploy smoke.
- **Migrations:** numbered SQL files, applied via `wrangler d1 migrations apply` as a pipeline step *before* Worker deploy; forward-only, additive-first discipline (your zero-downtime instincts apply directly).
- **Rollback:** Workers keeps prior versions — `wrangler rollback` is instant; schema rollbacks avoided by additive migrations. Promotion-gate invariant (D25): **N−1 code must run correctly on N schema** — that's what makes rollback always safe. CI applies the full migration chain to ephemeral local D1 in tests, so every PR proves it.
- **Quota discipline (D25):** staging and prod share account-level free-tier quotas — a runaway staging load test can take down prod redirects. Therefore: development is **local-first** (Miniflare / vitest-pool-workers, zero platform usage); staging exists for smoke tests only (~tens of requests/run); load testing on the free tier is banned (run locally, or after the D24 upgrade). Smoke test shape: create (auto-slug, tagged `smoke`, dedicated per-env key) → follow redirect → check stats → delete.

## 15. Observability

- Sentry for exceptions (API + redirect path, sampled).
- `wrangler tail` for live debugging; Workers Logs retained on paid plan.
- Structured log line per API request: key prefix, route template, status, latency, request-id (also returned as `X-Request-Id`); the redirect path adds the user-agent during pilot (denylist tuning, D21). Telemetry allowlist per D23 — destinations, bodies, query strings, and auth headers never appear. Pilot note: free-tier log lines are ephemeral (`wrangler tail` only); durable forensics = Sentry events + D1 state.
- Sentry releases tagged with the git SHA in CI; the same SHA surfaces in `GET /v1/health` — "which deploy broke it" stays answerable (D25).
- External uptime probes every 60 s → alert to email/Telegram: `r301.dev/{canary-slug}` (redirect path — doubles as the drift instrument, D21) and `api.r301.dev/v1/health` (D25). The canary link is created once, untagged, never deleted; the probe UA is deliberately countable.
- Weekly cost check: Cloudflare dashboard budget alert set at $8.

## 16. Scaling & Cost Model

| Stage | Traffic | Plan | Est. cost | Notes |
|---|---|---|---|---|
| **Pilot (Curastax)** | <5k redirects/day, 50–200 links/day | Free | **$0/mo** | KV writes 2.5–10× clear, everything else 10–100× (honest math in §10); D24 tripwires armed. |
| **Public launch** | ≤10M req/mo | Workers Paid | **$5/mo** | Included request allotment covers it; KV/D1 overage pennies. |
| **Growth** | 50M redirects/mo | Workers Paid + overage | ~$20–25/mo | Requests + KV reads dominate; still no servers. |
| **Heavy** | 500M+/mo | Same platform | ~$150–200/mo | Move click counting from per-request D1 writes → **Queues batching** (aggregate increments per 30 s) or Analytics Engine + rollup; consider per-key read replicas. |

Deliberate scaling posture: **no re-architecture until ~10⁸ req/mo.** The two pressure points and their pre-planned releases:
1. **D1 write amplification from counters** → Queues-based batched increments (drop-in, changes only the `waitUntil` body).
2. **D1 size beyond ~5–10 GB** → archive expired/inactive links to R2; slugs live mostly in KV anyway.

## 17. Curastax Pilot Plan

- **Integration:** small Java client in the Curastax Spring Boot backend (plain `HttpClient` or a 50-line SDK) calling `POST /v1/links` at message-send time; batch endpoint for campaign sends.
- **Use cases:** (1) appointment confirmation/reschedule links in SMS/WhatsApp, (2) invoice/receipt links (SMS/email), (3) post-visit review requests. Pilot channels: SMS + WhatsApp + email (drives D21's denylist scope).
- **Tagging convention:** `tenant:{clinic_id}`, `kind:{appointment|invoice|review}` → per-clinic click reporting via `GET /v1/stats?tag=`.
- **Exit criteria (pilot → public):** ≥ 4 weeks in production; ≥ 2,000 redirects served; zero data-loss incidents; count drift < 0.1%; p99 redirect < 150 ms from IN + one EU/US probe; no unhandled 5xx classes in Sentry for final 2 weeks.

## 18. Milestones

| Milestone | Scope | Target |
|---|---|---|
| **M0 — Foundation** | Repo, wrangler envs, D1 schema + migrations, CI/CD skeleton, Sentry | Week 1 |
| **M1 — Core API** | All P0 endpoints, KV write-through, redirect path, counting + UA denylist, idempotency, key mint/revoke scripts, tests | Weeks 1–3 |
| **M2 — Pilot** | Curastax integration live, canary monitoring, 4-week soak | Weeks 3–7 |
| **M3 — Hardening** | Rate limits + quotas, Safe Browsing, abuse endpoint, backups, docs site, signup + `/v1/keys`, test keys (D13), tombstone purge cron (D15) | Weeks 7–9 |
| **M4 — Public launch** | Announce (HN/dev.to/X), landing page (static, not "the UI") | Week 10 |
| **M5 — UI (priority 2)** | Dashboard: key mgmt, link list, counts. Only after M4 stability. | Post-launch |

## 19. Success Metrics

- **Pilot:** exit criteria in §17 met.
- **Launch + 30 days:** ≥ 100 API keys issued; ≥ 25 keys with activity in week 4 (retention proxy); ≥ 100k redirects served; infra ≤ $10/mo; zero abuse incidents older than 24 h unresolved.
- **Quality:** p99 targets held; error rate (5xx) < 0.1% of API calls.

## 20. Risks & Open Questions

| Risk | Severity | Mitigation |
|---|---|---|
| Phishing/malware abuse post-launch damages domain reputation (r301.dev blocked by filters) | **High** | §12 P1 controls are launch-blocking; monitor Google Safe Browsing status of r301.dev itself; aggressive takedown SLA. |
| KV eventual consistency: any mutation (edit/deactivate/delete) converges ≤ 60 s globally | Low | Documented (D20); acceptable for pilot; escape hatch = D1 read replication. |
| Preview/scanner traffic (WhatsApp, RCS, email SafeLinks) inflates the wedge metric | Medium | GET-only + repo-versioned UA denylist tuned from pilot-logged UAs; residual documented honestly (D21). |
| Free-tier daily caps hit (organic spike or redirect-path flood) | Medium | Day-one zone per-IP rate rule + budget alert + pre-armed one-click upgrade playbook (D24). |
| Cloudflare platform lock-in | Medium | Accepted deliberately for cost/latency; schema is plain SQLite and API is framework-thin — a container port (Hono runs on Node/Bun) exists if ever needed. |
| Count writes lost on isolate eviction (waitUntil best-effort) | Low | Accepted (<0.1% target); Queues upgrade path restores durability if it matters later. |
| Solo-maintainer bus factor during pilot (Curastax depends on it) | Medium | Curastax integration wraps calls with graceful fallback: on r301 failure, send the long URL. Never block a patient SMS on the shortener. |

**Open questions — all resolved at Phase 1 sign-off (31 Aug 2026)**
1. Test-key links: **resolved by D13** — test keys deferred to P1 entirely; the pilot tests end-to-end on staging with ordinary keys.
2. Slug reuse after delete: **resolved by D15** — tombstoned from day one; the P1 cron purges tombstones after 30 days, freeing slugs.
3. `external_id` passthrough: **resolved by D19** — added in M0: nullable TEXT ≤ 128, non-unique, indexed, filterable, echoed in payloads.

## 21. v2 Backlog (explicitly deferred)

Custom domains via Cloudflare for SaaS (custom hostnames — the platform feature built for exactly this) · geo/device/referrer analytics · webhook events on click thresholds · QR code endpoint · daily count rollups & time-series stats · workspaces/teams · dashboard UI (M5) · SDKs (TS + Java first, Java informed by the Curastax client) · link-level passwords · UTM builder helpers · per-link opt-in query-string forwarding (v1 drops incoming params, D17) · per-IP click-dedup windows (beyond D21's UA denylist).
