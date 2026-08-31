# Prompt 11 — Idempotency: reserve-then-execute over create

You are an implementation session for r301.dev. Follow the CLAUDE.md **implementation-session protocol** (read it now). This file is your entire scope.

## Context

Create exists (10). This prompt makes it safe to retry: the D1-backed `Idempotency-Key` machinery (D18) implementing the full reserve-then-execute state machine — the thing that turns "SMS send timed out, retry" from a duplicate-link generator into a no-op. Batch (17) will reuse this service unchanged.

**Read first:** `CLAUDE.md` · `PROGRESS.md` · PRD §8 Idempotency (D18), §9 idempotency_keys DDL · `docs/design.md` §5 (the state machine — normative, including the 60 s abandoned-takeover and delete-reservation-on-failure) · `docs/api-contract.md` §Global idempotency · D26 item 8.

**Verify first:** prompt 10's acceptance commands.

## Objective

`src/services/idempotency.ts` + middleware wired onto `POST /v1/links`: header optional (absent → plain execution); present → the design.md §5 machine verbatim. `request_hash` = sha256 of **raw body bytes** (capture before schema parsing — mind middleware order).

## Out of scope

- Batch wiring (17). Any other endpoint. A cron purge (P1) — only the opportunistic `waitUntil` purge here.

## Spec references

- `docs/design.md` §5 — every transition: fresh reserve → execute → finalize; PK conflict → expired(>24 h)/mismatch/in-flight(<60 s)/abandoned(≥60 s)/replay; failure path **deletes the reservation**; opportunistic purge `LIMIT 50`.
- `docs/api-contract.md`: replay = original status + body + `Idempotency-Replayed: true`; conflicts → 409 `idempotency_conflict` (message differentiates payload-mismatch vs in-flight); key length 1–255.

## TDD mandate

Invoke **superpowers:test-driven-development**. Fake clock throughout; drive D1 rows directly to stage each state. Behaviors:

1. No header → executes normally, `idempotency_keys` untouched.
2. Fresh key → executes; row finalized with response status+body; response identical to a headerless call, no replay header.
3. Byte-identical replay → **stored** status+body verbatim (assert against a mutated DB to prove it's not re-executing) + `Idempotency-Replayed: true`.
4. Same key, different body bytes → 409, message indicates payload mismatch; original row untouched.
5. In-flight row (response_body NULL, created_at 10 s ago) → 409, message indicates in-flight.
6. Abandoned row (NULL, 61+ s old) → taken over: deleted, re-executed, finalized.
7. Expired row (>24 h) → treated as fresh (old row replaced); response is a new execution.
8. Execution failure (force the KV-put 500 from prompt 10's stub): reservation row **deleted** → an immediate retry with the same key re-executes and succeeds once KV behaves.
9. Replay of an error? Only successes finalize — a failed execution leaves no row (consequence of 8); assert that.
10. Purge: rows >24 h old get deleted opportunistically on a new reserve (`waitUntil`; use `waitOnExecutionContext`).
11. Key >255 chars or empty → 400 `invalid_request`.

## Acceptance criteria

```bash
pnpm test && pnpm typecheck
# and via dev server: two identical curl POSTs with -H "Idempotency-Key: demo-1" → same slug twice,
# second response carries Idempotency-Replayed: true
```

## Done ritual

1. From repo root: `pnpm test` and `pnpm typecheck` — both green.
2. Update `PROGRESS.md`: row 11 → done (date, notes); next pointer → prompt 12.
3. Commit: `feat(api): idempotency service + middleware [prompt 11]`.
4. Stop. Do not start prompt 12. Anything off-spec → deviation log with a question.
