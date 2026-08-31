# r301.dev — System Design

Elaborates the signed-off PRD (v1.0). Every section cites the PRD sections/decisions it derives from.
If anything here contradicts the PRD, the PRD wins — log a deviation in PROGRESS.md and ask.

## 1. Topology (PRD §10, D8)

One Worker (`r301-api`) serves both hostnames per environment:

| Env | Redirect host | API host | Bindings |
|---|---|---|---|
| production | `r301.dev` | `api.r301.dev` | `DB` (D1), `REDIRECTS` (KV) |
| staging | `staging.r301.dev` | `api-staging.r301.dev` | own `DB`, own `REDIRECTS` |

Routing is by hostname inside the Worker: API hosts mount `/v1/*`; redirect hosts mount the slug route plus the housekeeping routes (§7.5). D1 primary region: APAC hint (PRD §11).

## 2. Redirect path — the hot path (PRD §7.5, §10, D17)

```
GET {redirect-host}/{slug}
  1. Route housekeeping first: "/" → 302 to `https://www.r301.dev/` (D29); "/robots.txt" → "Disallow: /"; "/favicon.ico" → 204.
  2. Parse slug: must match ^[a-zA-Z0-9_-]{3,64}$ (single segment, exact — "/abc/" and "/a/b" → 404).
  3. KV get(slug) → JSON {d, t, x, a}.
     hit  → evaluate below, respond. (~1 KV read, <1 ms CPU)
     miss → D1 SELECT (any row, live or tombstoned) →
              no row            → 404, DO NOT write KV (no negative caching, D20)
              deleted_at set    → 404, DO NOT backfill
              else              → backfill KV {d,t,x,a} via waitUntil, evaluate below
  4. Evaluation order (D17): inactive (a=0) → 404; expired (x < now) → 410; else 30x redirect.
     Deactivation outranks expiry.
  5. Count (see §7) via ctx.waitUntil — never blocks the response (PRD §7.4).
```

Response headers:

| Case | Status | Headers |
|---|---|---|
| Active, type 302/307 | per link | `Location`, `Cache-Control: no-store` |
| Active, type 301/308 | per link | `Location`, `Cache-Control: public, max-age=3600` |
| Expired | 410 | `Cache-Control: no-store`, minimal "link expired" text |
| Unknown / deactivated / tombstoned | 404 | `Cache-Control: no-store`, minimal text |

All responses carry `X-Request-Id`. Query strings on the short URL are **dropped** (D17): the `Location` is the stored destination verbatim. `HEAD` behaves exactly like `GET` but is never counted; other methods on the slug route → 405 (plain text). No CDN-layer caching of redirect responses — edge execution on every hit is what makes counting work (§7.5).

## 3. KV/D1 contract (PRD §9, D20)

KV namespace `REDIRECTS`: `slug → {"d": destination, "t": redirect_type, "x": expires_at|null, "a": 0|1}`.

- **Ordering invariant:** D1 commits first; then the KV put/delete is **awaited** in-request. KV failure → 500; the client's idempotent retry converges (KV puts are naturally idempotent). Never fire-and-forget a KV write: a silently failed put leaves a stale entry that backfill can never heal (stale ≠ miss).
- Writes: create → put; update → put (new values); deactivate → put with `a:0`; delete/tombstone → KV delete.
- **No negative caching**: misses never create KV entries (a slug scanner would burn the 1k/day write budget). Misses fall through to D1 (5M free reads/day absorbs them).
- **No `cacheTtl` override** on gets — it would widen the ≤60 s convergence window.
- KV holds zero unique state (counts live only in D1) → KV is always rebuildable from D1. Treat KV incidents casually; treat D1 as truth.
- Staleness: any mutation may take ≤60 s to converge at distant PoPs. Accepted + documented (D20).

## 4. Auth (PRD §7.6, D4, D10–D12)

```
Authorization: Bearer r301_live_<32 base62>
  1. Missing/malformed header, or wrong shape → 401 unauthorized.
  2. prefix = first 20 chars of the presented key (D11).
     SELECT id, key_hash, environment, revoked_at, last_used_at FROM api_keys WHERE prefix = ?
  3. No row → 401. Compare sha256(presented) to key_hash with a constant-time compare
     (crypto.subtle.timingSafeEqual on equal-length buffers). Mismatch → 401.
  4. revoked_at set → 401. (Revocation is immediate — there is no key cache, D10.)
  5. Attach key context {id, environment} to the request.
  6. last_used_at: if NULL or > 1 h old (value already fetched in step 2), waitUntil an UPDATE.
     No extra state, ≤1 write/hour/key (§7.6).
```

Visibility (D12): owner + environment scoped. v1 has one owner, so every live key reads/mutates every live link; `created_by_key_id` is recorded as attribution only. Key rows are never hard-deleted (`revoked_at` soft revoke — the links FK depends on the row). Unauthenticated routes: `GET /v1/health`, `GET /v1/openapi.json`, and the entire redirect host.

## 5. Idempotency (PRD §8, D18) — reserve-then-execute

Applies to `POST /v1/links` and `POST /v1/links/batch`. Store: D1 `idempotency_keys` (PK `(key, api_key_id)`).

```
hash = sha256(raw request body bytes)          -- byte-exact retries required; document for clients
1. INSERT (key, api_key_id, request_hash=hash, response_status=NULL, response_body=NULL, created_at=now)
2a. INSERT ok → execute the operation →
      success → UPDATE row SET response_status, response_body → return response
      failure (incl. awaited-KV-put 500) → DELETE the reservation row, then return the error
2b. PK conflict → SELECT the row:
      created_at older than 24 h            → DELETE row, retry from 1   (expired window)
      request_hash ≠ hash                   → 409 idempotency_conflict ("different payload")
      response_body IS NULL:
        row younger than 60 s               → 409 idempotency_conflict ("in flight")
        row 60 s or older                   → abandoned (isolate died before cleanup):
                                              DELETE row, retry from 1
      else → replay stored (status, body) verbatim + header `Idempotency-Replayed: true`
3. Opportunistic purge (waitUntil): DELETE FROM idempotency_keys WHERE created_at < now-24h LIMIT 50.
```

## 6. Slug service (PRD §7.1, D15–D16)

- Auto-slug: 7 chars from the full base62 alphabet, `crypto.getRandomValues` with **rejection sampling** (62 ∤ 256 — naive modulo biases the distribution). Retry ≤3 on UNIQUE violation, then 500 (never happens at sane scale).
- Reserved-word check: case-insensitive, against `src/reserved-slugs.ts` (versioned in repo), applied to **both** custom and auto slugs (auto retries on the absurd-odds hit).
- Custom slug: `^[a-zA-Z0-9_-]{3,64}$`, case-sensitive storage/match.
- Create conflict: any existing row — live **or tombstoned** — is `slug_taken` (409). `UNIQUE(slug)` does the work; tombstones (D15) block reuse until the P1 purge cron.
- Delete: `UPDATE links SET deleted_at = now` + awaited KV delete. Every read query filters `deleted_at IS NULL`.

## 7. Counting & bot filter (PRD §7.4, D21)

Filter chain, evaluated only after a successful 30x response is built:

```
method === "GET"?  →  UA not matched by denylist?  →  ctx.waitUntil(
   UPDATE links SET click_count = click_count + 1, last_clicked_at = ? WHERE slug = ? AND deleted_at IS NULL
) — wrapped in try/catch → Sentry, so silent counter loss is visible.
```

`src/bot-denylist.ts`: versioned array of lowercase UA substrings. Starter set (tuned from pilot logs — redirect-path structured logs include the UA during pilot):
`whatsapp`, `facebookexternalhit`, `facebot`, `telegrambot`, `twitterbot`, `slackbot`, `discordbot`, `linkedinbot`, `skypeuripreview`, `googlebot`, `google-safebrowsing`, `bingbot`, `applebot`, `safelinks`, `proofpoint`, `mimecast`, `barracuda`, `curl`, `wget`, `python-requests`, `go-http-client`, `okhttp`, `headlesschrome`.
**Deliberately NOT listed:** the UptimeRobot probe UA — the canary link's counts are the drift instrument (D21): 60 s cadence → 1,440 expected counts/day, compared weekly.

## 8. Errors & request IDs (PRD §8, D22)

- `X-Request-Id: crypto.randomUUID()` middleware on every request (API + redirect); echoed in the error envelope, the structured log line, and as a Sentry tag.
- Error envelope + full code→status table: `docs/api-contract.md` (canonical).
- Zod validation is **strict**: unknown body fields → 400 `invalid_request` naming the field.

## 9. Telemetry (PRD §15, D23)

- Structured log line (allowlist only): `{request_id, route (template, not raw path), method, status, latency_ms, key_prefix?, ua? (redirect path, pilot only)}`. **Never**: destination URLs, request bodies, query strings, `Authorization`/`Cookie` headers.
- Sentry (`@sentry/cloudflare`): errors only (`tracesSampleRate: 0`), release = git SHA (CI-injected). A `beforeSend` scrubber strips request bodies, query strings, headers, and any field matching the forbidden set — **pinned by a unit test** (D23). Never weaken it.
- **URLs inside Sentry events (D23 — approved 31 Aug 2026, PROGRESS deviation 3):** our *own* inbound request URL is reduced to origin + path; it names our host and a slug, which is safe. **Every other URL is dropped outright, breadcrumbs included.** A breadcrumb URL is an *outgoing* fetch — i.e. a destination — and origin + path would still name the destination host (`https://clinic.example.com/…`), which D23 forbids. Reducing is demonstrably insufficient there; dropping is the rule.
- Free-tier note: log lines are ephemeral (`wrangler tail`); durable forensics = Sentry + D1 state (§15).

## 10. Module layout (proposed — keep boundaries, adjust names if needed)

```
apps/api/src/
  index.ts            entry: Sentry wrap, hostname routing, env bindings
  routes/             HTTP shape only: links.ts, batch.ts, stats.ts, tags.ts, health.ts, redirect.ts
  services/           business rules, storage injected: slugs.ts, links.ts, idempotency.ts, counting.ts
  db/                 D1 access only: queries.ts, types.ts
  kv/                 redirects-cache.ts (write-through helpers implementing §3 above)
  middleware/         auth.ts, request-id.ts, errors.ts
  telemetry/          logger.ts, sentry.ts (beforeSend scrubber)
  reserved-slugs.ts   versioned reserved-word list (D16)
  bot-denylist.ts     versioned UA denylist (D21)
scripts/
  mint-key.ts, revoke-key.ts, smoke.ts        (D14, §14 — local/CI tooling, not Worker code)
```

Boundary rules: routes never touch D1/KV directly; services never import Hono; db/kv modules contain no business logic. Each unit answers: what does it do, how do you use it, what does it depend on.

## 11. Performance budgets (PRD §11)

Redirect KV-hit path: 1 KV read + O(1) CPU — p50 < 50 ms, p99 < 150 ms edge-measured. API: 1 auth SELECT + operation — p50 < 150 ms, p99 < 500 ms. Batch: sequential items (D1 `batch()` is atomic, incompatible with per-item results, §7.2) — own budget ≤ 2 s at 100 items, excluded from the standard API NFR.
