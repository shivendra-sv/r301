// D1 access only — no business rules here (design.md §10 boundary rules).

import type { ApiKeyRow, LinkRow } from "./types";

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

export interface InsertLinkParams {
  slug: string;
  destination: string;
  redirectType: number;
  expiresAt: number | null;
  externalId: string | null;
  createdByKeyId: number;
  at: number;
}

/**
 * `RETURNING *` so the caller gets the row the database actually stored —
 * including the column defaults (`is_active`, `click_count`) — without a second
 * read. `UNIQUE(slug)` still arbitrates: a concurrent insert of the same slug
 * raises a constraint error here, which the route maps to `slug_taken`.
 */
export function insertLink(db: D1Database, p: InsertLinkParams): Promise<LinkRow | null> {
  return db
    .prepare(
      `INSERT INTO links
         (slug, destination, redirect_type, expires_at, external_id,
          created_by_key_id, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
       RETURNING *`,
    )
    .bind(p.slug, p.destination, p.redirectType, p.expiresAt, p.externalId, p.createdByKeyId, p.at)
    .first<LinkRow>();
}

/**
 * PRD §7.3: tags are created implicitly on first use. `DO UPDATE` rather than
 * `DO NOTHING` because only an updated row is RETURNING-visible — with
 * `DO NOTHING` an existing tag yields no row and the id would need a second
 * query. The write is a no-op assignment of the value already stored.
 */
export function upsertTag(db: D1Database, name: string): Promise<{ id: number } | null> {
  return db
    .prepare(
      `INSERT INTO tags (name) VALUES (?1)
       ON CONFLICT(name) DO UPDATE SET name = excluded.name
       RETURNING id`,
    )
    .bind(name)
    .first<{ id: number }>();
}

/** `OR IGNORE` keeps re-tagging idempotent against the composite primary key. */
export async function attachTag(db: D1Database, linkId: number, tagId: number): Promise<void> {
  await db
    .prepare("INSERT OR IGNORE INTO link_tags (link_id, tag_id) VALUES (?1, ?2)")
    .bind(linkId, tagId)
    .run();
}

/**
 * The redirect fallthrough (design §3). Unfiltered by `deleted_at` on purpose:
 * the caller must tell a tombstone apart from a live row, because a tombstone
 * is a 404 that must NOT be backfilled into KV.
 */
export function findLinkBySlug(db: D1Database, slug: string): Promise<LinkRow | null> {
  return db.prepare("SELECT * FROM links WHERE slug = ?1").bind(slug).first<LinkRow>();
}
