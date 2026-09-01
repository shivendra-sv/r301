// Link creation as one reusable unit (design §10 `services/links.ts`). Single
// create (§7.1) and batch create (§7.2) must produce byte-identical links, so
// the sequence — resolve slug, insert, attach tags, read them back, write KV —
// has exactly one definition. Storage is injected; nothing here imports Hono.

import { attachTag, findTagNamesForLinks, insertLink, upsertTag } from "../db/queries";
import { ApiError } from "../errors";
import { putRedirect, redirectEntryFor } from "../kv/redirects-cache";
import type { CreateLinkInput } from "../schemas/create-link";
import { serializeLink, type LinkResource } from "../serializers/link";
import { resolveSlug } from "./slugs";

/** SQLite's wording, surfaced verbatim through D1. */
function isSlugUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed: links\.slug/.test(err.message);
}

export interface CreateLinkOptions {
  db: D1Database;
  kv: KVNamespace;
  body: CreateLinkInput;
  /** D12: attribution only — every live key still sees every link. */
  createdByKeyId: number;
  /** Epoch ms for `created_at`/`updated_at`; the caller owns the clock. */
  at: number;
  /** Selects the short-link host the resource is rendered against. */
  environment: string;
}

/**
 * Throws `ApiError` for every outcome the contract names (`slug_taken`,
 * `slug_reserved`, …) and a bare `Error` for anything unexpected — including
 * the awaited KV put. Single create lets both reach the error handler; batch
 * turns them into per-item results (§7.2), which is why the distinction has to
 * survive out of this function rather than being rendered here.
 */
export async function createLink({
  db,
  kv,
  body,
  createdByKeyId,
  at,
  environment,
}: CreateLinkOptions): Promise<LinkResource> {
  const resolved = await resolveSlug({
    db,
    ...(body.slug === undefined ? {} : { custom: body.slug }),
  });

  if (!resolved.ok) {
    throw new ApiError(resolved.code, resolved.message, "slug");
  }

  // resolveSlug only SELECTs; it never reserves. A concurrent request can
  // take the slug in between, so UNIQUE(slug) is the real arbiter (design §6)
  // and the loser gets the contract's 409 rather than an unexplained 500.
  // Within one batch this is also what makes a repeated custom slug lose:
  // items run sequentially, so the second insert meets the first one's row.
  const row = await insertLink(db, {
    slug: resolved.slug,
    destination: body.destination,
    redirectType: body.redirect_type,
    expiresAt: body.expires_at === undefined ? null : Date.parse(body.expires_at),
    externalId: body.external_id ?? null,
    createdByKeyId,
    at,
  }).catch((err: unknown) => {
    if (isSlugUniqueViolation(err)) {
      throw new ApiError("slug_taken", `Slug '${resolved.slug}' is already in use.`, "slug");
    }

    throw err;
  });

  if (row === null) {
    throw new Error("INSERT ... RETURNING produced no row");
  }

  // §7.3: implicit creation. Sequential rather than batched because each tag
  // needs its id back before it can be linked.
  for (const name of body.tags ?? []) {
    const tag = await upsertTag(db, name);
    if (tag === null) {
      throw new Error(`tag upsert produced no row for '${name}'`);
    }
    await attachTag(db, row.id, tag.id);
  }

  // Read back rather than echoing `body.tags`, exactly as PATCH does:
  // `link_tags` is keyed (link_id, tag_id), so `["x","x"]` stores one row and
  // an echo would report a set the next GET disagrees with (question 23).
  const tags = (await findTagNamesForLinks(db, [row.id])).get(row.id) ?? [];

  // D20: D1 has committed; the KV put is awaited, so its failure is the
  // caller's failure. The row stays behind on purpose — an idempotent retry
  // converges (prompt 11), and a fire-and-forget put would instead leave a
  // stale entry that backfill can never heal.
  await putRedirect(kv, row.slug, redirectEntryFor(row));

  return serializeLink(row, tags, environment);
}
