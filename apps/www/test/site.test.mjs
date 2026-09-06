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

test('animation only runs when motion is not reduced', () => {
  const declarations = [...css.matchAll(/^\s*animation(?:-[a-z]+)?\s*:/gm)].length;
  if (declarations === 0) return;
  const gated = block(css, '@media (prefers-reduced-motion: no-preference)');
  assert.ok(gated, 'no prefers-reduced-motion: no-preference block');
  const inside = [...gated.matchAll(/^\s*animation(?:-[a-z]+)?\s*:/gm)].length;
  assert.equal(inside, declarations, 'an animation declaration sits outside the reduced-motion gate');
});
