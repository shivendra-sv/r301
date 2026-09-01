// The stats resources (api-contract §stats, §tags). Counts live here rather
// than on the Link resource — D26.1 keeps one source of truth for them.

import type { z } from "@hono/zod-openapi";
import type { LinkRow } from "../db/types";
import type { linkStatsSchema } from "../schemas/resources";
import { isoOrNull } from "./link";

/** Derived from the published schema — see `serializers/link.ts` for why. */
export type LinkStatsResource = z.infer<typeof linkStatsSchema>;

export function serializeLinkStats(row: LinkRow): LinkStatsResource {
  return {
    slug: row.slug,
    click_count: row.click_count,
    last_clicked_at: isoOrNull(row.last_clicked_at),
    // Never null in storage, so the shared helper's null branch cannot fire —
    // the cast documents that rather than inventing a fallback date.
    created_at: isoOrNull(row.created_at) as string,
  };
}
