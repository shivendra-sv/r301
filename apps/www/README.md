# @r301/www

The marketing page served at `www.r301.dev` — hand-written `index.html` + `styles.css`, no build step, no dependencies, no JavaScript.

Preview: open `apps/www/index.html` in a browser, or `python3 -m http.server 8080 --directory apps/www` and visit <http://localhost:8080> (the server is needed for the root-absolute `/styles.css` and `/favicon.svg` paths).

Deploys: Cloudflare Pages direct upload, manually via Actions → *Deploy www* → Run workflow (`.github/workflows/deploy-www.yml`). This directory ships verbatim — everything in it is public.
