// Reserve-then-execute (PRD §8, D18, design.md §5). D1-backed because the
// store must be atomic and immediately consistent: KV's eventual consistency
// would make retry-after-timeout — the exact case that matters for an SMS
// send — best-effort.

import { sha256Hex } from "./digest";

/** api-contract §Global: 24 h window, enforced on read. */
export const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Below this age an unfinished reservation is in flight; at or above it, abandoned. */
export const IN_FLIGHT_TIMEOUT_MS = 60 * 1000;

/** design §5 step 3: bounded so the purge can never dominate a request. */
export const PURGE_LIMIT = 50;

export const MAX_KEY_LENGTH = 255;

/**
 * D26 item 8: identity is the hash of the **raw body bytes**, so a retry must
 * be byte-identical. Re-serialised JSON with different whitespace is a
 * different request, and the client documentation says so.
 */
export function hashBody(raw: string): Promise<string> {
  return sha256Hex(raw);
}

export interface Reservation {
  db: D1Database;
  key: string;
  apiKeyId: number;
  hash: string;
  now: number;
}

export type ReserveResult =
  | { outcome: "reserved" }
  | { outcome: "replay"; status: number; body: string }
  | { outcome: "conflict"; message: string };

interface KeyRow {
  request_hash: string;
  response_status: number | null;
  response_body: string | null;
  created_at: number;
}

const IN_FLIGHT: ReserveResult = {
  outcome: "conflict",
  message: "A request with this Idempotency-Key is still in flight.",
};

const MISMATCH: ReserveResult = {
  outcome: "conflict",
  message: "This Idempotency-Key was already used with a different payload.",
};

function isKeyConflict(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed: idempotency_keys/.test(err.message);
}

async function insertReservation(r: Reservation): Promise<boolean> {
  try {
    await r.db
      .prepare(
        `INSERT INTO idempotency_keys (key, api_key_id, request_hash, created_at)
         VALUES (?1, ?2, ?3, ?4)`,
      )
      .bind(r.key, r.apiKeyId, r.hash, r.now)
      .run();

    return true;
  } catch (err) {
    if (isKeyConflict(err)) {
      return false;
    }

    throw err;
  }
}

function findRow(r: Reservation): Promise<KeyRow | null> {
  return r.db
    .prepare(
      `SELECT request_hash, response_status, response_body, created_at
       FROM idempotency_keys WHERE key = ?1 AND api_key_id = ?2`,
    )
    .bind(r.key, r.apiKeyId)
    .first<KeyRow>();
}

/**
 * Deletes the row we actually read — matching on `created_at` — so a
 * reservation another isolate created in the meantime is never clobbered.
 * Losing the re-insert race means that isolate got there first, which is
 * exactly an in-flight duplicate.
 */
async function replaceStale(r: Reservation, row: KeyRow): Promise<ReserveResult> {
  await r.db
    .prepare("DELETE FROM idempotency_keys WHERE key = ?1 AND api_key_id = ?2 AND created_at = ?3")
    .bind(r.key, r.apiKeyId, row.created_at)
    .run();

  return (await insertReservation(r)) ? { outcome: "reserved" } : IN_FLIGHT;
}

export async function reserve(r: Reservation): Promise<ReserveResult> {
  if (await insertReservation(r)) {
    return { outcome: "reserved" };
  }

  const row = await findRow(r);

  if (row === null) {
    // Purged between the failed insert and this read; one more attempt.
    return (await insertReservation(r)) ? { outcome: "reserved" } : IN_FLIGHT;
  }

  const age = r.now - row.created_at;

  // Order is normative (design §5): the window is tested before the hash, so
  // an expired row with a different payload is replaced rather than reported
  // as a mismatch — the key is genuinely free again.
  if (age > IDEMPOTENCY_WINDOW_MS) {
    return replaceStale(r, row);
  }
  if (row.request_hash !== r.hash) {
    return MISMATCH;
  }
  if (row.response_body === null) {
    return age < IN_FLIGHT_TIMEOUT_MS ? IN_FLIGHT : replaceStale(r, row);
  }

  return { outcome: "replay", status: row.response_status ?? 200, body: row.response_body };
}

/** Only a success finalizes; everything else releases (design §5 step 2a). */
export async function finalize(r: Reservation, status: number, body: string): Promise<void> {
  await r.db
    .prepare(
      `UPDATE idempotency_keys SET response_status = ?3, response_body = ?4
       WHERE key = ?1 AND api_key_id = ?2`,
    )
    .bind(r.key, r.apiKeyId, status, body)
    .run();
}

/**
 * Removes the reservation after a failed execution, so the client's immediate
 * retry re-executes instead of meeting its own dead reservation for 60 s.
 */
export async function release(r: Reservation): Promise<void> {
  await r.db
    .prepare("DELETE FROM idempotency_keys WHERE key = ?1 AND api_key_id = ?2")
    .bind(r.key, r.apiKeyId)
    .run();
}

/** `LIMIT` via rowid: SQLite only supports DELETE ... LIMIT when built for it. */
export async function purgeExpired(db: D1Database, now: number): Promise<void> {
  await db
    .prepare(
      `DELETE FROM idempotency_keys WHERE rowid IN (
         SELECT rowid FROM idempotency_keys WHERE created_at < ?1 LIMIT ?2)`,
    )
    .bind(now - IDEMPOTENCY_WINDOW_MS, PURGE_LIMIT)
    .run();
}
