# r301.dev — CLAUDE.md

API-first URL shortener on Cloudflare Workers (TypeScript + Hono + KV + D1).
Pilot tenant: Curastax (ClinicOS) transactional links. No UI in v1 — the API is the product.

## Source of truth (in order)

1. `r301-dev-prd.md` — **v1.0, signed off 31 Aug 2026**. Decisions D1–D25 are settled; do not re-litigate them.
2. `docs/` — elaborations of the PRD (design, api-contract, decisions, testing, runbook). Each detail cites its PRD section. If a doc ever contradicts the PRD, STOP and log a deviation — do not pick a side silently.
3. This file — conventions and the session protocol.

## Implementation-session protocol (mandatory)

Every implementation session follows this loop:

1. **Read `PROGRESS.md` first.** Find the current prompt, its status, open questions, and prior deviations.
2. **Verify the previous session's done-criteria actually hold** — run its acceptance commands. If anything fails, record it in the deviation log and fix it (or flag it) before new work. Never build on sand.
3. **Work only the current prompt's scope.** Out-of-scope discoveries go to the PROGRESS.md open-questions queue. No drive-by fixes or refactors.
4. **Strict TDD** — invoke the superpowers test-driven-development skill; red → green → refactor; no implementation before a failing test. Patterns and per-layer duties: `docs/testing.md`.
5. **Any deviation from spec** (PRD, docs, or the prompt) goes in the PROGRESS.md deviation log **with a question for Shivendra — never improvised silently.**
6. **Before stopping:** `pnpm test` and `pnpm typecheck` green; `PROGRESS.md` updated (status, date, notes, next-session pointer); work committed. Do not start the next prompt.

## Commands

| Command | What |
|---|---|
| `pnpm install` | Install workspace deps |
| `pnpm test` | All tests (Vitest, Workers pool) |
| `pnpm typecheck` | `tsc --noEmit` across workspace |
| `pnpm --filter @r301/api dev` | Local Worker (Miniflare-backed local D1/KV) |
| `pnpm --filter @r301/api test:watch` | TDD loop |

Deploys happen **only via CI**: push to `main` → staging; tag `v*` → production (PRD §14). Never `wrangler deploy` by hand.

## Repo map

```
r301-dev-prd.md       signed-off PRD — source of truth
PROGRESS.md           cross-session tracker: status table, deviation log, open questions
prompts/              one self-contained kickoff per implementation session
docs/design.md        architecture, redirect path, KV/D1 contract, auth, idempotency, module layout
docs/api-contract.md  endpoint-by-endpoint spec (canonical until Zod/OpenAPI exists in code)
docs/decisions.md     ADR log (D1–D25 seeded); new deps/deviations get a row here
docs/testing.md       TDD protocol, Vitest + Miniflare patterns, per-layer test duties, smoke spec
docs/runbook.md       manual steps only Shivendra can do (Cloudflare, GitHub, Sentry, monitors)
apps/api/             the Worker: wrangler.toml (staging+production), tsconfig, migrations/
.github/workflows/    ci (PR) → deploy-staging (main) → deploy-production (tag)
```

## Conventions (hard rules)

- **TypeScript strict** — the `tsconfig` flags are non-negotiable. No `any`, no `@ts-ignore`/`@ts-expect-error` without a deviation-log entry.
- **No new dependency without an ADR** in `docs/decisions.md`, approved by Shivendra. The initial set is pre-approved there (D26).
- **Telemetry allowlist (PRD D23):** destination URLs, request bodies, query strings, and auth headers NEVER reach Sentry or logs. A unit test pins the scrubber — never weaken or delete it.
- **Migrations (PRD §14):** numbered SQL in `apps/api/migrations/`, forward-only, additive-first. Promotion invariant: N−1 code must run correctly on N schema.
- **Local-first dev (PRD D25):** Miniflare for everything local; staging is for CI smoke only; load tests on the free tier are banned (account-wide quotas are shared with production).
- **KV contract (PRD D20):** D1 commits first, then an awaited KV put; no negative caching; KV is a rebuildable cache, never truth.
- Comments only for constraints the code can't express. Match surrounding style.
- Commits: small, green, message cites the prompt (e.g. `feat(api): slug generation [prompt 03]`).

## Environment notes

- Two envs in `apps/api/wrangler.toml`: `staging`, `production`. Real resource IDs are pasted in by `docs/runbook.md` steps — placeholders shaped `<paste: runbook A3>`/`<paste: runbook A4>` are expected until then; local dev/tests use the top-level local bindings and need no IDs.
- Worker secret: `SENTRY_DSN` only. There is no `ADMIN_TOKEN` and there are no key-management endpoints in v1 (PRD D14) — keys are minted by local script.
- Test keys don't exist until P1 (PRD D13); pilot testing happens on the staging environment with ordinary keys.
