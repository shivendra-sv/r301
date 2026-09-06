// Static checks for the www.r301.dev page. Node's built-in runner — the site has
// no dependencies and this keeps it that way. Everything in public/ ships
// publicly via Pages direct upload, so the allowlist below is the guard rail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const www = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(www, 'public');
const brand = join(www, 'brand');
const html = readFileSync(join(pub, 'index.html'), 'utf8');
const css = readFileSync(join(pub, 'styles.css'), 'utf8');

const SHIPPED = [
  'index.html',
  'styles.css',
  'favicon.ico',
  'favicon.svg',
  'apple-touch-icon.png',
  'safari-pinned-tab.svg',
  'site.webmanifest',
  'android-chrome-192x192.png',
  'android-chrome-512x512.png',
  'maskable-512x512.png',
  'og-image.png',
];

const FONT_ORIGINS = new Set(['https://fonts.googleapis.com', 'https://fonts.gstatic.com']);
const FETCHED_RELS = new Set([
  'stylesheet', 'preconnect', 'dns-prefetch', 'preload', 'modulepreload',
  'icon', 'apple-touch-icon', 'mask-icon', 'manifest',
]);

const SCALAR = 'https://registry.scalar.com/@r301/apis/r301dev-api';
const MAILTO =
  'mailto:mail@r301.dev?subject=r301.dev%20API%20key%20request&amp;body=Name%3A%0ACompany%3A%0AWhat%20you%27re%20building%3A%0AExpected%20volume%20%28links%20per%20month%29%3A%0A';

// Terms the page must never contain. Each maps to a decision saying r301 lacks it.
const FORBIDDEN = [
  ['webhook', 'P2 — PRD §85, §377'],
  ['custom domain', 'D1 — all links live on r301.dev/* in v1'],
  ['no signup required', 'D14 — keys are minted by local script; no signup exists'],
  ['free forever', 'no pricing is decided'],
  ['unlimited', 'no pricing is decided'],
  ['99.9', 'PRD §261 — a probe-measured target, not a credit-backed SLA'],
  ['analytics', 'D2 — click counts only; "detailed analytics" is a dropped claim'],
  ['never recycled', 'PRD §96 — the P1 purge cron frees the slug after 30 days'],
  ['vanity domain', 'D1 drift — "custom domain" alone does not catch it'],
  ['your own domain', 'D1 drift — "custom domain" alone does not catch it'],
  ['guaranteed uptime', 'PRD §261 — a probe-measured target, no credit-backed SLA'],
];

// docs/api-contract.md — "The Link resource" and "POST /v1/links".
const LINK_FIELDS = [
  'slug', 'short_url', 'destination', 'redirect_type', 'is_active',
  'expires_at', 'tags', 'external_id', 'created_at', 'updated_at',
];
const CREATE_FIELDS = ['destination', 'slug', 'redirect_type', 'expires_at', 'tags', 'external_id'];

const TITLE = 'r301.dev — an API-first URL shortener at the edge';
const DESCRIPTION =
  "r301.dev creates and serves short links from Cloudflare's edge. One REST API, no dashboard to click through. Currently in private beta.";

function tags(name) {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'g'))].map((m) => attrs(m[0]));
}
function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}
function meta(key) {
  return tags('meta').filter((t) => t.name === key || t.property === key).map((t) => t.content);
}

// Every URL the browser (not a scraper) would fetch while rendering the page.
function fetchedUrls() {
  const urls = [];
  for (const t of tags('link')) {
    const rels = (t.rel ?? '').split(/\s+/);
    if (rels.some((r) => FETCHED_RELS.has(r)) && t.href) urls.push(t.href);
  }
  for (const name of ['script', 'img', 'source', 'iframe', 'video', 'audio', 'object', 'embed']) {
    for (const t of tags(name)) {
      if (t.src) urls.push(t.src);
      if (t.srcset) for (const c of t.srcset.split(',')) urls.push(c.trim().split(/\s+/)[0]);
    }
  }
  for (const m of css.matchAll(/url\(\s*["']?([^"')]+?)["']?\s*\)/g)) urls.push(m[1]);
  for (const m of css.matchAll(/@import\s+(?:url\()?["']?([^"')\s;]+)/g)) urls.push(m[1]);
  return urls;
}

function isLocalPath(url) {
  return !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url);
}
function localFile(url) {
  return join(pub, url.replace(/[?#].*$/, '').replace(/^\//, ''));
}

function relLum(hex) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
export function contrast(a, b) {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Returns the body of the first top-level CSS block whose selector/at-rule
// matches `opener` — naive brace matching, enough for hand-written CSS.
function block(source, opener) {
  const start = source.indexOf(opener);
  if (start === -1) return null;
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}
function tokens(source) {
  const out = {};
  for (const m of source.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]] = m[2].toLowerCase();
  return out;
}

// --- what ships -------------------------------------------------------------

test('public/ contains exactly the shipping assets and no subdirectories', () => {
  const files = readdirSync(pub).sort();
  for (const f of files) assert.ok(statSync(join(pub, f)).isFile(), `${f} is not a file`);
  assert.deepEqual(files, [...SHIPPED].sort());
});

test('the kit sources live in brand/, one level above the upload', () => {
  assert.ok(existsSync(join(brand, 'README.md')), 'brand/README.md');
  assert.equal(readdirSync(join(brand, 'svg')).filter((f) => f.endsWith('.svg')).length, 9);
  assert.equal(readdirSync(join(brand, 'png')).filter((f) => f.endsWith('.png')).length, 24);
  assert.ok(!existsSync(join(www, '..', '..', 'logo')), 'logo/ must be gone from the repo root');
});

test('every local URL the page references resolves to a file in public/', () => {
  const local = [...fetchedUrls(), ...meta('og:image'), ...meta('twitter:image')]
    .filter(isLocalPath)
    .filter((u) => !u.startsWith('data:'));
  assert.ok(local.length > 0, 'expected at least one local asset reference');
  for (const url of local) assert.ok(existsSync(localFile(url)), `${url} does not exist in public/`);
});

test('site.webmanifest parses and its three icons resolve', () => {
  const manifest = JSON.parse(readFileSync(join(pub, 'site.webmanifest'), 'utf8'));
  assert.equal(manifest.icons.length, 3);
  for (const icon of manifest.icons) assert.ok(existsSync(localFile(icon.src)), `${icon.src} missing`);
});

// --- head -----------------------------------------------------------------------

test('the only third-party requests are Google Fonts', () => {
  const external = fetchedUrls().filter((u) => !isLocalPath(u));
  for (const url of external) {
    assert.ok(FONT_ORIGINS.has(new URL(url).origin), `${url} leaves the origin`);
  }
});

test('the page ships no JavaScript', () => {
  assert.equal(tags('script').length, 0);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'inline event handler');
});

test('title and description are unchanged', () => {
  assert.match(html, new RegExp(`<title>${TITLE}</title>`));
  assert.deepEqual(meta('description'), [DESCRIPTION]);
  assert.deepEqual(meta('og:title'), [TITLE]);
  assert.deepEqual(meta('twitter:title'), [TITLE]);
});

test('og:image is absolute, sized, and mirrored to twitter with a large card', () => {
  assert.deepEqual(meta('og:image'), ['https://www.r301.dev/og-image.png']);
  assert.deepEqual(meta('og:image:width'), ['1200']);
  assert.deepEqual(meta('og:image:height'), ['630']);
  assert.deepEqual(meta('twitter:image'), ['https://www.r301.dev/og-image.png']);
  assert.deepEqual(meta('twitter:card'), ['summary_large_image']);
});

test('the kit head tags are present', () => {
  const links = tags('link');
  const byRel = (rel) => links.filter((l) => (l.rel ?? '').split(/\s+/).includes(rel));
  const icons = byRel('icon');
  assert.ok(icons.some((l) => l.href === '/favicon.ico' && l.sizes === '48x48'), 'favicon.ico 48x48');
  assert.ok(icons.some((l) => l.href === '/favicon.svg' && l.type === 'image/svg+xml'), 'favicon.svg');
  assert.ok(byRel('apple-touch-icon').some((l) => l.href === '/apple-touch-icon.png'));
  assert.ok(byRel('mask-icon').some((l) => l.href === '/safari-pinned-tab.svg' && l.color === '#201e1d'));
  assert.ok(byRel('manifest').some((l) => l.href === '/site.webmanifest'));
  const themes = tags('meta').filter((t) => t.name === 'theme-color');
  assert.ok(themes.length >= 1, 'theme-color');
  for (const t of themes) assert.match(t.content, /^#[0-9a-f]{6}$/i);
});

// --- document ------------------------------------------------------------------

test('one h1, one main, semantic landmarks', () => {
  assert.equal(tags('h1').length, 1);
  assert.equal(tags('main').length, 1);
  assert.equal(tags('header').length, 1);
  assert.equal(tags('footer').length, 1);
  assert.match(html, /<html lang="en">/);
});

test('both CTAs survive: external docs link opens safely, key request is the mailto template', () => {
  const anchors = tags('a');
  const docs = anchors.filter((a) => a.href === SCALAR);
  assert.ok(docs.length >= 1, 'docs CTA');
  for (const a of docs) {
    assert.equal(a.target, '_blank');
    assert.equal(a.rel, 'noopener noreferrer');
  }
  assert.ok(anchors.some((a) => a.href === MAILTO), 'mailto CTA with prefilled subject and body');
});

// --- brand rules ---------------------------------------------------------------

test('zero border-radius anywhere', () => {
  for (const m of css.matchAll(/border(?:-[a-z]+)*-radius\s*:\s*([^;]+);/g)) {
    assert.equal(m[1].trim(), '0', `border-radius ${m[1].trim()}`);
  }
});

test('both colour schemes set the brief’s ground and ink explicitly', () => {
  const light = tokens(block(css, ':root') ?? '');
  const dark = tokens(block(css, '@media (prefers-color-scheme: dark)') ?? '');
  assert.equal(light.ground, '#f3f2f2');
  assert.equal(light.ink, '#201e1d');
  assert.equal(dark.ground, '#201e1d');
  assert.equal(dark.ink, '#f3f2f2');
  assert.match(block(css, 'body'), /background-color:\s*var\(--ground\)/);
  assert.match(block(css, 'body'), /color:\s*var\(--ink\)/);
});

test('text/ground token pairs meet WCAG AA in both schemes', () => {
  const light = tokens(block(css, ':root') ?? '');
  const dark = tokens(block(css, '@media (prefers-color-scheme: dark)') ?? '');
  for (const [name, t] of [['light', light], ['dark', dark]]) {
    assert.ok(contrast(t.ink, t.ground) >= 4.5, `${name} ink/ground`);
    assert.ok(contrast(t.muted, t.ground) >= 4.5, `${name} muted/ground`);
    // Red is large-text and non-text only (3:1); the page never sets small copy in it.
    assert.ok(contrast(t.red, t.ground) >= 3, `${name} red/ground`);
  }
});

test('--red never sets text color', () => {
  assert.doesNotMatch(css, /(^|[^-\w])color\s*:\s*var\(--red\)/, '--red is 3.76:1 on ground — rules and dashes only, never text');
});

test('animation only runs when motion is not reduced', () => {
  const declarations = [...css.matchAll(/^\s*animation(?:-[a-z]+)?\s*:/gm)].length;
  if (declarations === 0) return;
  const gated = block(css, '@media (prefers-reduced-motion: no-preference)');
  assert.ok(gated, 'no prefers-reduced-motion: no-preference block');
  const inside = [...gated.matchAll(/^\s*animation(?:-[a-z]+)?\s*:/gm)].length;
  assert.equal(inside, declarations, 'an animation declaration sits outside the reduced-motion gate');
});

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
  assert.match(text, /API-first URL shortener · Private beta/);
  assert.match(text, /Keys are issued by hand during the private pilot\./);
  assert.match(html, /class="rule rule-long"/);
  assert.match(html, /class="rule rule-short"/);
});

test('the page is a document, not a locked viewport', () => {
  assert.doesNotMatch(html, /class="frame"/, 'the single-frame wrapper is gone');
  assert.doesNotMatch(css, /\.frame\s*\{/, 'and so are its styles');
});

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
  assert.ok(Date.parse(req.expires_at) > Date.now(), 'the sample expires_at must stay in the future — the contract rejects a past one');
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

// --- features & strip -------------------------------------------------------------

test('three numbered features tell the API-first / edge / safe story', () => {
  const items = [...html.matchAll(/<li class="feature">([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  assert.equal(items.length, 3);
  const text = items.join(' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(text, /01[\s\S]*API-first/);
  assert.match(text, /02[\s\S]*Served at the edge/);
  assert.match(text, /03[\s\S]*Safe by default/);
  assert.match(text, /tombstone/, 'D15 is the point of feature 03');
});

test('the strip lists four shipped capabilities', () => {
  const items = [...html.matchAll(/<li class="strip-item">([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  assert.equal(items.length, 4);
  // &amp; decoded — the markup correctly encodes the literal ampersand (as the
  // hero's "API playground &amp; docs" already does); match on the same text.
  const text = items.join(' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  for (const title of ['Batch & tags', 'Idempotent creates', 'Click counts', 'OpenAPI']) {
    assert.ok(text.includes(title), `missing "${title}"`);
  }
});

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
