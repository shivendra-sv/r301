# @r301/www

The marketing page served at `www.r301.dev` — hand-written HTML/CSS in `public/`, no build step, no dependencies, no JavaScript.

Preview: `python3 -m http.server 8080 --directory apps/www/public` and visit <http://localhost:8080> (a server is needed for the root-absolute `/styles.css` and `/favicon.svg` paths).

Deploys: Cloudflare Pages direct upload, manually via Actions → *Deploy www* → Run workflow (`.github/workflows/deploy-www.yml`). **Only `public/` is uploaded, and all of it ships publicly** — keep everything else (this file, `package.json`) outside that directory.
