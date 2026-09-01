import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { aggregateTagStats, findLiveLinkBySlug } from "../db/queries";
import { ApiError } from "../errors";
import { tagStatsQuerySchema } from "../schemas/stats-query";
import { serializeLinkStats } from "../serializers/stats";
import type { AppEnv } from "../types";

/**
 * No format schema on the param, matching `GET /v1/links/{slug}`: "unknown or
 * tombstoned → 404", and a malformed slug is simply one that cannot exist.
 */
const slugParamSchema = z.object({ slug: z.string() });

export const linkStatsRoute = createRoute({
  method: "get",
  path: "/v1/links/{slug}/stats",
  summary: "Counts for one link",
  request: { params: slugParamSchema },
  responses: {
    200: { description: "Click count, last click and creation time." },
    401: { description: "Missing or invalid API key." },
    404: { description: "No such link, or it has been deleted." },
  },
});

export function registerLinkStatsRoute(app: OpenAPIHono<AppEnv>): void {
  app.openapi(linkStatsRoute, async (c) => {
    const { slug } = c.req.valid("param");

    // D15: tombstones are invisible to every read path, stats included — a
    // deleted link's counts must not outlive it.
    const row = await findLiveLinkBySlug(c.env.DB, slug);

    if (row === null) {
      throw new ApiError("not_found", "Resource not found.");
    }

    return c.json(serializeLinkStats(row), 200);
  });
}

export const tagStatsRoute = createRoute({
  method: "get",
  path: "/v1/stats",
  summary: "Aggregate counts for one tag",
  request: { query: tagStatsQuerySchema },
  responses: {
    200: { description: "Link and click totals across the tag's live links." },
    400: { description: "`tag` missing, empty or an unknown parameter present." },
    401: { description: "Missing or invalid API key." },
  },
});

export function registerTagStatsRoute(app: OpenAPIHono<AppEnv>): void {
  app.openapi(tagStatsRoute, async (c) => {
    const { tag } = c.req.valid("query");

    // No existence check: an unknown tag is 200 with zeros, not 404
    // (api-contract). There is nothing to probe for, so nothing to leak.
    const totals = await aggregateTagStats(c.env.DB, tag);

    return c.json({ tag, ...totals }, 200);
  });
}
