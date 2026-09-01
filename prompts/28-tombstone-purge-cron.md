# Prompt 28 — Tombstone purge cron (M3 STUB)

**STATUS: STUB — do not implement from this file.** Detailed after pilot learnings (M2 soak), per the master plan.

Scope when detailed: daily cron hard-deleting tombstones older than 30 days (frees slugs, cascades `link_tags`), plus expired-idempotency-row sweep; first Cron Trigger in the project (wrangler config change). Refs: PRD D15, §13 Background jobs, §6 P1.

**Added 1 Sep 2026 (PROGRESS question 27 — decided, do not re-litigate):** the sweep must also **prune orphaned `tags` rows** — those with no remaining `link_tags` row. Nothing removes them today: tombstoning a link leaves its `link_tags` rows in place, and a `PATCH` that replaces a tag set detaches without deleting the tag. So `GET /v1/tags` grows monotonically and lists dead tags at `link_count: 0`. That behaviour is **correct for v1 and is tested** (`test/routes/tags.test.ts`) — a zero-count tag is real history, and hiding it would make a re-used tag look brand new. Two consequences to carry into this prompt:
- **D26.6's "revisit past ~1,000 tags" threshold counts *ever-used* tags, not currently-used ones**, so it fires earlier than that decision assumed.
- Curastax's tag list fills with dead `tenant:*` entries as clinics churn; pruning here is what bounds it.
Order matters: prune tags **after** the tombstone delete cascades `link_tags`, or the orphans will not be visible yet.

If you are an implementation session pointed here: stop and ask Shivendra.
