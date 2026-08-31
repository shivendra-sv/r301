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
  - Done 31 Aug 2026 for `api`, `staging`, `api-staging`. **`@` was not created as a placeholder** — the apex already carries a proxied CNAME to a Cloudflare Pages static site (verified: all four names resolve to Cloudflare anycast IPs, so routes can attach to all four). A Workers route on `r301.dev/*` would take precedence over that Pages site and shadow it on the first production deploy — **resolve PROGRESS.md open question 4 before deploying production.** Staging is unaffected.

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
- [ ] Create a Sentry project (platform: Cloudflare Workers), name `r301-api`. Copy the DSN.
- [ ] Set it as the only Worker secret (D14 — there is no ADMIN_TOKEN), once per env. Wrangler may offer to create a draft Worker — accept:
```bash
cd apps/api
pnpm dlx wrangler@latest secret put SENTRY_DSN --env staging
pnpm dlx wrangler@latest secret put SENTRY_DSN --env production
```

### A6 · GitHub repo + Actions secrets (PRD §14)
- [ ] Create the repo and push `main`:
```bash
gh repo create r301 --private --source . --push
```
- [ ] Create a **least-privilege** Cloudflare API token (Dashboard → My Profile → API Tokens → Create): start from "Edit Cloudflare Workers", ensure it includes **Account · Workers Scripts: Edit**, **Account · D1: Edit**, **Account · Workers KV Storage: Edit**, **Zone · Workers Routes: Edit** scoped to `r301.dev`.
- [ ] Grab the Account ID (Dashboard → Workers & Pages → right sidebar).
- [ ] Add both as Actions secrets:
```bash
gh secret set CLOUDFLARE_API_TOKEN
gh secret set CLOUDFLARE_ACCOUNT_ID
```

### A7 · Zone rate-limiting rule (D24 — day one)
- [ ] Dashboard → `r301.dev` → Security → WAF → Rate limiting rules → Create (free plan includes 1 rule):
  match **hostname equals `r301.dev`**, characteristic **IP**, threshold **~100 requests / 10 s**, action **Block** for the shortest available duration. (Threshold is deliberately far above carrier-NAT click bursts; tune on staging if it ever trips a real pattern.)

### A8 · Notifications + verification (D25, §15)
- [ ] Dashboard → Notifications: enable Workers free-tier usage alerts (and, if/when on Workers Paid, a billing threshold alert at **$8**).
- [ ] Verify the actual D1 Time Travel window on the free tier and record the answer in PROGRESS.md notes (PRD §11 assumes it may be 7 d, not 30):
```bash
cd apps/api
pnpm dlx wrangler@latest d1 time-travel info r301-production
```

## Phase B — after CI first deploys staging (≈ end of M0)

- [ ] Confirm staging is live: `curl https://api-staging.r301.dev/v1/health` → `{"status":"ok",…}`.
- [ ] Confirm the redirect host answers: `curl -I https://staging.r301.dev/robots.txt`.

## Phase C — after the mint-key script exists (prompt-numbered in PROGRESS.md)

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
