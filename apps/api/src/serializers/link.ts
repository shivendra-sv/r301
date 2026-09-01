// The canonical Link resource (api-contract §The Link resource, D26). Every
// endpoint that returns a link renders it through here, so the wire shape has
// exactly one definition.

import type { z } from "@hono/zod-openapi";
import type { LinkRow } from "../db/types";
import type { linkResourceSchema } from "../schemas/resources";

/**
 * Derived from the schema the OpenAPI document publishes, so the wire shape has
 * exactly one definition — a documented field this stops sending is a type
 * error, not a lie in the published contract.
 */
export type LinkResource = z.infer<typeof linkResourceSchema>;

/** ENVIRONMENT (wrangler.toml) → the host short links are served from. */
const REDIRECT_BASE_URLS: Record<string, string> = {
  production: "https://r301.dev",
  staging: "https://staging.r301.dev",
  local: "http://127.0.0.1:8787",
};

/**
 * Throws rather than falling back: an environment added without a map entry
 * would otherwise ship `127.0.0.1` short URLs to a real customer, and a loud
 * 500 in staging smoke is the cheaper way to find that out.
 */
export function redirectBaseUrl(environment: string): string {
  const base = REDIRECT_BASE_URLS[environment];

  if (base === undefined) {
    throw new Error(`No redirect host is configured for environment '${environment}'.`);
  }

  return base;
}

/**
 * Shared with the stats serializer: the api-contract's timestamp convention is
 * one rule ("ISO 8601 UTC, null when unset"), so it gets one implementation.
 */
export function isoOrNull(epochMs: number | null): string | null {
  return epochMs === null ? null : new Date(epochMs).toISOString();
}

/**
 * Counts are deliberately absent (D26) — they belong to the stats endpoints,
 * which keeps one source of truth for them.
 */
export function serializeLink(
  row: LinkRow,
  tags: readonly string[],
  environment: string,
): LinkResource {
  return {
    slug: row.slug,
    short_url: `${redirectBaseUrl(environment)}/${row.slug}`,
    destination: row.destination,
    // The 0001_init CHECK constraint restricts this column to the four values
    // the contract names; TypeScript cannot see a SQL constraint.
    redirect_type: row.redirect_type as LinkResource["redirect_type"],
    is_active: row.is_active === 1,
    expires_at: isoOrNull(row.expires_at),
    tags: [...tags],
    external_id: row.external_id,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}
