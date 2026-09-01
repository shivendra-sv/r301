import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { aggregateTagStats, findLiveLinkBySlug } from "../db/queries";
import { ApiError } from "../errors";
import { AUTHENTICATED_ROUTE_ERRORS, errorResponse } from "../schemas/error-envelope";
import { jsonResponse, linkStatsSchema, tagStatsSchema } from "../schemas/resources";
import { tagStatsQuerySchema } from "../schemas/stats-query";
import { serializeLinkStats } from "../serializers/stats";
import type { AppEnv } from "../types";

/**
 * No format schema on the param, matching `GET /v1/links/{slug}`: "unknown or
 * tombstoned → 404", and a malformed slug is simply one that cannot exist.
 */
const slugParamSchema = z.object({
  slug: z.string().meta({
    description:
      "The link's slug — the path segment of its short URL. Matched case-sensitively.",
    example: "aB3xY9k",
  }),
});

export const linkStatsRoute = createRoute({
  method: "get",
  path: "/v1/links/{slug}/stats",
  operationId: "getLinkStats",
  tags: ["Tags & stats"],
  summary: "Counts for one link",
  description:
    "How many times one link has been followed, and when it was last followed.\n\n"
    + "Counts are **at-least-approximate**: a redirect is served first and counted afterwards, "
    + "so the visitor never waits on the counter and a count may occasionally be lost. Observed "
    + "drift is under 0.1%.\n\n"
    + "Only successful `GET` redirects are counted. `HEAD` requests, `404`s, `410`s and "
    + "known bots — messenger link previews, email link scanners, crawlers and HTTP tooling — "
    + "are filtered out, so this number is usually lower than a raw access log. That filtering "
    + "is the point: an SMS link is typically fetched by the recipient\u2019s messenger before a "
    + "human ever taps it. Scanners that present a browser-like user-agent are not detectable "
    + "and do still count.\n\n"
    + "Kept off the link resource so listing links never has to aggregate counters. A deleted "
    + "link\u2019s counts are gone with it.",
  request: { params: slugParamSchema },
  responses: {
    200: jsonResponse("Click count, last click and creation time.", linkStatsSchema, {
      slug: "aB3xY9k",
      click_count: 123,
      last_clicked_at: "2026-09-01T08:14:22Z",
      created_at: "2026-08-31T10:00:00Z",
    }),
    ...AUTHENTICATED_ROUTE_ERRORS,
    404: errorResponse("No such link, or it has been deleted.", {
      code: "not_found",
      message: "Resource not found.",
    }),
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
  operationId: "getTagStats",
  tags: ["Tags & stats"],
  summary: "Aggregate counts for one tag",
  description:
    "Totals across every live link carrying one tag — the per-tenant or per-campaign rollup, "
    + "without fetching each link\u2019s stats individually.\n\n"
    + "`tag` is required; there is no all-tags aggregate. Deleted links are excluded from both "
    + "totals. A tag that does not exist reports zeros with a `200` rather than a `404`, so this "
    + "cannot be used to test whether a tag exists.\n\n"
    + "Click totals carry the same filtering and the same at-least-approximate guarantee as a "
    + "single link\u2019s count.",
  request: { query: tagStatsQuerySchema },
  responses: {
    200: jsonResponse("Link and click totals across the tag's live links.", tagStatsSchema, {
      tag: "tenant:42",
      link_count: 17,
      click_count: 940,
    }),
    400: errorResponse("`tag` missing, empty or an unknown parameter present.", {
      code: "invalid_request",
      message: "tag is required.",
      field: "tag",
    }),
    ...AUTHENTICATED_ROUTE_ERRORS,
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
