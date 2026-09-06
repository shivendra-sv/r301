# @r301/www

The marketing page served at `www.r301.dev` — hand-written HTML/CSS in `public/`, no build step, no dependencies, no JavaScript. Archivo is loaded from Google Fonts; that is the page's only third-party request.

Preview: `python3 -m http.server 8080 --directory apps/www/public` and visit <http://localhost:8080> (a server is needed for the root-absolute `/styles.css` and icon paths).

Test: `pnpm --filter @r301/www test` runs `test/site.test.mjs` on Node's built-in runner — still no dependencies. It pins what ships in `public/` (an explicit allowlist), the head tags, every local asset path, the manifest, the zero-radius rule, the colour tokens' contrast in both schemes, the reduced-motion gate, the claims guard against unsupported marketing claims, the request/response samples' contract shape, and that `--red` (3.76:1) sets text only on the headline, where WCAG's 3:1 large-text threshold applies. The root `pnpm test` runs it alongside the API suite.

Brand: `brand/` holds the logo kit's sources (`svg/`, `png/`, and the kit's own `README.md`) and is never uploaded. What the page serves lives in `public/`: the icons, `site.webmanifest`, `og-image.png`, and the four lockup PNGs.

The masthead uses the kit's own lockup artwork rather than type dressed up to imitate it, and it is a **PNG**, not the SVG, deliberately. Six of the kit's nine SVGs (every lockup and avatar) contain live `<text>` referencing Archivo by name, and an SVG loaded through `<img>` cannot reach the page's Google Fonts — it would render in a fallback face. The kit's own README says as much. `r301-lockup-light-*.png` is transparent with ink text; `r301-lockup-dark-*.png` carries a baked `#201e1d` ground that matches `--ground` in the dark scheme exactly, so it seats without a seam. A `<picture>` swaps them on `prefers-color-scheme`; note that a theme flip *while the page is open* may not re-select the source until the next load, which is a known engine quirk rather than a page bug.

The hero's two rules are the one place the lockup is still drawn in CSS — permitted, and they now stop at the gutter rather than bleeding to the viewport edge.

Deploys: Cloudflare Pages direct upload, manually via Actions → *Deploy www* → Run workflow (`.github/workflows/deploy-www.yml`). **Only `public/` is uploaded, and all of it ships publicly** — keep everything else (this file, `package.json`, `brand/`, `test/`) outside that directory.
