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

export interface UpdateLinkFields {
  destination?: string;
  redirectType?: number;
  /** null clears the expiry (D26.5). */
  expiresAt?: number | null;
  isActive?: number;
  /** null clears the correlation id (D26.5). */
  externalId?: string | null;
}

/**
 * Sets only the columns the caller named, always bumping `updated_at` — a PATCH
 * that changes nothing but tags is still a write.
 *
 * `deleted_at IS NULL` guards the window between the route's lookup and this
 * write: a link tombstoned in between must not be resurrected by an update. The
 * row then does not match, `RETURNING` yields nothing, and the caller renders
 * the same 404 the lookup would have.
 */
export function updateLink(
  db: D1Database,
  id: number,
  fields: UpdateLinkFields,
  at: number,
): Promise<LinkRow | null> {
  const bindings: (string | number | null)[] = [];
  const placeholder = (value: string | number | null): string => `?${bindings.push(value)}`;
  const set = [`updated_at = ${placeholder(at)}`];

  if (fields.destination !== undefined) {
    set.push(`destination = ${placeholder(fields.destination)}`);
  }

  if (fields.redirectType !== undefined) {
    set.push(`redirect_type = ${placeholder(fields.redirectType)}`);
  }

  if (fields.expiresAt !== undefined) {
    set.push(`expires_at = ${placeholder(fields.expiresAt)}`);
  }

  if (fields.isActive !== undefined) {
    set.push(`is_active = ${placeholder(fields.isActive)}`);
  }

  if (fields.externalId !== undefined) {
    set.push(`external_id = ${placeholder(fields.externalId)}`);
  }

  return db
    .prepare(
      `UPDATE links SET ${set.join(", ")}
        WHERE id = ${placeholder(id)} AND deleted_at IS NULL
        RETURNING *`,
    )
    .bind(...bindings)
    .first<LinkRow>();
}

/**
 * D15's soft delete: the row stays and `deleted_at` marks it, because
 * `UNIQUE(slug)` spans tombstones and that is what blocks slug reuse until the
 * P1 purge cron.
 *
 * Matching on the slug directly makes this one statement rather than a
 * read-then-write, so there is no window for a concurrent delete to slip
 * through. `AND deleted_at IS NULL` also gives the contract's semantics for
 * free: unknown and already-tombstoned both match nothing, `RETURNING` yields
 * nothing, and the route renders the same 404 for both.
 */
export function tombstoneLinkBySlug(
  db: D1Database,
  slug: string,
  at: number,
): Promise<{ id: number } | null> {
  return db
    .prepare(
      `UPDATE links SET deleted_at = ?2
        WHERE slug = ?1 AND deleted_at IS NULL
        RETURNING id`,
    )
    .bind(slug, at)
    .first<{ id: number }>();
}

/**
 * Clears a link's tag set so the caller can re-attach it (D26.5: `tags`
 * replaces rather than merges). The `tags` rows themselves are left alone —
 * v1 does not prune orphans, and the next link to use the name reuses the row.
 */
export async function detachAllTags(db: D1Database, linkId: number): Promise<void> {
  await db.prepare("DELETE FROM link_tags WHERE link_id = ?1").bind(linkId).run();
}

/**
 * The read path's counterpart to `findLinkBySlug`: tombstones are filtered out
 * here, so a caller cannot accidentally serve one (D15 — a tombstoned link is
 * indistinguishable from an unknown slug).
 */
export function findLiveLinkBySlug(db: D1Database, slug: string): Promise<LinkRow | null> {
  return db
    .prepare("SELECT * FROM links WHERE slug = ?1 AND deleted_at IS NULL")
    .bind(slug)
    .first<LinkRow>();
}

/**
 * Tags for a page of links in one query — a per-link query would make a 100-item
 * page cost 100 round trips. Ordered by `link_tags.rowid` so a link's tags come
 * back in the order they were attached, which is the order the caller supplied
 * them (api-contract's Link example is not name-sorted).
 */
export async function findTagNamesForLinks(
  db: D1Database,
  linkIds: readonly number[],
): Promise<Map<number, string[]>> {
  const byLink = new Map<number, string[]>(linkIds.map((id) => [id, []]));

  if (linkIds.length === 0) {
    return byLink;
  }

  const placeholders = linkIds.map((_, i) => `?${i + 1}`).join(", ");
  const { results } = await db
    .prepare(
      `SELECT lt.link_id, t.name
         FROM link_tags lt JOIN tags t ON t.id = lt.tag_id
        WHERE lt.link_id IN (${placeholders})
        ORDER BY lt.rowid`,
    )
    .bind(...linkIds)
    .all<{ link_id: number; name: string }>();

  for (const row of results) {
    byLink.get(row.link_id)?.push(row.name);
  }

  return byLink;
}

export interface ListLinksParams {
  /** Exact tag name (§7.3), matched through the join table. */
  tag?: string;
  /** 1 or 0, as stored. */
  isActive?: number;
  /** Strictly newer than this instant, epoch ms. */
  createdAfter?: number;
  /** Exact match (D19). */
  externalId?: string;
  /** Keyset position to resume after; omitted for the first page. */
  after?: { createdAt: number; id: number };
  limit: number;
}

/**
 * The `?limit=` page plus filters, newest first (api-contract §GET list).
 *
 * Keyset, not offset: the cursor names a row, so links created between two page
 * fetches cannot shift the window and make the client re-see or skip rows.
 * `id` is the tie-break because `created_at` is not unique — links created in
 * the same millisecond would otherwise be skipped or repeated at a page edge.
 *
 * Placeholders are numbered as they are appended, since which filters are
 * present varies per call.
 */
export async function listLinks(db: D1Database, p: ListLinksParams): Promise<LinkRow[]> {
  const bindings: (string | number)[] = [];
  const placeholder = (value: string | number): string => `?${bindings.push(value)}`;

  // A tag matches at most one `link_tags` row per link (composite PK + UNIQUE
  // tag name), so the join cannot duplicate a link into the page.
  const join =
    p.tag === undefined
      ? ""
      : `JOIN link_tags lt ON lt.link_id = l.id
         JOIN tags t ON t.id = lt.tag_id AND t.name = ${placeholder(p.tag)}`;

  const where = ["l.deleted_at IS NULL"];

  if (p.isActive !== undefined) {
    where.push(`l.is_active = ${placeholder(p.isActive)}`);
  }

  if (p.createdAfter !== undefined) {
    where.push(`l.created_at > ${placeholder(p.createdAfter)}`);
  }

  if (p.externalId !== undefined) {
    where.push(`l.external_id = ${placeholder(p.externalId)}`);
  }

  if (p.after !== undefined) {
    const at = placeholder(p.after.createdAt);
    const id = placeholder(p.after.id);
    where.push(`(l.created_at < ${at} OR (l.created_at = ${at} AND l.id < ${id}))`);
  }

  const { results } = await db
    .prepare(
      `SELECT l.* FROM links l
       ${join}
       WHERE ${where.join(" AND ")}
       ORDER BY l.created_at DESC, l.id DESC
       LIMIT ${placeholder(p.limit)}`,
    )
    .bind(...bindings)
    .all<LinkRow>();

  return results;
}

/**
 * The redirect fallthrough (design §3). Unfiltered by `deleted_at` on purpose:
 * the caller must tell a tombstone apart from a live row, because a tombstone
 * is a 404 that must NOT be backfilled into KV.
 */
export function findLinkBySlug(db: D1Database, slug: string): Promise<LinkRow | null> {
  return db.prepare("SELECT * FROM links WHERE slug = ?1").bind(slug).first<LinkRow>();
}
