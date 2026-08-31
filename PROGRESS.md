# r301.dev — PROGRESS

Cross-session tracker. Every implementation session **reads this first** and updates it before stopping (CLAUDE.md protocol). If you are a fresh session: find "Next session" below, verify the previous row's acceptance commands, then work only that prompt's scope.

**Execution model: SERIAL** (decided 31 Aug 2026). One prompt at a time, in number order, each session verifying its predecessor. No parallel sessions, no worktrees — the verify-chain and this single tracker assume linearity.

## Next session

Paste **`prompts/03-http-foundation.md`** into a fresh session.
Verify first (prompt 02 done-criteria): from repo root `pnpm test` (18 green, workers pool) and `pnpm typecheck`; then `pnpm --filter @r301/api exec wrangler d1 migrations apply DB --local` → `0001_init.sql ✅`.
The full PRD §9 schema now exists as `apps/api/migrations/0001_init.sql` and is applied from zero before **every** test, so route/service work can assume real tables. There is still no query helper or `db` module — that arrives in prompt 06+; tests that need rows insert raw SQL for now (see `test/schema.test.ts` helpers).

## Status

| # | Prompt | Status | Date | Notes |
|---|---|---|---|---|
| — | Master session: Phase 0–1 (PRD red-team → **v1.0 signed off**, D1–D25) | done | 2026-08-31 | All 3 open questions resolved; every Phase 1 recommendation accepted |
| — | Master session: Phase 2 (scaffold + CLAUDE.md + 5 docs + CI) | done | 2026-08-31 | D26 (contract elaborations) + D27 (dependency set) recorded |
| — | Master session: Phase 3 (prompts 01–20 + M3 stubs 21–28) | done | 2026-08-31 | Serial, task-sized, dependency-ordered |
| — | Master session: Phase 4 (this tracker) | done | 2026-08-31 | — |
| 01 | workspace-tooling | done | 2026-08-31 | **Resolved versions:** hono 4.13.5 · zod 4.5.4 · @hono/zod-openapi 1.6.1 · @sentry/cloudflare 10.72.0 · typescript **7.0.2** · wrangler 4.127.1 · @cloudflare/workers-types 5.20260831.1 · vitest 4.1.11 · @cloudflare/vitest-pool-workers 0.22.0 · tsx 4.23.13. 5 tests green in the workers pool. Pool 0.22 requires the **Vitest 4 `cloudflareTest` plugin** API (`defineWorkersConfig` is gone) — storage isolation likewise changed mechanism, see deviation 2. Also: `onlyBuiltDependencies` (workerd, esbuild) added to `pnpm-workspace.yaml` — pnpm 10 blocks their postinstall binaries otherwise; tsconfig `include` widened to `test/**/*.ts` so tests are typechecked too. |
| 02 | d1-schema-migration | done | 2026-08-31 | `migrations/0001_init.sql` is **byte-identical to the PRD §9 SQL block** (diffed, not eyeballed) — 5 tables, 4 named indexes, no additions. 13 new tests in `test/schema.test.ts`; 18 total. Confirmed empirically: **D1 enforces foreign keys locally** (Miniflare needs no `PRAGMA foreign_keys` — the orphan-insert and cascade tests were RED before the `REFERENCES` clauses and GREEN after). Note `link_tags ON DELETE CASCADE` is **dormant in v1**: D15 deletes are tombstones, so nothing hard-deletes a `links` row until the prompt-28 purge cron — the cascade is tested but unexercised by product code. Beyond the prompt's 6 behaviors, `api_keys.prefix UNIQUE` (D11) also got a test. Stale comment in `harness.test.ts` ("prompt 02 adds the first migration") corrected. No deviations. |
| 03 | http-foundation | todo | | |
| 04 | telemetry | todo | | D23 pinned tests land here |
| 05 | health-and-smoke-v1 | todo | | Completes M0; smoke is health-only until prompt 20 |
| 06 | auth-middleware | todo | | |
| 07 | key-scripts | todo | | Unblocks runbook Phase C — flag to Shivendra when done |
| 08 | validation-schemas | todo | | Note reserved-list size in notes |
| 09 | slug-service | todo | | |
| 10 | create-link | todo | | First real endpoint + KV write-through |
| 11 | idempotency | todo | | |
| 12 | redirect-path | todo | | The hot path; counting deferred to 13 |
| 13 | click-counting | todo | | curl's UA is denylisted — test clicks need a browser UA |
| 14 | read-and-list | todo | | |
| 15 | update-link | todo | | |
| 16 | delete-link | todo | | |
| 17 | batch-create | todo | | |
| 18 | stats-and-tags | todo | | |
| 19 | openapi | todo | | After this, code is canonical over docs/api-contract.md |
| 20 | full-smoke-and-m1-sweep | todo | | Completes M1; staging smoke goes RED until runbook C is done — designed signal |
| 21–28 | M3 hardening stubs | stub | | **Do not run.** Detailed after pilot (M2) learnings; sessions pointed here must stop and ask |

Statuses: `todo` · `in-progress` · `done` · `blocked` · `stub`. A session marks its row `in-progress` on start, `done` (with date + notes) before stopping.

## Deviation log

Anything that diverged from PRD/docs/prompt — **with a question for Shivendra; never improvised silently.** New dependencies also need a `docs/decisions.md` ADR row.

| # | Date | Session/prompt | What diverged | Why | Approved? |
|---|---|---|---|---|---|
| 1 | 2026-08-31 | master | Master-session Phase 2 spec listed `ADMIN_TOKEN` under `wrangler secret put`; the scaffold/runbook omit it | PRD D14 (signed off) removed the admin token and `/v1/keys` from v1 | ✅ yes (Phase 2 gate) |
| 2 | 2026-08-31 | prompt 01 | `docs/testing.md` §2 says `vitest.config.ts` configures "isolated storage per test". The declarative `isolatedStorage` pool option **no longer exists** in `@cloudflare/vitest-pool-workers` 0.22.0 (absent from its options schema and from `dist/`). Isolation is instead implemented in `test/setup.ts` as `afterEach(reset())` from `cloudflare:test`. | Upstream API change (Vitest 4 / pool 0.22). Required behaviour is unchanged and is now pinned by a test — it was RED (KV value leaked into the next test) before the setup file and GREEN after. | ✅ yes (2026-08-31) — `docs/testing.md` §2 amended to describe the setup-file mechanism; the deprecated `SELF`/`env` note in the same section was corrected at the same time. |

## Open questions for Shivendra

| # | Raised by | Question | Status |
|---|---|---|---|
| 1 | master | After runbook A8: what is the actual D1 Time Travel window on the free tier? Record it here + amend PRD §11 note if ≠ 7 d assumption. | open |
| 2 | prompt 01 | `@types/node` is **not** in D27, so `vitest.config.ts` avoids `node:*` imports (the migrations dir is a cwd-relative literal). Prompt 07's `scripts/*.ts` (mint-key, smoke) run under `tsx` in Node and will need `process`/`node:crypto` types. Add `@types/node` to the approved set then (new ADR row), or keep `scripts/**` out of `tsc`? | **resolved 2026-08-31 — approved: add `@types/node`** (ADR D28). Install it in prompt 07, not before; `vitest.config.ts` stays `node:*`-free either way. |
| 3 | prompt 01 | `typescript@7.0.2` is what `latest` resolves to today — a major-version jump. Everything typechecks green under the existing strict flags, and the lockfile pins it. Confirm TS 7 is intended for this project, or pin back to 6.x? | **resolved 2026-08-31 — keep TS 7.** Routine version currency within D27; no ADR needed. |
| 4 | prompt 01 session (runbook A2) | **Apex conflict — blocks production deploy, not M0/M1.** `r301.dev` already serves a Cloudflare **Pages** static site via a proxied CNAME (verified live: HTTP 200 `text/html`; all four hostnames resolve to Cloudflare anycast IPs). PRD §8 and `wrangler.toml` put the production redirect route on `r301.dev/*`, and Workers routes **take precedence over a Pages custom domain on the same hostname** — so the first `v*` tag would shadow the static site entirely. Staging (`staging.` / `api-staging.`) is dedicated and unaffected, so prompts 02–20 proceed normally. Options: **(a)** move redirects to a dedicated host (e.g. `go.r301.dev`) — amends PRD §8 + the production route, needs an ADR, and costs the short-link brevity the apex buys; **(b)** move the static site to `www.r301.dev` and give the apex to the shortener — no code change, but the apex `/` then behaves per the PRD's housekeeping route, not as a landing page; **(c)** scope the Worker route to a prefix (e.g. `r301.dev/r/*`) — changes short-link shape. Note a same-zone Worker cannot `fetch()` the Pages custom domain, so "proxy through to Pages" is not a clean fourth option. | **resolved 2026-08-31 — option (b).** Static site moved to `www.r301.dev`; apex keeps its PRD §8 role. Recorded as **ADR D29**, which also changes the `/` housekeeping route to a 302 → `https://www.r301.dev/`. `wrangler.toml` unchanged; **prompt 12 implements the `/` redirect.** |

## Milestone checklist (mirrors PRD §18)

- [ ] **M0 — Foundation** = prompts 01–05 (repo scaffold ✅ done by master session; harness, schema, HTTP foundation, telemetry, health/smoke/CI-SHA remain)
- [ ] **M1 — Core API** = prompts 06–20
- [ ] **M2 — Pilot** — no prompts: Curastax integration (their side), runbook Phases B–D, 4-week soak, §17 exit criteria
- [ ] **M3 — Hardening** = prompts 21–28, detailed after pilot learnings
- [ ] **M4 — Public launch**
- [ ] **M5 — UI** (post-launch)

## Runbook gates (docs/runbook.md — Shivendra's hands only)

| When | Items |
|---|---|
| **Before prompt 01** | A1 only (Node + corepack; `wrangler login` can wait until A3) |
| **Before first push to GitHub / first deploy** | A2 zone + DNS `100::` records (**done**; apex/Pages conflict resolved by D29 — static site now on `www`) · A3 D1 create ×2 + paste IDs · A4 KV create ×2 + paste IDs · A5 Sentry DSN secrets ×2 · A6 repo + `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` · A7 zone rate rule · A8 notifications + Time Travel check. Until A2–A6 are done, pushes to `main` produce **red deploy-staging runs** — harmless but noisy; either front-load Phase A or hold pushes. |
| **After prompt 07** | Phase C: mint `ci-smoke` keys ×2 → `SMOKE_API_KEY_STAGING`/`_PRODUCTION` GH secrets; mint `curastax-pilot` key |
| **Before pilot (M2)** | Phase B checks · Phase D: canary link + UptimeRobot ×2 + alert channel |
