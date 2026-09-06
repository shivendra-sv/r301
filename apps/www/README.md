# @r301/www

The marketing page served at `www.r301.dev` — hand-written HTML/CSS in `public/`, no build step, no dependencies, no JavaScript. Archivo is loaded from Google Fonts; that is the page's only third-party request.

Preview: `python3 -m http.server 8080 --directory apps/www/public` and visit <http://localhost:8080> (a server is needed for the root-absolute `/styles.css` and icon paths).

Test: `pnpm --filter @r301/www test` runs `test/site.test.mjs` on Node's built-in runner — still no dependencies. It pins what ships in `public/` (an explicit allowlist), the head tags, every local asset path, the manifest, the zero-radius rule, the colour tokens' contrast in both schemes, the reduced-motion gate, the claims guard against unsupported marketing claims, and the request/response samples' contract shape. The root `pnpm test` runs it alongside the API suite.

Brand: `brand/` holds the logo kit's sources (`svg/`, `png/`, and the kit's own `README.md`). It sits outside `public/`, so it can never be uploaded. The icons, `site.webmanifest`, and `og-image.png` the page actually serves are in `public/`.

Deploys: Cloudflare Pages direct upload, manually via Actions → *Deploy www* → Run workflow (`.github/workflows/deploy-www.yml`). **Only `public/` is uploaded, and all of it ships publicly** — keep everything else (this file, `package.json`, `brand/`, `test/`) outside that directory.
