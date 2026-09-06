# www.r301.dev — landing page rebuild

**Date:** 6 Sep 2026 · **Status:** approved (brainstorm) · **Scope:** `apps/www` only

## Context

`www.r301.dev` today is a single-frame page (`apps/www/public/index.html`) — masthead, one
headline, the kit's two rules, a lede and two CTAs, sized to one viewport. It was
deliberately tightened to one screen on 2 Sep 2026 (`a3f8ba3`) and rebuilt on the logo kit in
that same shape on 6 Sep 2026 (`40b2828`) — **today**. This spec reverses a same-day decision;
that is Shivendra's call to make, but it should be made with open eyes.

Shivendra supplied a mockup of a fuller scrolling page — nav, hero with a live "Shorten URL"
input, a code panel, three numbered features, a four-column capability strip, a dark footer —
and asked for something similar. The mockup is already on-brand (ground `#f3f2f2`, ink
`#201e1d`, red `#ec3013`, Archivo, zero radius); its **copy**, however, promises things r301
does not have.

This spec keeps the mockup's structure and replaces every unsupported claim.

## Decisions taken during the brainstorm

| # | Fork | Decision |
|---|---|---|
| 1 | The hero's live "Shorten URL" input | **Dropped.** No anonymous create endpoint exists; CORS is off in v1 (D22 — "keys don't belong in browsers"); keys are minted by local script (D14). Making it real means a public unauthenticated endpoint plus rate limiting and Safe Browsing, all gated at P1/M3. The code panel takes that slot instead. |
| 2 | Nav: Documentation / API / Pricing / Changelog | **Trimmed to what exists** — Documentation (Scalar) and a *Request a key* button. No pricing page (private beta), no changelog page. |
| 3 | Feature story | **API-first / Served at the edge / Safe by default.** The strip becomes shipped capabilities; webhooks and custom domains (P2, D1) and "detailed analytics" (D2 — counts only) are out. |

**No PRD deviation.** D29 fixes only *where* the site lives. Nothing here touches the API.

## Out of scope

- Any API change — no anonymous create, no CORS, no rate limiting.
- `/pricing`, `/changelog`, or a self-hosted docs site.
- New brand assets, a second webfont, JavaScript, or a build step.
- Deploying. `www` ships manually (Actions → *Deploy www*) and only when asked.

## Page structure

Five bands, replacing the single-frame layout. Document flow, not a `100vh` grid.

### 1. Masthead

Wordmark as text (`r301` in Archivo 800, `.dev` regular in `--muted`) with the kit's short red
rule beneath it — the masthead becomes a true mini-lockup. Right side: `Documentation` link and
a `Request a key` dark button, where the mockup puts "Get Started".

Clear space around the lockup ≥ 2× red-rule height (12px), per the kit.

### 2. Hero

- **Eyebrow** (red, caps, letter-spaced): `API-first URL shortener · Private beta`
- **h1:** `Short links,` / `minus the dashboard.` — r301's own line, kept over the mockup's
  "Built for developers"; it says the same thing the trimmed nav says.
- **Rules:** the kit's long ink rule (bleeding to the viewport's right edge) and short red rule,
  with the existing one-shot `shorten` animation, still behind the reduced-motion gate.
- **Lede:** "r301.dev is a URL shortener that's only an API. Your code creates and retires the
  links. Cloudflare's edge serves every redirect."
- **Actions:** primary `API playground & docs` → the Scalar registry (external, arrow glyph);
  secondary `Request an API key` → the existing prefilled `mailto:`.
- **Sub-line**, replacing the mockup's "No signup required for your first links":
  "Keys are issued by hand during the private pilot."

### 3. Code panel + numbered features

Two columns (panel ~2/3, features ~1/3), stacking at the existing 52rem breakpoint.

**Panel.** Header `Create a short link` with `POST` (red) and `/v1/links` (mono). Auth line
shown above the request — it is the positioning, in one glance:

```
Authorization: Bearer r301_live_…
```

Request:

```json
{
  "destination": "https://clinic.example.com/appt/9182",
  "slug": "visit-9182",
  "expires_at": "2026-09-30T12:00:00Z",
  "tags": ["tenant:42", "kind:appointment"]
}
```

Response `201` — the full Link resource, field-for-field from `docs/api-contract.md`:

```json
{
  "slug": "visit-9182",
  "short_url": "https://r301.dev/visit-9182",
  "destination": "https://clinic.example.com/appt/9182",
  "redirect_type": 302,
  "is_active": true,
  "expires_at": "2026-09-30T12:00:00Z",
  "tags": ["tenant:42", "kind:appointment"],
  "external_id": null,
  "created_at": "2026-09-06T10:00:00Z",
  "updated_at": "2026-09-06T10:00:00Z"
}
```

Syntax colouring is hand-written `<span>`s — no highlighter, no JavaScript. Code sets in a
**system mono stack** (`ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
"Liberation Mono", monospace`); a second webfont would double the page's third-party requests
for a decorative gain.

**Features** (numbered 01–03, as the mockup):

| # | Heading | Body |
|---|---|---|
| 01 | API-first | No dashboard, no console to click through. Your code creates the links and retires them; `POST`, `PATCH` and `DELETE` are the whole product surface. |
| 02 | Served at the edge | Every redirect is answered by a Cloudflare Worker at the point of presence nearest the click, reading a KV-cached copy of the link. |
| 03 | Safe by default | Deleted slugs are tombstoned, never recycled — nobody inherits a link you retired. Reserved words are blocked. Unknown fields are rejected, not quietly ignored. |

Sources: D14/D22 (01), D20 (02), D15/D16/D22 (03).

### 4. Capability strip

Four columns, red dash above each; 2-up then 1-up as width drops.

| Heading | Body | Endpoint |
|---|---|---|
| Batch & tags | Up to 100 links in one call, with per-item results. | `POST /v1/links/batch`, `GET /v1/tags` |
| Idempotent creates | Retry a job without minting duplicates. | `Idempotency-Key` (D18) |
| Click counts | Per link and per tag. Counts, not surveillance. | `/v1/links/{slug}/stats`, `/v1/stats` |
| OpenAPI | A typed contract and a live playground. | `GET /v1/openapi.json` (D22) |

### 5. Footer

Full-bleed ink band (breaking the gutter, with its own inner padding). Reversed wordmark **as
text** — `brand/` is never uploaded, so using a lockup SVG would mean adding a file to
`public/` and to the ship allowlist. Tagline "An API-first URL shortener, served from the
edge.", links (Documentation, `mail@r301.dev`), `© 2026 r301.dev`.

**Dark mode.** In light mode the band is ink against the off-white page. In dark mode the page
is already ink, so the band keeps its ink ground and a top rule in `--ink` (light in that
scheme) marks the edge instead. New tokens `--footer-ground` / `--footer-ink` /
`--footer-muted`, both schemes contrast-tested.

## Technical constraints (unchanged)

No JavaScript · no build step · no dependencies · only `public/` is uploaded and **all of it
ships publicly** · Google Fonts is the sole third-party origin · zero border-radius · WCAG AA
on every text/ground pair in both schemes · animation only under
`prefers-reduced-motion: no-preference`.

`public/`'s file list does not change. No new assets, so the ship allowlist is untouched.

## Testing

`apps/www/test/site.test.mjs`, Node's built-in runner, no dependencies. Every existing test is
kept: ship allowlist, brand-sources-outside-upload, local assets resolve, manifest, fonts-only
external origins, no JavaScript, title/description/og pins, kit head tags, semantic landmarks,
both CTAs, zero radius, colour tokens, AA contrast, reduced-motion gate.

Title and description are **unchanged**, so those pins do not move.

Three new tests:

1. **Claims guard.** Run against the page's **visible text** (tags stripped), not raw HTML, and
   match `sla` on a word boundary — a raw-substring guard would false-positive the day the copy
   says "translate" or "Slack". The text contains none of these, case-insensitively. Each entry
   maps to a decision that says r301 does not have it:

   | Term | Why |
   |---|---|
   | `webhook` | P2 (PRD §85, §377) |
   | `custom domain` | D1 — all links live on `r301.dev/*` in v1 |
   | `no signup required` | D14 — no signup exists |
   | `free forever`, `unlimited` | no pricing is decided |
   | `sla`, `99.9` | PRD §261 — a target measured by probes, not a credit-backed SLA |

   This is the exact drift the mockup arrived with; this repo pins decisions in tests.

2. **Contract-shape test.** Strip the highlighting spans from the two JSON blocks, decode
   entities, `JSON.parse` both. Request keys must be a subset of the create body's optional +
   required fields; response keys must equal the ten `Link` fields. The sample cannot rot away
   from `docs/api-contract.md` silently.

3. **Footer band contrast.** `--footer-ink` and `--footer-muted` on `--footer-ground` ≥ 4.5:1
   in both schemes.

## Acceptance criteria

- `pnpm --filter @r301/www test` green; root `pnpm test` green; `pnpm typecheck` green.
- The page renders correctly at 375 / 768 / 1440 px, in both colour schemes, verified in a
  browser against `python3 -m http.server 8080 --directory apps/www/public`.
- `readdirSync(public/)` is byte-identical to the pre-change list.
- `PROGRESS.md` updated; commit message cites this spec.

## Notes for the implementer

- This **reverses** the deliberate single-frame decision (`a3f8ba3`, `40b2828`). It is a
  design-direction change, not a spec deviation — log it in `PROGRESS.md`, do not make it
  silently.
- `.frame` currently forces `min-height: 100vh` with a three-row grid. That goes; the footer
  needs full-bleed treatment against the `padding-inline: var(--gutter)` frame.
- `.rule-long` bleeds right with `calc(100% + var(--gutter))` — preserve that trick.
- **Every** anchor to the Scalar registry needs `target="_blank" rel="noopener noreferrer"`.
  The existing `both CTAs survive` test loops over *all* anchors whose href is the Scalar URL,
  so the masthead and footer links are bound by it too, not just the hero CTA.
- New colour tokens must be literal 6-digit hex. `tokens()` in the test file parses
  `--name: #rrggbb` only — a `color-mix()` or `rgb()` value is invisible to it and to the
  contrast assertions.
- Band dividers use a `--hairline` token per scheme (light `#d8d5d3`, dark `#3a3735`). It is
  non-text, so AA does not apply; it is excluded from the contrast test by name.
- Deploy is manual and out of scope here. When it does ship, re-check the live page: Cloudflare
  cached the earlier stray uploads for 7 days (runbook W2), so verify `styles.css` and
  `index.html` are fresh and purge if not.
