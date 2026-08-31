# Prompt 09 — Slug service: generation, reservation, collision handling

You are an implementation session for r301.dev. Follow the CLAUDE.md **implementation-session protocol** (read it now). This file is your entire scope.

## Context

Validation primitives exist (08). This prompt builds the slug *service*: cryptographically random auto-slugs, the reserved check on both paths, and collision behavior against D1 — including the tombstone rule that makes `slug_taken` permanent until the P1 purge.

**Read first:** `CLAUDE.md` · `PROGRESS.md` · PRD §7.1 (auto-slug), D15, D16 · `docs/design.md` §6 · `docs/testing.md` §3 Services-slug.

**Verify first:** prompt 08's acceptance commands.

## Objective

`src/services/slugs.ts`: `generateSlug(rng)` (7 chars, full base62, **rejection sampling** — 62 ∤ 256, naive modulo biases) and `resolveSlug({custom?, db})` → `{slug}` or typed errors (`slug_taken`, `slug_reserved`, `invalid`), with ≤3 regeneration attempts on auto-slug UNIQUE collision then error.

## Out of scope

- The create endpoint (10). KV. Custom-slug *format* validation (08 owns it; this service composes it).

## Spec references

- PRD §7.1: 7-char base62, crypto-random, retry on collision (unique index enforces).
- D16: reserved check runs on auto slugs too — regenerate on the absurd-odds hit.
- D15/design §6: existence check is `UNIQUE(slug)` doing the work — a tombstoned row is still `slug_taken`; never special-case it.

## TDD mandate

Invoke **superpowers:test-driven-development**. The RNG is injectable (`(bytes: Uint8Array) => void` or equivalent) — determinism is the point. Behaviors:

1. Generated slug: exactly 7 chars, alphabet `[0-9A-Za-z]` only.
2. Rejection sampling: an injected RNG emitting out-of-range bytes (≥ the largest multiple of 62) forces re-draws — biased bytes never map to a character; the sampler consumes further bytes instead.
3. Auto slug landing on a reserved word (inject an RNG that spells one) → regenerated transparently.
4. Auto-slug UNIQUE collision (pre-insert the colliding row; injected RNG returns it first, then a fresh one) → retried, succeeds; 3 consecutive collisions → typed internal error.
5. Custom slug: valid + free → accepted verbatim (case preserved); reserved (any case) → `slug_reserved`; taken by a **live** row → `slug_taken`; taken by a **tombstoned** row (`deleted_at` set) → `slug_taken` (D15).

## Acceptance criteria

```bash
pnpm test && pnpm typecheck   # green
```

## Done ritual

1. From repo root: `pnpm test` and `pnpm typecheck` — both green.
2. Update `PROGRESS.md`: row 09 → done (date, notes); next pointer → prompt 10.
3. Commit: `feat(api): slug service [prompt 09]`.
4. Stop. Do not start prompt 10. Anything off-spec → deviation log with a question.
