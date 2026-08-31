# Master Session Prompt — r301.dev build orchestration

> Paste everything below this line as the first message of a fresh Claude Code session started in this repo's root.

---

You are the **master planning session** for building **r301.dev** — an API-first URL shortener on Cloudflare Workers (TypeScript + Hono + KV + D1), fully specified in `r301-dev-prd.md`.

Implementation happens later, in many separate Claude Code sessions that share no conversation memory with you or each other. **The files you produce are the only context those sessions inherit**, so every decision must land in a file. You write scaffolding, config, docs, and prompts — **no feature code**.

## Rules of engagement

- `r301-dev-prd.md` is the source of truth. It is v0.1 with decisions D1–D9 made and status **pending sign-off** — Phase 1 below is that sign-off review.
- Work strictly in phases. **Stop at the end of each phase and wait for my approval** before starting the next.
- If the PRD or this prompt is ambiguous or self-contradictory, ask — never silently pick an interpretation.
- During Phase 1, discuss **one topic per message**, multiple-choice options preferred (use your brainstorming skill's discipline).
- YAGNI: v1 is API-only, click-counts-only, single-owner. Push back on gold-plating, including mine.

## Phase 0 — Ingest

Read `r301-dev-prd.md` end to end. Report any internal contradictions, gaps, or risks the PRD itself misses, and ask any clarifying questions you have. Then propose your Phase 1 topic order and wait for my go.

## Phase 1 — Red-team the PRD, then sign it off

Goal: stress-test every locked policy, amend what fails, mark the PRD signed off.

For each topic, one at a time: steelman the current decision, attack it (edge cases, failure modes, abuse vectors, ops cost), propose alternatives with trade-offs, end with a keep/amend recommendation. I decide; you record.

1. **Auth & key lifecycle** — D4, §7.6: format/hashing, prefix lookup, admin-token bootstrap, revocation latency, test-key semantics (open Q1), rotation story.
2. **Slug policy** — §7.1: alphabet/length/entropy, collision retries, custom-slug rules, case sensitivity, reserved-word list, reuse-after-delete vs 30-day tombstoning (open Q2).
3. **Redirect & caching semantics** — D5, §7.5: 302 default, per-type Cache-Control, interplay with count accuracy, 410/404/deactivated behavior.
4. **Data model** — §9: schema, indexes, `external_id` passthrough (open Q3), idempotency storage — the PRD hedges between KV (§8) and a D1 table (§9); resolve it.
5. **KV/D1 split** — §10: write-through correctness, stale-destination window, invalidation on update/delete.
6. **Click counting** — §7.4: `waitUntil` loss modes, drift measurement, bot filtering.
7. **API contract** — §8: error envelope, pagination, idempotency scope, versioning.
8. **Security & abuse** — §12: what is genuinely pilot-blocking vs safely P1.
9. **Rate limiting deferral** — D6: is "none during pilot" actually safe, even with private keys?
10. **Ops** — §14–15: env split, migration discipline, rollback, observability gaps.

Output: edit `r301-dev-prd.md` in place — amend affected sections, append new Decision Log rows (D10+), resolve §20's open questions, bump to **v1.0, status "Signed off <date>"**.

⏸ **Gate: I approve the amended PRD before Phase 2.**

## Phase 2 — Repo scaffold + documentation set

Initialize git, then create the monorepo skeleton and the docs implementation sessions will live by:

```
.
├── CLAUDE.md                  # auto-loaded by every session (spec below)
├── PROGRESS.md                # cross-session tracker (Phase 4)
├── r301-dev-prd.md            # signed-off PRD — source of truth
├── docs/
│   ├── design.md              # architecture, data flow, KV/D1 contract, redirect path
│   ├── api-contract.md        # endpoint-by-endpoint spec, until Zod/OpenAPI exists in code
│   ├── decisions.md           # ADR log seeded from D1–D9 + Phase 1 amendments
│   ├── testing.md             # TDD protocol, Vitest + Miniflare patterns, what each layer must test
│   └── runbook.md             # one-time manual steps only I can do
├── prompts/                   # implementation session prompts (Phase 3)
├── apps/api/                  # the Worker: package.json, wrangler.toml (staging+production), tsconfig, migrations/ — no feature code
├── pnpm-workspace.yaml        # monorepo-ready; dashboard (M5) and SDKs join later
└── .github/workflows/         # per PRD §14: typecheck+test on PR → staging deploy on main → smoke → tagged prod promote
```

Doc requirements:
- **CLAUDE.md** (≤150 lines): project one-liner, commands, repo map, conventions (TS strict; no new dependency without an ADR), and the **implementation-session protocol**: read PROGRESS.md first → verify the previous session's done-criteria actually hold → work only the current prompt's scope → strict TDD → update PROGRESS.md before stopping → any deviation from spec goes in the deviation log with a question for me, never improvised silently.
- **runbook.md**: everything requiring my hands — Cloudflare account/zone for r301.dev, `wrangler d1 create` × 2 envs, KV namespaces, `wrangler secret put` (ADMIN_TOKEN, SENTRY_DSN), GitHub repo + Actions secrets (CF API token, account ID), Sentry project. Exact commands, checkbox format.
- Docs elaborate the PRD, never contradict it; cite the PRD section each detail derives from.

⏸ **Gate: I review scaffold + docs before Phase 3.**

## Phase 3 — Implementation prompt series

Generate `prompts/NN-<slug>.md` covering **P0 scope (M0 + M1)**, dependency-ordered, **task-sized**: each ~0.5–2 h of agent work (expect ~15–25 prompts). For M3 hardening, create titled stubs only — we detail them after pilot learnings.

Every prompt must be a complete, self-contained session kickoff containing:
1. **Context** — one-paragraph recap + exact files to read first (CLAUDE.md, PROGRESS.md, relevant docs sections).
2. **Objective** and an explicit **out-of-scope** list.
3. **Spec references** — the precise PRD/docs sections governing the task.
4. **TDD mandate** — superpowers TDD skill, red-green-refactor, the specific behaviors that need tests.
5. **Acceptance criteria** — runnable commands with expected results (e.g. `pnpm test`, `wrangler dev` + curl round-trip).
6. **Done ritual** — tests + typecheck green, PROGRESS.md updated, stop. No drive-by refactors, no starting the next prompt.

⏸ **Gate: I review the series before Phase 4.**

## Phase 4 — PROGRESS.md tracker

Create the tracker with: a status table (`# | prompt | status: todo/in-progress/done/blocked | date | notes`) · a "next session: paste prompts/NN-….md" pointer · a **deviation log** (what diverged from spec, why, approved y/n) · an open-questions queue for me · a milestone checklist mirroring PRD §18.

Seed all Phase 3 prompts as `todo`, record this master session's outputs as done, and finish by listing the runbook items I must complete before prompt 01 can run.
