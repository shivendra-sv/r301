# r301.dev — API Contract

> **Status: commentary as of 1 Sep 2026 (prompt 19).** The condition below is now met — `GET /v1/openapi.json` serves an OpenAPI 3.1 document
> generated from the Zod schemas, so **code is canonical** and this file is background reading. Where the two differ, the document wins and the
> difference is a bug in one of them; `apps/api/test/routes/openapi.test.ts` is what keeps them honest.

Canonical endpoint-by-endpoint spec, derived from PRD §7–§8. This file is the contract **until** the Zod schemas + generated OpenAPI exist in code; after that, code is canonical and this file becomes commentary. Contract elaborations beyond the PRD's literal text are recorded as ADR D26 in `docs/decisions.md`.

## Global conventions (PRD §8)

- **Base URL:** `https://api.r301.dev/v1` (staging: `https://api-staging.r301.dev/v1`). Redirects live on the apex host (§Redirect host below).
- **Auth:** `Authorization: Bearer r301_live_…` on every `/v1/*` route **except** `GET /v1/health` and `GET /v1/openapi.json`.
- **JSON only:** requests with bodies require `Content-Type: application/json` → else 415 (`invalid_request`). All API responses are JSON.
- **Strict requests (D22):** unknown/misspelled body fields → 400 `invalid_request` naming the field. **Tolerant responses:** clients must ignore unknown response fields; additive changes are non-breaking.
- **Timestamps:** ISO 8601 UTC strings in the API (`2026-09-30T12:00:00Z`); inputs accept any valid ISO 8601 offset and are normalized to UTC. (Storage is epoch ms — internal detail.)
- **Request IDs:** every response carries `X-Request-Id`; error bodies echo it as `request_id`.
- **Versioning:** URL path `/v1/`; breaking changes → `/v2/`.
- **Idempotency (D18):** `Idempotency-Key` header (1–255 chars) honored on `POST /v1/links` and `POST /v1/links/batch`. Scope (api_key, key), 24 h window. Retries must be **byte-identical**. Identical replay → original status + body + `Idempotency-Replayed: true`. Same key + different payload, or original still in flight → 409 `idempotency_conflict`.
- **Pagination:** `?cursor=` (opaque base64url keyset — treat as a black box, valid indefinitely) + `?limit=` (1–100, default 25). Responses carry `next_cursor` (`null` when exhausted).
- **CORS:** none in v1 (server-to-server product; keys don't belong in browsers). Revisited at P1.
- **Rate-limit headers:** none in v1; reserved for P1 (`rate_limited` code already reserved).

### Error envelope

```json
{ "error": { "code": "slug_taken", "message": "Slug 'launch' is already in use.", "field": "slug", "request_id": "3f6a…" } }
```

`field` present only when one field is at fault.

| code | HTTP | When |
|---|---|---|
| `invalid_request` | 400 | Malformed JSON, schema violation, unknown field, bad query param, batch > 100 items, `expires_at` in the past. Also the code carried by 415. |
| `unauthorized` | 401 | Missing/malformed/unknown/revoked key. |
| `forbidden` | 403 | Reserved for explicit capability denials — unused in v1 (D22). |
| `not_found` | 404 | Unknown or tombstoned resource. (At P1, cross-user objects also present as 404 — no existence probing.) |
| `method_not_allowed` | 405 | Wrong method on a known route. |
| `slug_taken` | 409 | Custom slug already exists (live **or tombstoned** — D15). |
| `idempotency_conflict` | 409 | Same `Idempotency-Key`, different payload — or original request still in flight (message differentiates). |
| `slug_reserved` | 422 | Custom slug is on the reserved list (checked case-insensitively — D16). |
| `destination_invalid` | 422 | Destination fails §7.1 validation (see Create). |
| `destination_blocked` | 422 | P1 — Safe Browsing hit. Reserved. |
| `rate_limited` | 429 | P1. Reserved. |
| `internal` | 500 | Unexpected. Also returned when the awaited KV write fails (retry with the same `Idempotency-Key` — it converges, D20). |

### The Link resource

```json
{
  "slug": "aB3xY9k",
  "short_url": "https://r301.dev/aB3xY9k",
  "destination": "https://clinic.example.com/appt/9182?t=abc123",
  "redirect_type": 302,
  "is_active": true,
  "expires_at": "2026-09-30T12:00:00Z",
  "tags": ["tenant:42", "kind:appointment"],
  "external_id": "appt_9182",
  "created_at": "2026-08-31T10:00:00Z",
  "updated_at": "2026-08-31T10:00:00Z"
}
```

`expires_at` and `external_id` are `null` when unset. `short_url` uses the environment's redirect host. **Counts are deliberately not part of the Link resource** — they live on the stats endpoints (§7.4 separation; D26).

### Field constraints (PRD §7.1, §7.3, D19)

| Field | Rules |
|---|---|
| `destination` | Required. `http`/`https` only; valid WHATWG URL; ≤ 2048 chars; no `javascript:`/`data:`/`file:`; no private/loopback/link-local IPs or `localhost` (IDN hosts punycode-normalized first); no credentials (`user:pass@`); not on `r301.dev` itself. Violations → `destination_invalid`. |
| `slug` | Optional. `^[a-zA-Z0-9_-]{3,64}$`, case-sensitive. Reserved list → `slug_reserved`; taken (incl. tombstoned) → `slug_taken`. Omitted → 7-char base62 auto-slug. |
| `redirect_type` | Optional, one of `301, 302, 307, 308`. Default `302` (D5). |
| `expires_at` | Optional ISO 8601. Must be strictly in the future at write time (D26) — to kill a link now, use `is_active`. `null` clears (PATCH). |
| `tags` | Optional. ≤ 10 per link; each a trimmed non-empty string ≤ 64 chars. Created implicitly. |
| `external_id` | Optional. ≤ 128 chars, free-form, **non-unique** (D19). `null` clears (PATCH). |

---

## Endpoints

### POST /v1/links — create (P0)

Body: `destination` required; `slug`, `redirect_type`, `expires_at`, `tags`, `external_id` optional.
**201** → Link. Errors: `invalid_request`, `destination_invalid`, `slug_reserved`, `slug_taken`, `idempotency_conflict`.

### POST /v1/links/batch — bulk create (P0, PRD §7.2)

Body: `{ "links": [ <create body>, … ] }`, 1–100 items (>100 → 400 before any work).
**200 always** (D22), per-item results in request order — the batch never all-or-nothing fails:

```json
{
  "items": [
    { "index": 0, "status": "created", "link": { …Link… } },
    { "index": 1, "status": "error", "error": { "code": "slug_taken", "message": "…", "field": "slug" } }
  ],
  "summary": { "created": 1, "failed": 1 }
}
```

Items execute sequentially; batch has its own ≤ 2 s latency budget (§7.2). One `Idempotency-Key` covers the whole batch (replay returns the stored per-item results verbatim).

### GET /v1/links — list (P0)

Query: `tag` (exact match), `active` (`true`/`false`), `created_after` (ISO 8601), `external_id` (exact), `cursor`, `limit`. Filters AND-combine. Tombstoned links never appear.
**200** → `{ "links": [ …Link… ], "next_cursor": "…" | null }`. Ordered by `created_at` descending.

### GET /v1/links/{slug} — fetch one (P0)

**200** → Link. Unknown or tombstoned → 404.

### PATCH /v1/links/{slug} — update (P0)

Body: any non-empty subset of `destination`, `redirect_type`, `expires_at`, `is_active`, `tags`, `external_id` (empty body → 400). `tags` **replaces** the whole set (D26). `slug` is immutable — its presence is an unknown field → 400.
**200** → updated Link. KV convergence ≤ 60 s at distant PoPs (D20) — documented, not an error.

### DELETE /v1/links/{slug} — delete (P0)

Tombstones the link (D15): redirect returns 404, slug stays blocked (recreate → `slug_taken`) until the P1 purge cron (30 d).
**204**, no body. Unknown/already-tombstoned → 404.

### GET /v1/links/{slug}/stats (P0, PRD §7.4)

**200** → `{ "slug": "…", "click_count": 123, "last_clicked_at": "…" | null, "created_at": "…" }`. Counts are at-least-approximate (drift < 0.1%; bot-filtered per D21).

### GET /v1/stats?tag=x (P0)

`tag` required → else 400. **200** → `{ "tag": "tenant:42", "link_count": 17, "click_count": 940 }`. Aggregates live (non-tombstoned) links only.

### GET /v1/tags (P0, PRD §7.3)

**200** → `{ "tags": [ { "name": "kind:appointment", "link_count": 12 }, … ] }`, sorted by name. Counts cover live links only. Unpaginated in v1 (pilot tag cardinality is tiny — D26); revisit if it ever exceeds ~1,000.

### GET /v1/health (P0, D25 — unauthenticated)

**200** → `{ "status": "ok", "version": "<git sha>", "env": "staging" | "production" }`.

### GET /v1/openapi.json (P0, D22 — unauthenticated)

OpenAPI 3.1 generated from the Zod schemas (`@hono/zod-openapi`). Once served, it is canonical over this file.

### P1 stubs (not in v1)

`POST/GET/DELETE /v1/keys` (with signup — D14) · `POST /v1/abuse-reports` (§12).

---

## Redirect host — `GET /{slug}` (P0, PRD §7.5, D17)

| Condition | Response |
|---|---|
| Active link | 301/302/307/308 per `redirect_type` + `Location` (302/307: `Cache-Control: no-store`; 301/308: `public, max-age=3600`) |
| Expired | 410, "link expired" text, `no-store` |
| Unknown / deactivated / tombstoned | 404, minimal text, `no-store` |
| `/` | `302` → `https://www.r301.dev/`, `no-store` (marketing site; never counted — D29) |
| `/robots.txt` | `Disallow: /`, `public, max-age=86400` |
| `/favicon.ico` | 204, `public, max-age=86400` |

Evaluation order: unknown/tombstoned → 404, inactive → 404, expired → 410 (deactivation outranks expiry). Slug match is exact and single-segment. Incoming query strings are dropped. `HEAD` = `GET` uncounted; other methods → 405 plain text. Only successful 30x GETs passing the UA denylist increment counts (D21).
