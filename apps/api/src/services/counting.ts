// Click counting (PRD §7.4, D21, design.md §7). Storage is injected; nothing
// here knows about Hono or about the response it must never block.

import { BOT_DENYLIST } from "../bot-denylist";

/**
 * The filter chain, evaluated only once a successful 30x has been built.
 *
 * A missing UA counts: absence is not proof of a bot, and dropping those would
 * bias the metric in the direction that flatters it.
 */
export function shouldCount(method: string, ua: string | null): boolean {
  if (method !== "GET") {
    return false;
  }
  if (ua === null) {
    return true;
  }

  const haystack = ua.toLowerCase();

  return !BOT_DENYLIST.some((entry) => haystack.includes(entry));
}

/**
 * The count, as one statement (PRD §7.4). Read-modify-write would lose updates
 * under concurrent clicks on the same slug; `click_count + 1` cannot.
 *
 * `deleted_at IS NULL` guards the race where a DELETE lands between the KV read
 * and this write — a tombstone must not gain clicks.
 */
export async function recordClick(db: D1Database, slug: string, at: number): Promise<void> {
  await db
    .prepare(
      `UPDATE links SET click_count = click_count + 1, last_clicked_at = ?1
       WHERE slug = ?2 AND deleted_at IS NULL`,
    )
    .bind(at, slug)
    .run();
}
