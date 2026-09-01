# r301.dev — Runbook (manual steps, Shivendra only)

One-time setup only you can do: accounts, DNS, resource creation, secrets, dashboard config. Checkbox format; each item says **when** it's needed and **where its output goes**. Commands use `pnpm dlx wrangler@latest` so nothing depends on repo deps being installed yet. Derives from PRD §13–§15, D14, D24, D25.

## Phase A — before implementation prompt 01

### A1 · Tooling
- [x] Node ≥ 20 (`node -v`) and pnpm via corepack:
```bash
corepack enable
```
- [x] Authenticate wrangler with the Cloudflare account (browser flow):
```bash
pnpm dlx wrangler@latest login
```

### A2 · Cloudflare zone + DNS (PRD §8 hostnames)
- [x] Add `r301.dev` as a zone in the Cloudflare account (Dashboard → Add site → Free plan). If the domain is registered elsewhere, point its nameservers at the ones Cloudflare assigns; wait for "Active".
- [x] Create 4 **proxied** placeholder DNS records so Workers routes can attach (Dashboard → DNS → Records) — type `AAAA`, content `100::`, proxy status **Proxied**, for names: `@`, `api`, `staging`, `api-staging`.
  - Done 31 Aug 2026 for `api`, `staging`, `api-staging`. **`@` was never created as a placeholder** — the apex already had a proxied CNAME from the Cloudflare Pages static site, which is enough for a Workers route to attach. That site moved to `www.r301.dev` the same day (ADR **D29**), so the apex is now the shortener's, per PRD §8.
  - **Until the Worker owns production, `https://r301.dev/` returns `522`** — the record is still proxied but has no origin behind it. Harmless pre-launch and it disappears on the first `v*` deploy. If you want it gone sooner, any interim redirect must match the **exact path `/`, never `/*`** — zone-level redirect features run in front of Workers, so a wildcard rule would swallow every short link once the Worker is live. Remove it when prompt 12 ships the `/` redirect.

### A3 · D1 databases (×2) → paste IDs into `apps/api/wrangler.toml`
```bash
cd apps/api
pnpm dlx wrangler@latest d1 create r301-staging
pnpm dlx wrangler@latest d1 create r301-production
```
- [x] Paste each printed `database_id` into the matching `<paste: runbook A3>` slot (staging / production env blocks).

### A4 · KV namespaces (×2) → paste IDs into `apps/api/wrangler.toml`
```bash
cd apps/api
pnpm dlx wrangler@latest kv namespace create REDIRECTS --env staging
pnpm dlx wrangler@latest kv namespace create REDIRECTS --env production
```
- [x] Paste each printed `id` into the matching `<paste: runbook A4>` slot.

### A5 · Sentry (PRD §13, §15)
- [x] Create a Sentry project (platform: Cloudflare Workers), name `r301-api`. Copy the DSN.
- [x] Set it as the only Worker secret (D14 — there is no ADMIN_TOKEN), once per env. Wrangler may offer to create a draft Worker — accept:
```bash
cd apps/api
pnpm dlx wrangler@latest secret put SENTRY_DSN --env staging
pnpm dlx wrangler@latest secret put SENTRY_DSN --env production
```
  - Verified 1 Sep 2026: `wrangler secret list --env staging` and `--env production` both report `SENTRY_DSN`. Re-check with those two commands — they print names only, never values.

### A6 · GitHub repo + Actions secrets (PRD §14)
- [x] Create the repo and push `main`:
```bash
gh repo create r301 --private --source . --push
```
- [x] Create a **least-privilege** Cloudflare API token (Dashboard → My Profile → API Tokens → Create): start from "Edit Cloudflare Workers", ensure it includes **Account · Workers Scripts: Edit**, **Account · D1: Edit**, **Account · Workers KV Storage: Edit**, **Zone · Workers Routes: Edit** scoped to `r301.dev`.
- [x] Grab the Account ID (Dashboard → Workers & Pages → right sidebar).
- [x] Add both as Actions secrets:
```bash
gh secret set CLOUDFLARE_API_TOKEN
gh secret set CLOUDFLARE_ACCOUNT_ID
```
  - Verified 1 Sep 2026 via `gh secret list`: both present since 31 Aug. Repo is `shivendra-sv/r301` (private, default branch `main`).

### A7 · Zone rate-limiting rule (D24 — day one)
- [ ] Dashboard → `r301.dev` → Security → WAF → Rate limiting rules → Create (free plan includes 1 rule):
  match **hostname equals `r301.dev`**, characteristic **IP**, threshold **~100 requests / 10 s**, action **Block** for the shortest available duration. (Threshold is deliberately far above carrier-NAT click bursts; tune on staging if it ever trips a real pattern.)

### A8 · Notifications + verification (D25, §15)
- [ ] Dashboard → Notifications: enable Workers free-tier usage alerts (and, if/when on Workers Paid, a billing threshold alert at **$8**).
- [ ] Verify the actual D1 Time Travel window on the free tier and record the answer in PROGRESS.md notes (PRD §11 assumes it may be 7 d, not 30).
  **`time-travel info` with no arguments cannot answer this** — it prints the *current* bookmark, not the retention window (checked 1 Sep 2026; `d1 info` does not report it either). Probe the window instead, which is read-only — `info` retrieves a bookmark, only `restore` would change anything:
```bash
cd apps/api
# Ask for a bookmark ~8 days back. A bookmark returned ⇒ the window reaches at
# least that far. An error (`code: 7500`) ⇒ it does not.
pnpm dlx wrangler@latest d1 time-travel info r301-production --timestamp=$(date -u -v-8d +%Y-%m-%dT%H:%M:%SZ)
```
  - ⚠️ **Only meaningful once the database is older than the window you are probing.** Both databases were created 31 Aug 2026, so an 8-day probe returns the same error for "outside the window" and "before the database existed". Re-run this **on or after ~8 Sep 2026** and record the answer then.

## Phase B — after CI first deploys staging (≈ end of M0)

Both checks must assert something **only our Worker can produce**. Before the first deploy, `api-staging.r301.dev` returns `522` (proxied DNS, no origin) — but the redirect host does **not** fail as obviously, which is the trap below.

- [ ] API host is live and is the *staging* build:
```bash
curl -s https://api-staging.r301.dev/v1/health | jq -e '.status == "ok" and .env == "staging"'
```
- [ ] Redirect host is served by our Worker:
```bash
# X-Request-Id is stamped on every response by our request-id middleware.
curl -sS -D - -o /dev/null https://staging.r301.dev/robots.txt | grep -i '^x-request-id:'
# And our robots.txt disallows crawling; Cloudflare's does not.
curl -sS https://staging.r301.dev/robots.txt | grep -q 'Disallow: /' && echo "worker robots.txt OK"
```
  - ⚠️ **Do not use a bare `curl -I …/robots.txt` as the check.** Verified 1 Sep 2026 with nothing deployed: it returns **200** — Cloudflare serves its own content-signals `robots.txt` at the zone edge, so the original check passed while the Worker did not exist. The two assertions above are what distinguish them.

## Phase C — after the mint-key script exists (prompt-numbered in PROGRESS.md)

**Prerequisite, and the reason this phase can look broken:** `mint-key --env staging|production` writes an `api_keys` row to the **remote** D1, so the schema has to be there first. Migrations are normally applied by the deploy workflow — which means the naive order (push → deploy → mint) deadlocks: the deploy's smoke step needs a key that cannot be minted until the deploy has run. Break it by applying migrations by hand once, before minting:

```bash
cd apps/api
pnpm --filter @r301/api exec wrangler d1 migrations apply DB --env staging --remote
pnpm --filter @r301/api exec wrangler d1 migrations apply DB --env production --remote
```
- [x] Done 1 Sep 2026 — both remote databases now hold the full `0001_init` schema (`links`, `tags`, `link_tags`, `api_keys`, `idempotency_keys`). Re-running is safe: migrations are forward-only and the tracker table skips what is applied.

- [ ] Mint CI smoke keys (one per env) and store them for Actions:
```bash
cd apps/api
pnpm mint-key --env staging --name ci-smoke
pnpm mint-key --env production --name ci-smoke
gh secret set SMOKE_API_KEY_STAGING
gh secret set SMOKE_API_KEY_PRODUCTION
```
- [ ] Mint the Curastax pilot key (production) and hand it over out-of-band — it is shown exactly once:
```bash
pnpm mint-key --env production --name curastax-pilot
```

## Phase D — before the pilot goes live (M2 gate, §15, D21, D25)

- [ ] Create the **canary link** in production (destination `https://example.com`, untagged — it is the uptime probe *and* the drift ruler; never delete it):
```bash
curl -s -X POST https://api.r301.dev/v1/links \
  -H "Authorization: Bearer <a production key>" -H "Content-Type: application/json" \
  -d '{"destination":"https://example.com"}'
```
- [ ] UptimeRobot (free): monitor 1 — HTTP(s) on `https://r301.dev/<canary-slug>`, 60 s interval (it follows the redirect; "up" = 200 at example.com — accepted dependency).
- [ ] UptimeRobot: monitor 2 — keyword monitor on `https://api.r301.dev/v1/health`, keyword `ok`, 60 s interval.
- [ ] Point alerts at email (+ Telegram integration if wanted).
- [ ] Optional: GitHub branch protection on `main` (require CI green before merge).
