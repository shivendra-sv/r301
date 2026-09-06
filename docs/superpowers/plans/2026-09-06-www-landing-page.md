# www.r301.dev Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-frame `www.r301.dev` page with a five-band scrolling landing page — masthead, hero, code panel + numbered features, capability strip, dark footer — carrying only claims the shipped v1 API can back.

**Architecture:** Two hand-written files, `apps/www/public/index.html` and `apps/www/public/styles.css`. No build step, no dependencies, no JavaScript. Bands are body-level blocks each padded by `var(--gutter)`, so the footer's background bleeds full-width for free and the hero's ink rule keeps its `calc(100% + var(--gutter))` bleed. Static checks in `apps/www/test/site.test.mjs` (Node's built-in runner) are the test layer: they parse the HTML and CSS as text and assert structure, copy, contract shape, and contrast.

**Tech Stack:** HTML5, CSS custom properties, Archivo (Google Fonts, already loaded), a system monospace stack, `node:test` + `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-09-06-www-landing-page-design.md`

## Global Constraints

Every task's requirements implicitly include all of these. They are enforced by tests that already pass — breaking one turns an existing test red.

- **No JavaScript.** No `<script>` tags, no `on*=` attributes. (`the page ships no JavaScript`)
- **No new files in `public/`.** Everything there ships publicly; the allowlist test pins the exact file list. (`public/ contains exactly the shipping assets`)
- **No new third-party origins.** `https://fonts.googleapis.com` and `https://fonts.gstatic.com` only. Code sets in a system monospace stack, never a webfont. (`the only third-party requests are Google Fonts`)
- **No dependencies.** `apps/www/package.json` has none and gains none.
- **Zero border-radius.** Any `border-radius` declaration must read exactly `0`. Simplest path: never write one. (`zero border-radius anywhere`)
- **Exactly one `<h1>`, one `<main>`, one `<header>`, one `<footer>`.** Do **not** nest a `<header>` inside the code panel or anywhere else — the test counts `<header>` tags document-wide. Use `<div class="panel-head">`. (`one h1, one main, semantic landmarks`)
- **Every anchor whose href is the Scalar URL** needs `target="_blank"` and exactly `rel="noopener noreferrer"`. The test loops over *all* of them, so masthead, hero and footer links are each bound. (`both CTAs survive`)
- **The prefilled `mailto:` must survive byte-identical**, `&amp;` included:
  `mailto:mail@r301.dev?subject=r301.dev%20API%20key%20request&amp;body=Name%3A%0ACompany%3A%0AWhat%20you%27re%20building%3A%0AExpected%20volume%20%28links%20per%20month%29%3A%0A`
- **Title and description do not change.** Title: `r301.dev — an API-first URL shortener at the edge`. (`title and description are unchanged`)
- **Colour tokens are literal 6-digit hex.** `tokens()` parses `--name: #rrggbb` only; a `color-mix()` or `rgb()` value is invisible to every contrast assertion.
- **All token definitions live in the *first* `:root` block and the *first* `@media (prefers-color-scheme: dark)` block.** The `block()` helper returns the first match only.
- **Exactly one `@media (prefers-reduced-motion: no-preference)` block**, and every `animation` declaration in the file lives inside it. A second such block would leave its animations counted as ungated. (`animation only runs when motion is not reduced`)
- **AA contrast**: every text/background pair ≥ 4.5:1 in both schemes. `--red` (#ec3013) is **3.76:1 on the light ground and must never set text** — rules, dashes and focus rings only. Text-coloured red uses `--red-text`.

### Verified palette

Ratios computed with the same `contrast()` the test file uses. Do not substitute values.

| Token | Light | Dark | Checked against |
|---|---|---|---|
| `--ground` | `#f3f2f2` | `#201e1d` | — (unchanged) |
| `--ink` | `#201e1d` | `#f3f2f2` | 14.86:1 on ground (unchanged) |
| `--muted` | `#6b6866` | `#a8a5a3` | 4.95 / 6.78 on ground (unchanged) |
| `--red` | `#ec3013` | `#ec3013` | 3.76 / 3.95 — **non-text only** (unchanged) |
| `--red-text` | `#c9280f` | `#ff7a63` | 4.95 / 6.50 on ground · 5.31 / 5.80 on surface |
| `--surface` | `#fbfafa` | `#2a2725` | panel ground |
| `--hairline` | `#d8d5d3` | `#3a3735` | non-text dividers |
| `--code-ink` | `#201e1d` | `#f3f2f2` | 15.94 / 13.28 on surface |
| `--code-muted` | `#6b6866` | `#a8a5a3` | 5.31 / 6.06 on surface |
| `--footer-ground` | `#201e1d` | `#201e1d` | ink band in both schemes |
| `--footer-ink` | `#f3f2f2` | `#f3f2f2` | 14.86:1 |
| `--footer-muted` | `#a8a5a3` | `#a8a5a3` | 6.78:1 |

Code strings reuse `--red-text`; the panel needs no red of its own.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `apps/www/public/index.html` | The whole page. Head is untouched; `<body>` is rebuilt band by band. | Modify |
| `apps/www/public/styles.css` | Tokens, base, and one section per band. | Modify |
| `apps/www/test/site.test.mjs` | Static guards. Existing 15 tests stay; 6 are added. | Modify |
| `PROGRESS.md` | Session tracker; records the design-direction reversal. | Modify |

No files are created or deleted. `public/`'s listing must be byte-identical when the work is done.

### Shared constants for the test file

Tasks 1–5 all add tests to `apps/www/test/site.test.mjs`. Add these near the existing constants (after the `MAILTO` declaration) once, in Task 1; later tasks reference them without redeclaring:

```js
// Terms the page must never contain. Each maps to a decision saying r301 lacks it.
const FORBIDDEN = [
  ['webhook', 'P2 — PRD §85, §377'],
  ['custom domain', 'D1 — all links live on r301.dev/* in v1'],
  ['no signup required', 'D14 — keys are minted by local script; no signup exists'],
  ['free forever', 'no pricing is decided'],
  ['unlimited', 'no pricing is decided'],
  ['99.9', 'PRD §261 — a probe-measured target, not a credit-backed SLA'],
];

// docs/api-contract.md — "The Link resource" and "POST /v1/links".
const LINK_FIELDS = [
  'slug', 'short_url', 'destination', 'redirect_type', 'is_active',
  'expires_at', 'tags', 'external_id', 'created_at', 'updated_at',
];
const CREATE_FIELDS = ['destination', 'slug', 'redirect_type', 'expires_at', 'tags', 'external_id'];
```

---

### Task 1: Claims guard

The guard that stops the mockup's unsupported copy from ever landing. Test-only — no page change. Written first so every later task lands under it.

**Files:**
- Modify: `apps/www/test/site.test.mjs` (add constants + two tests)

**Interfaces:**
- Consumes: the existing `html` string and `meta(key)` helper already at the top of the file.
- Produces: `FORBIDDEN`, `LINK_FIELDS`, `CREATE_FIELDS` constants and a `forbiddenClaims(text)` helper, used by Tasks 3–5.

- [ ] **Step 1: Write the failing test**

Add the constants from *Shared constants* above, then this helper and these two tests at the end of `apps/www/test/site.test.mjs`:

```js
// --- claims -------------------------------------------------------------------

// Everything a reader can actually see: body text with tags stripped, plus the
// title and the three description metas (whose text lives inside the tag).
function claimText() {
  const body = html.replace(/<[^>]+>/g, ' ');
  const title = html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '';
  return [body, title, ...meta('description'), ...meta('og:description'), ...meta('twitter:description')]
    .join(' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

// Matches on visible text, not raw HTML, and `sla` on a word boundary — a raw
// substring guard would fire the day the copy says "translate" or "Slack".
export function forbiddenClaims(text) {
  const lower = text.toLowerCase();
  const hits = FORBIDDEN.filter(([term]) => lower.includes(term)).map(([term, why]) => `${term} (${why})`);
  if (/\bsla\b/.test(lower)) hits.push('sla (PRD §261 — a target measured by probes, not a credit-backed SLA)');
  return hits;
}

test('the claims guard catches the terms it is meant to catch', () => {
  assert.deepEqual(forbiddenClaims('nothing to see here'), []);
  assert.equal(forbiddenClaims('We support webhooks.').length, 1);
  assert.equal(forbiddenClaims('Bring your own custom domain').length, 1);
  assert.equal(forbiddenClaims('No signup required for your first links.').length, 1);
  assert.equal(forbiddenClaims('99.9% uptime SLA').length, 2);
  assert.deepEqual(forbiddenClaims('The translation slashed latency.'), []); // not "sla"
});

test('the page claims nothing the product cannot back', () => {
  assert.deepEqual(forbiddenClaims(claimText()), []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @r301/www exec node --test --test-name-pattern='claims guard' test/site.test.mjs
```

Expected: FAIL — `ReferenceError: FORBIDDEN is not defined` if the constants were missed, otherwise the test file will not even parse until `forbiddenClaims` exists. Confirm the failure names the missing symbol before continuing.

- [ ] **Step 3: Make it pass**

There is no implementation to write — the helper *is* the implementation, and it was added in Step 1. If Step 2 failed on a missing constant, add the `FORBIDDEN`, `LINK_FIELDS` and `CREATE_FIELDS` block from *Shared constants* now.

- [ ] **Step 4: Run the full suite to verify it passes**

```bash
pnpm --filter @r301/www test
```

Expected: PASS, `# pass 17`, `# fail 0`. (15 existing + 2 new.)

- [ ] **Step 5: Commit**

```bash
git add apps/www/test/site.test.mjs
git commit -m "test(www): guard the page against claims v1 cannot back"
```

---

### Task 2: Masthead and hero

Turns the one-viewport frame into a scrolling document, and rebuilds the top two bands.

**Files:**
- Modify: `apps/www/public/index.html` (replace `<body>`'s `.frame` wrapper, masthead and `<main>`)
- Modify: `apps/www/public/styles.css` (add `--red-text`/`--hairline` tokens; replace the `.frame`, `.masthead` and `main` sections)
- Modify: `apps/www/test/site.test.mjs`

**Interfaces:**
- Consumes: `forbiddenClaims` (Task 1).
- Produces: the `.masthead` / `.hero` markup and the band convention (`padding-inline: var(--gutter)` on body-level blocks) that Tasks 3–5 extend. The `.wordmark` + `.wordmark-rule` mini-lockup is reused by the footer in Task 5.

- [ ] **Step 1: Write the failing test**

Append to `apps/www/test/site.test.mjs`:

```js
// --- masthead & hero ------------------------------------------------------------

test('the masthead is a lockup plus two links, one of them the key request', () => {
  const nav = html.match(/<nav\b[\s\S]*?<\/nav>/)?.[0] ?? '';
  assert.match(nav, /class="nav-link"/, 'Documentation link');
  assert.match(nav, /class="nav-cta"/, 'Request a key button');
  assert.match(nav, new RegExp(`href="${SCALAR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`), 'docs link');
  assert.ok(nav.includes(MAILTO), 'the key request uses the prefilled mailto');
  assert.match(html, /class="wordmark-rule"/, 'the kit’s red rule under the wordmark');
});

test('the hero keeps its headline and gains an honest eyebrow and key note', () => {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(html, /<h1 class="headline">Short links,<br>minus the dashboard\.<\/h1>/);
  assert.match(text, /API-first URL shortener . Private beta/);
  assert.match(text, /Keys are issued by hand during the private pilot\./);
  assert.match(html, /class="rule rule-long"/);
  assert.match(html, /class="rule rule-short"/);
});

test('the page is a document, not a locked viewport', () => {
  assert.doesNotMatch(html, /class="frame"/, 'the single-frame wrapper is gone');
  assert.doesNotMatch(css, /\.frame\s*\{/, 'and so are its styles');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @r301/www exec node --test --test-name-pattern='masthead|hero|document, not a locked' test/site.test.mjs
```

Expected: FAIL — three failures: no `<nav>`, no `class="eyebrow"` text, and `class="frame"` still present.

- [ ] **Step 3: Write the markup**

In `apps/www/public/index.html`, replace everything between `<body>` and `</body>` — the entire `<div class="frame">…</div>` — with this. Keep the `<head>` exactly as it is.

```html
<a class="skip" href="#main">Skip to content</a>

<header class="masthead">
  <p class="wordmark">
    <span class="wordmark-name">r301</span><span class="wordmark-tld">.dev</span>
    <span class="wordmark-rule" aria-hidden="true"></span>
  </p>
  <nav class="nav" aria-label="Primary">
    <a class="nav-link"
       href="https://registry.scalar.com/@r301/apis/r301dev-api"
       target="_blank" rel="noopener noreferrer">Documentation<span class="sr-only"> (opens in a new tab)</span></a>
    <a class="nav-cta"
       href="mailto:mail@r301.dev?subject=r301.dev%20API%20key%20request&amp;body=Name%3A%0ACompany%3A%0AWhat%20you%27re%20building%3A%0AExpected%20volume%20%28links%20per%20month%29%3A%0A">Request a key</a>
  </nav>
</header>

<main id="main">

  <section class="hero">
    <p class="eyebrow">API-first URL shortener <span aria-hidden="true">·</span> Private beta</p>

    <h1 class="headline">Short links,<br>minus the dashboard.</h1>

    <div class="rules" aria-hidden="true">
      <span class="rule rule-long"></span>
      <span class="rule rule-short"></span>
    </div>

    <div class="below">
      <p class="lede">
        r301.dev is a URL shortener that's only an API. Your code creates and
        retires the links. Cloudflare's edge serves every redirect.
      </p>

      <div class="actions">
        <a class="cta cta-primary"
           href="https://registry.scalar.com/@r301/apis/r301dev-api"
           target="_blank" rel="noopener noreferrer">
          API playground &amp; docs
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M3.5 12.5 12.5 3.5M5 3.5h7.5V11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter"/>
          </svg>
          <span class="sr-only">(opens in a new tab)</span>
        </a>
        <a class="cta cta-secondary"
           href="mailto:mail@r301.dev?subject=r301.dev%20API%20key%20request&amp;body=Name%3A%0ACompany%3A%0AWhat%20you%27re%20building%3A%0AExpected%20volume%20%28links%20per%20month%29%3A%0A">
          Request an API key
        </a>
        <p class="actions-note">Keys are issued by hand during the private pilot.</p>
      </div>
    </div>
  </section>

</main>

<footer class="colophon">
  <p>© 2026 r301.dev</p>
  <p class="colophon-links">
    <a href="https://registry.scalar.com/@r301/apis/r301dev-api"
       target="_blank" rel="noopener noreferrer">API documentation<span class="sr-only"> (opens in a new tab)</span></a>
    <a href="mailto:mail@r301.dev">mail@r301.dev</a>
  </p>
</footer>
```

The footer is left as-is for now; Task 5 rebuilds it. Leaving it keeps the `one h1, one main, semantic landmarks` test green throughout.

- [ ] **Step 4: Write the styles**

In `apps/www/public/styles.css`, add two tokens to the **first** `:root` block, after `--red`:

```css
  --red-text: #c9280f; /* 4.95:1 on ground, 5.31:1 on surface — red that may set text */
  --hairline: #d8d5d3; /* band dividers; non-text */
```

and their dark counterparts to the **first** `@media (prefers-color-scheme: dark)` block, after `--red`:

```css
    --red-text: #ff7a63; /* 6.50:1 on ground, 5.80:1 on surface */
    --hairline: #3a3735;
```

Then replace the whole `/* ---------- frame ... */` section and the `/* ---------- masthead ---------- */` and `/* ---------- main ---------- */` sections with:

```css
/* ---------- bands ---------- */

.masthead,
main,
.colophon { padding-inline: var(--gutter); }

/* ---------- masthead ---------- */

.masthead {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 1rem 2rem;
  padding-block: 1.5rem;
  border-bottom: 1px solid var(--hairline);
}

.wordmark {
  position: relative;
  font-size: 1.375rem;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.04em;
  /* the kit asks for clear space ≥ 2× the red rule: 8 + 6 = 14px */
  padding-bottom: calc(var(--rule-gap) + var(--rule-short));
}

.wordmark-tld {
  font-weight: 400;
  color: var(--muted);
}

.wordmark-rule {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 2.25rem;
  height: var(--rule-short);
  background: var(--red);
}

.nav {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1.75rem;
}

.nav-link {
  font-size: 0.9375rem;
  text-decoration: none;
  padding-bottom: 0.125rem;
  border-bottom: 2px solid transparent;
}

.nav-link:hover { border-bottom-color: var(--red); }

.nav-cta {
  padding: 0.75rem 1.125rem;
  background: var(--ink);
  color: var(--ground);
  font-size: 0.9375rem;
  font-weight: 800;
  line-height: 1;
  text-decoration: none;
  box-shadow: inset 0 0 0 var(--red);
}

.nav-cta:hover { box-shadow: inset 0 calc(-1 * var(--rule-short)) 0 var(--red); }

/* ---------- hero ---------- */

.hero { padding-block: clamp(2.5rem, 7vh, 5.5rem) clamp(2.5rem, 6vh, 4.5rem); }

.eyebrow {
  font-size: 0.8125rem;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--red-text);
  margin-bottom: clamp(1rem, 2.5vh, 1.75rem);
}

.headline {
  font-size: clamp(2.75rem, 7.6vw + 0.5rem, 8.5rem);
  font-weight: 800;
  line-height: 0.92;
  letter-spacing: -0.04em;
}

.actions-note {
  flex-basis: 100%;
  font-size: 0.875rem;
  color: var(--muted);
}
```

`.rules`, `.rule`, `.rule-long`, `.rule-short`, `.below`, `.lede`, `.actions`, the `.cta*` rules and the `@media (max-width: 52rem)` block are unchanged — leave them exactly where they are.

One edit to the **existing** `@media (prefers-reduced-motion: no-preference)` block at the foot of
the file, so the new nav gets the same gated hover transition. Extend its selector list — do
**not** add a second reduced-motion block, which would leave the rule animation counted as
ungated and turn `animation only runs when motion is not reduced` red:

```css
  .cta-primary,
  .cta-secondary,
  .nav-link,
  .nav-cta,
  .colophon a {
    transition: box-shadow 120ms ease-out, border-color 120ms ease-out, color 120ms ease-out;
  }
```

`.rule-short` keeps the animation, and it is the hero's class alone — the masthead and footer
lockups use `.wordmark-rule`, so nothing animates twice.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @r301/www test
```

Expected: PASS, `# pass 20`, `# fail 0`.

- [ ] **Step 6: Look at it**

```bash
python3 -m http.server 8080 --directory apps/www/public
```

Open `http://localhost:8080`. Confirm: the masthead sits on a hairline, the red rule sits under the wordmark, the hero's ink rule still runs off the right edge, and the page now scrolls instead of locking to one screen.

- [ ] **Step 7: Commit**

```bash
git add apps/www/public/index.html apps/www/public/styles.css apps/www/test/site.test.mjs
git commit -m "feat(www): scrolling document, rebuilt masthead and hero"
```

---

### Task 3: Code panel

The band that replaces the mockup's live "Shorten URL" input. Its test pins the sample to `docs/api-contract.md` so it cannot rot.

**Files:**
- Modify: `apps/www/public/index.html` (add `<section class="detail">` after `</section>` of `.hero`, inside `<main>`)
- Modify: `apps/www/public/styles.css` (add `--surface`, `--code-*`, `--mono`; add the panel section)
- Modify: `apps/www/test/site.test.mjs`

**Interfaces:**
- Consumes: `LINK_FIELDS`, `CREATE_FIELDS` (Task 1); the band convention (Task 2).
- Produces: `<section class="detail">`, a two-column grid whose second child is the `<ol class="features">` added in Task 4. Produces `sample(name)` in the test file.

- [ ] **Step 1: Write the failing test**

Append to `apps/www/test/site.test.mjs`:

```js
// --- code panel ------------------------------------------------------------------

// Strips the highlighting spans out of a <pre data-sample="…"> and parses it.
// &amp; is decoded last so an encoded entity is not double-decoded.
function sample(name) {
  const m = html.match(new RegExp(`<pre[^>]*data-sample="${name}"[^>]*>([\\s\\S]*?)</pre>`));
  assert.ok(m, `no <pre data-sample="${name}">`);
  const json = m[1]
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
  return JSON.parse(json);
}

test('the request sample parses and uses only real create fields', () => {
  const req = sample('request');
  for (const key of Object.keys(req)) {
    assert.ok(CREATE_FIELDS.includes(key), `"${key}" is not a POST /v1/links field`);
  }
  assert.ok('destination' in req, 'destination is required');
  assert.match(req.destination, /^https:\/\//, 'destination must be http(s)');
  assert.match(req.slug, /^[a-zA-Z0-9_-]{3,64}$/, 'slug must satisfy the contract pattern');
  assert.ok(req.tags.length <= 10, 'at most 10 tags');
});

test('the response sample is exactly the Link resource, and echoes the request', () => {
  const res = sample('response');
  const req = sample('request');
  assert.deepEqual(Object.keys(res).sort(), [...LINK_FIELDS].sort());
  assert.equal(res.slug, req.slug);
  assert.equal(res.destination, req.destination);
  assert.equal(res.short_url, `https://r301.dev/${res.slug}`);
  assert.equal(res.redirect_type, 302, 'the contract default (D5)');
});

test('code sets in a system mono stack, never a webfont', () => {
  const root = block(css, ':root') ?? '';
  assert.match(root, /--mono:\s*ui-monospace/, 'a --mono token built on ui-monospace');
});

test('code-panel text meets AA on the panel surface in both schemes', () => {
  const light = tokens(block(css, ':root') ?? '');
  const dark = tokens(block(css, '@media (prefers-color-scheme: dark)') ?? '');
  for (const [name, t] of [['light', light], ['dark', dark]]) {
    assert.ok(contrast(t['code-ink'], t.surface) >= 4.5, `${name} code-ink/surface`);
    assert.ok(contrast(t['code-muted'], t.surface) >= 4.5, `${name} code-muted/surface`);
    assert.ok(contrast(t['red-text'], t.surface) >= 4.5, `${name} red-text/surface`);
    assert.ok(contrast(t['red-text'], t.ground) >= 4.5, `${name} red-text/ground`);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @r301/www exec node --test --test-name-pattern='sample|mono stack|code-panel text' test/site.test.mjs
```

Expected: FAIL — `no <pre data-sample="request">`, no `--mono` token, and `contrast` receiving `undefined` for the missing `code-ink`/`surface` tokens.

- [ ] **Step 3: Write the markup**

In `index.html`, immediately after the hero's closing `</section>` and still inside `<main>`, add:

```html
  <section class="detail">

    <div class="panel">
      <div class="panel-head">
        <h2 class="panel-title">Create a short link</h2>
        <p class="panel-endpoint"><span class="method">POST</span> <span class="path">/v1/links</span></p>
      </div>

      <p class="sample-label">Request</p>
      <p class="sample-auth"><span class="tok-key">Authorization</span><span class="tok-punc">:</span> Bearer r301_live_…</p>
<pre class="code" data-sample="request"><span class="tok-punc">{</span>
  <span class="tok-key">"destination"</span><span class="tok-punc">:</span> <span class="tok-str">"https://clinic.example.com/appt/9182"</span><span class="tok-punc">,</span>
  <span class="tok-key">"slug"</span><span class="tok-punc">:</span> <span class="tok-str">"visit-9182"</span><span class="tok-punc">,</span>
  <span class="tok-key">"expires_at"</span><span class="tok-punc">:</span> <span class="tok-str">"2026-09-30T12:00:00Z"</span><span class="tok-punc">,</span>
  <span class="tok-key">"tags"</span><span class="tok-punc">:</span> <span class="tok-punc">[</span><span class="tok-str">"tenant:42"</span><span class="tok-punc">,</span> <span class="tok-str">"kind:appointment"</span><span class="tok-punc">]</span>
<span class="tok-punc">}</span></pre>

      <p class="sample-label">Response <span class="sample-status">201</span></p>
<pre class="code" data-sample="response"><span class="tok-punc">{</span>
  <span class="tok-key">"slug"</span><span class="tok-punc">:</span> <span class="tok-str">"visit-9182"</span><span class="tok-punc">,</span>
  <span class="tok-key">"short_url"</span><span class="tok-punc">:</span> <span class="tok-str">"https://r301.dev/visit-9182"</span><span class="tok-punc">,</span>
  <span class="tok-key">"destination"</span><span class="tok-punc">:</span> <span class="tok-str">"https://clinic.example.com/appt/9182"</span><span class="tok-punc">,</span>
  <span class="tok-key">"redirect_type"</span><span class="tok-punc">:</span> <span class="tok-num">302</span><span class="tok-punc">,</span>
  <span class="tok-key">"is_active"</span><span class="tok-punc">:</span> <span class="tok-num">true</span><span class="tok-punc">,</span>
  <span class="tok-key">"expires_at"</span><span class="tok-punc">:</span> <span class="tok-str">"2026-09-30T12:00:00Z"</span><span class="tok-punc">,</span>
  <span class="tok-key">"tags"</span><span class="tok-punc">:</span> <span class="tok-punc">[</span><span class="tok-str">"tenant:42"</span><span class="tok-punc">,</span> <span class="tok-str">"kind:appointment"</span><span class="tok-punc">]</span><span class="tok-punc">,</span>
  <span class="tok-key">"external_id"</span><span class="tok-punc">:</span> <span class="tok-num">null</span><span class="tok-punc">,</span>
  <span class="tok-key">"created_at"</span><span class="tok-punc">:</span> <span class="tok-str">"2026-09-06T10:00:00Z"</span><span class="tok-punc">,</span>
  <span class="tok-key">"updated_at"</span><span class="tok-punc">:</span> <span class="tok-str">"2026-09-06T10:00:00Z"</span>
<span class="tok-punc">}</span></pre>
    </div>

  </section>
```

The `<pre>` tags start at column 0 deliberately — `white-space: pre` means any indentation before them becomes visible leading whitespace inside the block.

- [ ] **Step 4: Write the styles**

Add to the **first** `:root` block:

```css
  --surface:    #fbfafa;
  --code-ink:   #201e1d;
  --code-muted: #6b6866;

  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
```

and to the **first** `@media (prefers-color-scheme: dark)` block:

```css
    --surface:    #2a2725;
    --code-ink:   #f3f2f2;
    --code-muted: #a8a5a3;
```

Then append a new section to `styles.css`, before the `/* ---------- colophon ---------- */` section:

```css
/* ---------- detail: panel + features ---------- */

.detail {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  column-gap: clamp(2rem, 6vw, 5rem);
  row-gap: 3rem;
  align-items: start;
  padding-block: clamp(2.5rem, 6vh, 4.5rem);
  border-top: 1px solid var(--hairline);
}

.panel {
  background: var(--surface);
  border: 1px solid var(--hairline);
  padding: clamp(1.25rem, 3vw, 2rem);
}

.panel-head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.5rem 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--hairline);
}

.panel-title {
  font-size: 1.0625rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  margin: 0;
}

.panel-endpoint {
  font-family: var(--mono);
  font-size: 0.8125rem;
  color: var(--code-muted);
}

.method {
  color: var(--red-text);
  font-weight: 700;
}

.sample-label {
  margin-top: 1.5rem;
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--code-muted);
}

.sample-status {
  font-family: var(--mono);
  font-weight: 400;
  letter-spacing: 0;
  color: var(--red-text);
}

.sample-auth,
.code {
  font-family: var(--mono);
  font-size: 0.8125rem;
  line-height: 1.7;
  color: var(--code-ink);
}

.sample-auth {
  margin-top: 0.5rem;
  color: var(--code-muted);
}

.code {
  margin: 0.5rem 0 0;
  overflow-x: auto;
  white-space: pre;
}

.tok-key  { color: var(--code-ink); }
.tok-str  { color: var(--red-text); }
.tok-num  { color: var(--code-muted); }
.tok-punc { color: var(--code-muted); }

@media (max-width: 62rem) {
  .detail { grid-template-columns: minmax(0, 1fr); }
}
```

One base rule also changes. In the `/* ---------- base ---------- */` section, replace:

```css
p, h1 { margin: 0; }
```

with:

```css
p, h1, h2, h3, ol, ul, pre { margin: 0; }
```

The lists get their own `list-style: none; padding: 0;` in Task 4, where they are created.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @r301/www test
```

Expected: PASS, `# pass 24`, `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add apps/www/public/index.html apps/www/public/styles.css apps/www/test/site.test.mjs
git commit -m "feat(www): code panel, pinned to the api-contract link resource"
```

---

### Task 4: Numbered features and capability strip

**Files:**
- Modify: `apps/www/public/index.html` (add `<ol class="features">` inside `.detail`; add `<section class="strip">`)
- Modify: `apps/www/public/styles.css`
- Modify: `apps/www/test/site.test.mjs`

**Interfaces:**
- Consumes: `.detail`'s two-column grid (Task 3); `forbiddenClaims` (Task 1).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test**

Append to `apps/www/test/site.test.mjs`:

```js
// --- features & strip -------------------------------------------------------------

test('three numbered features tell the API-first / edge / safe story', () => {
  const items = [...html.matchAll(/<li class="feature">([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  assert.equal(items.length, 3);
  const text = items.join(' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(text, /01[\s\S]*API-first/);
  assert.match(text, /02[\s\S]*Served at the edge/);
  assert.match(text, /03[\s\S]*Safe by default/);
  assert.match(text, /tombstoned/, 'D15 is the point of feature 03');
});

test('the strip lists four shipped capabilities', () => {
  const items = [...html.matchAll(/<li class="strip-item">([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  assert.equal(items.length, 4);
  const text = items.join(' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  for (const title of ['Batch & tags', 'Idempotent creates', 'Click counts', 'OpenAPI']) {
    assert.ok(text.includes(title), `missing "${title}"`);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @r301/www exec node --test --test-name-pattern='numbered features|strip lists' test/site.test.mjs
```

Expected: FAIL — `Expected values to be strictly equal: 0 !== 3` and `0 !== 4`.

- [ ] **Step 3: Write the markup**

Inside `<section class="detail">`, after the closing `</div>` of `.panel`, add:

```html
    <ol class="features">
      <li class="feature">
        <p class="feature-num" aria-hidden="true">01</p>
        <h2 class="feature-title">API-first</h2>
        <p class="feature-body">
          No dashboard, no console to click through. Your code creates the links
          and retires them; <code>POST</code>, <code>PATCH</code> and
          <code>DELETE</code> are the whole product surface.
        </p>
      </li>
      <li class="feature">
        <p class="feature-num" aria-hidden="true">02</p>
        <h2 class="feature-title">Served at the edge</h2>
        <p class="feature-body">
          Every redirect is answered by a Cloudflare Worker at the point of
          presence nearest the click, reading a KV-cached copy of the link.
        </p>
      </li>
      <li class="feature">
        <p class="feature-num" aria-hidden="true">03</p>
        <h2 class="feature-title">Safe by default</h2>
        <p class="feature-body">
          Deleted slugs are tombstoned, never recycled — nobody inherits a link
          you retired. Reserved words are blocked. Unknown fields are rejected,
          not quietly ignored.
        </p>
      </li>
    </ol>
```

Then, after the closing `</section>` of `.detail` and still inside `<main>`, add:

```html
  <section class="strip">
    <h2 class="sr-only">Capabilities</h2>
    <ul class="strip-list">
      <li class="strip-item">
        <span class="strip-dash" aria-hidden="true"></span>
        <h3 class="strip-title">Batch &amp; tags</h3>
        <p class="strip-body">Up to 100 links in one call, with per-item results.</p>
      </li>
      <li class="strip-item">
        <span class="strip-dash" aria-hidden="true"></span>
        <h3 class="strip-title">Idempotent creates</h3>
        <p class="strip-body">Retry a job without minting duplicates.</p>
      </li>
      <li class="strip-item">
        <span class="strip-dash" aria-hidden="true"></span>
        <h3 class="strip-title">Click counts</h3>
        <p class="strip-body">Per link and per tag. Counts, not surveillance.</p>
      </li>
      <li class="strip-item">
        <span class="strip-dash" aria-hidden="true"></span>
        <h3 class="strip-title">OpenAPI</h3>
        <p class="strip-body">A typed contract and a live playground.</p>
      </li>
    </ul>
  </section>
```

- [ ] **Step 4: Write the styles**

Append to the `/* ---------- detail ---------- */` section, before its `@media` block:

```css
.features {
  list-style: none;
  padding: 0;
  display: grid;
  gap: clamp(1.75rem, 4vh, 2.5rem);
}

.feature { border-top: 1px solid var(--hairline); padding-top: 1rem; }
.feature:first-child { border-top: 0; padding-top: 0; }

.feature-num {
  font-family: var(--mono);
  font-size: 0.75rem;
  color: var(--muted);
  margin-bottom: 0.5rem;
}

.feature-title {
  font-size: 1.125rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  margin-bottom: 0.375rem;
}

.feature-body {
  font-size: 0.9375rem;
  line-height: 1.55;
  color: var(--muted);
  text-wrap: pretty;
}

.feature-body code {
  font-family: var(--mono);
  font-size: 0.875em;
  color: var(--ink);
}
```

Then add a new section after it:

```css
/* ---------- capability strip ---------- */

.strip {
  padding-block: clamp(2rem, 5vh, 3.5rem);
  border-top: 1px solid var(--hairline);
}

.strip-list {
  list-style: none;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 2rem clamp(1.5rem, 4vw, 3rem);
}

.strip-dash {
  display: block;
  width: 1.75rem;
  height: var(--rule-long);
  background: var(--red);
  margin-bottom: 0.875rem;
}

.strip-title {
  font-size: 1rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  margin-bottom: 0.25rem;
}

.strip-body {
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--muted);
  text-wrap: pretty;
}

@media (max-width: 62rem) {
  .strip-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 34rem) {
  .strip-list { grid-template-columns: minmax(0, 1fr); }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @r301/www test
```

Expected: PASS, `# pass 26`, `# fail 0`. The claims guard from Task 1 now runs over all the new copy — if it trips, the copy is wrong, not the test.

- [ ] **Step 6: Commit**

```bash
git add apps/www/public/index.html apps/www/public/styles.css apps/www/test/site.test.mjs
git commit -m "feat(www): numbered features and the shipped-capability strip"
```

---

### Task 5: Footer band

**Files:**
- Modify: `apps/www/public/index.html` (replace the placeholder `<footer class="colophon">` left in Task 2)
- Modify: `apps/www/public/styles.css` (add `--footer-*`; replace the colophon section)
- Modify: `apps/www/test/site.test.mjs`

**Interfaces:**
- Consumes: the `.wordmark` / `.wordmark-rule` lockup (Task 2).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test**

Append to `apps/www/test/site.test.mjs`:

```js
// --- footer -----------------------------------------------------------------------

test('the footer is an ink band carrying the lockup, in text, not an image', () => {
  const footer = html.match(/<footer[\s\S]*?<\/footer>/)?.[0] ?? '';
  assert.match(footer, /class="wordmark wordmark-reversed"/, 'the reversed lockup');
  assert.match(footer, /class="wordmark-rule"/, 'and its red rule');
  assert.doesNotMatch(footer, /<img\b/, 'brand/ is never uploaded — the lockup must be text');
  assert.match(footer.replace(/<[^>]+>/g, ' '), /An API-first URL shortener, served from the edge\./);
  assert.match(css, /\.colophon\s*\{[^}]*background:\s*var\(--footer-ground\)/);
});

test('footer text meets AA on the band in both schemes', () => {
  const light = tokens(block(css, ':root') ?? '');
  const dark = tokens(block(css, '@media (prefers-color-scheme: dark)') ?? '');
  for (const [name, t] of [['light', light], ['dark', dark]]) {
    assert.ok(contrast(t['footer-ink'], t['footer-ground']) >= 4.5, `${name} footer-ink/footer-ground`);
    assert.ok(contrast(t['footer-muted'], t['footer-ground']) >= 4.5, `${name} footer-muted/footer-ground`);
    assert.ok(contrast(t.red, t['footer-ground']) >= 3, `${name} red rule on the band`);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @r301/www exec node --test --test-name-pattern='footer' test/site.test.mjs
```

Expected: FAIL — no `wordmark-reversed` in the footer, and `contrast` receiving `undefined` for the missing `footer-*` tokens.

- [ ] **Step 3: Write the markup**

Replace the whole `<footer class="colophon">…</footer>` from Task 2 with:

```html
<footer class="colophon">
  <div class="colophon-brand">
    <p class="wordmark wordmark-reversed">
      <span class="wordmark-name">r301</span><span class="wordmark-tld">.dev</span>
      <span class="wordmark-rule" aria-hidden="true"></span>
    </p>
    <p class="colophon-tag">An API-first URL shortener, served from the edge.</p>
  </div>
  <p class="colophon-links">
    <a href="https://registry.scalar.com/@r301/apis/r301dev-api"
       target="_blank" rel="noopener noreferrer">Documentation<span class="sr-only"> (opens in a new tab)</span></a>
    <a href="mailto:mail@r301.dev">mail@r301.dev</a>
  </p>
  <p class="colophon-copy">© 2026 r301.dev</p>
</footer>
```

- [ ] **Step 4: Write the styles**

Add to the **first** `:root` block:

```css
  --footer-ground: #201e1d;
  --footer-ink:    #f3f2f2;
  --footer-muted:  #a8a5a3;
```

The dark block needs the same three values — the band stays ink in both schemes, and a top rule marks its edge once the page ground is ink too. Add to the **first** `@media (prefers-color-scheme: dark)` block:

```css
    --footer-ground: #201e1d;
    --footer-ink:    #f3f2f2;
    --footer-muted:  #a8a5a3;
```

Replace the whole `/* ---------- colophon ---------- */` section with:

```css
/* ---------- colophon: an ink band in both schemes ---------- */

.colophon {
  background: var(--footer-ground);
  color: var(--footer-muted);
  /* in dark mode the band and the page ground match, so the rule marks the edge */
  border-top: var(--rule-long) solid var(--ink);
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-end;
  gap: 1.5rem clamp(1.5rem, 5vw, 4rem);
  padding-block: clamp(2rem, 5vh, 3rem);
  font-size: 0.8125rem;
}

.wordmark-reversed { color: var(--footer-ink); }
.wordmark-reversed .wordmark-tld { color: var(--footer-muted); }

.colophon-tag {
  margin-top: 0.875rem;
  max-width: 22rem;
  text-wrap: pretty;
}

.colophon-links {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1.5rem;
}

.colophon a {
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 0.2em;
}

.colophon a:hover { color: var(--footer-ink); }
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @r301/www test
```

Expected: PASS, `# pass 28`, `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add apps/www/public/index.html apps/www/public/styles.css apps/www/test/site.test.mjs
git commit -m "feat(www): ink footer band with the reversed lockup"
```

---

### Task 6: Verify, record, finish

No new features. This is the CLAUDE.md before-stopping protocol.

**Files:**
- Modify: `PROGRESS.md`

**Interfaces:**
- Consumes: everything.
- Produces: the session record.

- [ ] **Step 1: Confirm `public/` did not grow**

```bash
git status --porcelain apps/www/public/
```

Expected: exactly two modified files, `index.html` and `styles.css`. Any `??` line is a new file that would ship publicly — remove it.

- [ ] **Step 2: Run the whole workspace green**

```bash
pnpm test && pnpm typecheck
```

Expected: the www suite at `# pass 28 / # fail 0`, the API suite unchanged, and `tsc --noEmit` silent.

- [ ] **Step 3: Look at every breakpoint, in both schemes**

```bash
python3 -m http.server 8080 --directory apps/www/public
```

At `http://localhost:8080`, check widths **375**, **768** and **1440**, each in light and dark (macOS: System Settings → Appearance, or DevTools → Rendering → *Emulate prefers-color-scheme*). Confirm on each:

1. No horizontal scrollbar on `<body>` — the hero's ink rule bleeds without widening the page.
2. `.detail` is two columns at 1440 and one at 375/768.
3. `.strip-list` is 4 / 2 / 1 columns at 1440 / 768 / 375.
4. The code panel scrolls **inside itself** on narrow widths; it never stretches the page.
5. The footer band spans edge to edge, and in dark mode its top rule is visible.
6. With reduced motion on, the red rule does not animate.

- [ ] **Step 4: Record the reversal in PROGRESS.md**

Add to the deviation log. It is a **six-column** table — `# | Date | Session/prompt | What
diverged | Why | Approved?` — and PROGRESS.md states new entries start at **deviation 8**:

```markdown
| 8 | 2026-09-06 | www landing page | The `www.r301.dev` page was rebuilt from the single frame shipped the same day (`40b2828`) into a five-band scrolling page: masthead, hero, code panel, numbered features, capability strip, ink footer. The supplied mockup's live "Shorten URL" input, its Pricing/Changelog nav, and its webhooks / custom domains / "detailed analytics" claims were all dropped. | Design direction requested by Shivendra; **not a spec deviation** — D29 fixes only where the site lives and no API surface moved. The input would need an anonymous create endpoint, CORS and rate limiting, all gated at P1/M3 (D14, D22); the dropped claims are P2 or absent (D1, D2). A claims guard in `apps/www/test/site.test.mjs` now fails the build if any of them return. Spec: `docs/superpowers/specs/2026-09-06-www-landing-page-design.md`. | ✅ yes (design approved 6 Sep 2026) |
```

- [ ] **Step 5: Commit**

```bash
git add PROGRESS.md
git commit -m "docs(progress): www landing page rebuilt; single-frame reversal logged"
```

- [ ] **Step 6: Report, do not deploy**

Deployment is a human act (CLAUDE.md; runbook W1). Tell Shivendra the page is ready and that shipping it is Actions → *Deploy www* → Run workflow. Note that Cloudflare cached earlier uploads for 7 days (runbook W2), so after deploying, confirm `https://www.r301.dev/styles.css` is the new file and purge the cache if not.
