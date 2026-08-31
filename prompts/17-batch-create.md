# Prompt 17 — POST /v1/links/batch: per-item bulk create

You are an implementation session for r301.dev. Follow the CLAUDE.md **implementation-session protocol** (read it now). This file is your entire scope.

## Context

Single create + idempotency exist (10–11). This prompt adds bulk create for Curastax campaign sends: up to 100 items, sequential, per-item success/error — never all-or-nothing (PRD §7.2 — D1's atomic `batch()` is deliberately NOT used).

**Read first:** `CLAUDE.md` · `PROGRESS.md` · PRD §7.2 (amended), D22 · `docs/api-contract.md` §batch · `docs/design.md` §5 (batch reuses idempotency unchanged).

**Verify first:** prompt 16's acceptance commands.

## Objective

`POST /v1/links/batch` (authenticated): wrapper schema `{links: [1..100 create bodies]}`, sequential execution reusing the create service per item, **200 always** with `items[]` (request order: `{index, status:"created"|"error", link?|error?}`) + `summary{created,failed}`. One `Idempotency-Key` covers the batch — replay returns the stored per-item results verbatim.

## Out of scope

- Parallelizing items (sequential is the spec — §7.2). Item-level idempotency keys. Rate limiting.

## Spec references

- `docs/api-contract.md` §batch — response shape normative; >100 or empty/non-array → 400 **before any work**.
- §7.2: ≤2 s budget at 100 items is a design note, not a test assertion.
- Per-item KV failure → that item is `error` with code `internal`; the batch continues (api-contract: never all-or-nothing).

## TDD mandate

Invoke **superpowers:test-driven-development**. Behaviors:

1. 3 valid items → 200; `items` in request order, all `created` with full Link bodies; `summary {3,0}`; 3 D1 rows + 3 KV entries.
2. Mixed batch (valid / bad destination / taken slug) → 200; per-item statuses and envelope-shaped `error` objects with the right codes; valid items persisted, failed ones absent.
3. **Duplicate custom slug within one batch** → first wins, second gets `slug_taken` (sequential semantics).
4. 101 items → 400 before any insert (assert zero rows). Empty `links` / non-array → 400.
5. One item's KV-put failure (stub throws on the Nth put) → that item `error internal`, later items still processed; batch still 200.
6. Batch + `Idempotency-Key`: replay returns byte-identical items/summary + `Idempotency-Replayed: true`, with **no** new rows (assert row count frozen).
7. Every created item carries the caller's `created_by_key_id`.

## Acceptance criteria

```bash
pnpm test && pnpm typecheck
# dev server: POST /v1/links/batch with 2 items → 200, items[0].status "created", summary {"created":2,"failed":0}
```

## Done ritual

1. From repo root: `pnpm test` and `pnpm typecheck` — both green.
2. Update `PROGRESS.md`: row 17 → done (date, notes); next pointer → prompt 18.
3. Commit: `feat(api): batch create [prompt 17]`.
4. Stop. Do not start prompt 18. Anything off-spec → deviation log with a question.
