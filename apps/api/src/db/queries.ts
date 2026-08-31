// D1 access only — no business rules here (design.md §10 boundary rules).

import type { ApiKeyRow } from "./types";

/**
 * The single indexed SELECT every authenticated request makes (D10). `prefix`
 * is UNIQUE, so this is O(1) and there is deliberately no KV cache — that is
 * what makes revocation immediate.
 */
export function findApiKeyByPrefix(db: D1Database, prefix: string): Promise<ApiKeyRow | null> {
  return db
    .prepare(
      `SELECT id, key_hash, environment, revoked_at, last_used_at
       FROM api_keys WHERE prefix = ?1`,
    )
    .bind(prefix)
    .first<ApiKeyRow>();
}

export async function touchApiKeyLastUsed(db: D1Database, id: number, at: number): Promise<void> {
  await db.prepare("UPDATE api_keys SET last_used_at = ?2 WHERE id = ?1").bind(id, at).run();
}

/**
 * Deliberately NOT filtered by `deleted_at`: `UNIQUE(slug)` spans tombstones,
 * so a deleted link still owns its slug until the P1 purge cron (D15). Every
 * *read* path filters tombstones; this existence check must not.
 */
export function findLinkIdBySlug(db: D1Database, slug: string): Promise<{ id: number } | null> {
  return db.prepare("SELECT id FROM links WHERE slug = ?1").bind(slug).first<{ id: number }>();
}
