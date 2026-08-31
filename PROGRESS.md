# r301.dev — PROGRESS

Cross-session tracker. Every implementation session **reads this first** and updates it before stopping (CLAUDE.md protocol). If you are a fresh session: find "Next session" below, verify the previous row's acceptance commands, then work only that prompt's scope.

**Execution model: SERIAL** (decided 31 Aug 2026). One prompt at a time, in number order, each session verifying its predecessor. No parallel sessions, no worktrees — the verify-chain and this single tracker assume linearity.

## Next session

Paste **`prompts/01-workspace-tooling.md`** into a fresh session.
Prerequisite: runbook **A1** (Node ≥ 20 + `corepack enable`). Everything else in runbook Phase A gates *deploys*, not local work — see "Runbook gates" below.

## Status

| # | Prompt | Status | Date | Notes |
|---|---|---|---|---|
| — | Master session: Phase 0–1 (PRD red-team → **v1.0 signed off**, D1–D25) | done | 2026-08-31 | All 3 open questions resolved; every Phase 1 recommendation accepted |
| — | Master session: Phase 2 (scaffold + CLAUDE.md + 5 docs + CI) | done | 2026-08-31 | D26 (contract elaborations) + D27 (dependency set) recorded |
| — | Master session: Phase 3 (prompts 01–20 + M3 stubs 21–28) | done | 2026-08-31 | Serial, task-sized, dependency-ordered |
| — | Master session: Phase 4 (this tracker) | done | 2026-08-31 | — |
| 01 | workspace-tooling | todo | | Record resolved dependency versions here when done |
| 02 | d1-schema-migration | todo | | |
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

## Open questions for Shivendra

| # | Raised by | Question | Status |
|---|---|---|---|
| 1 | master | After runbook A8: what is the actual D1 Time Travel window on the free tier? Record it here + amend PRD §11 note if ≠ 7 d assumption. | open |

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
| **Before first push to GitHub / first deploy** | A2 zone + DNS `100::` records · A3 D1 create ×2 + paste IDs · A4 KV create ×2 + paste IDs · A5 Sentry DSN secrets ×2 · A6 repo + `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` · A7 zone rate rule · A8 notifications + Time Travel check. Until A2–A6 are done, pushes to `main` produce **red deploy-staging runs** — harmless but noisy; either front-load Phase A or hold pushes. |
| **After prompt 07** | Phase C: mint `ci-smoke` keys ×2 → `SMOKE_API_KEY_STAGING`/`_PRODUCTION` GH secrets; mint `curastax-pilot` key |
| **Before pilot (M2)** | Phase B checks · Phase D: canary link + UptimeRobot ×2 + alert channel |
