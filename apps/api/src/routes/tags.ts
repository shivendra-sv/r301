import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { listTagCounts } from "../db/queries";
import { AUTHENTICATED_ROUTE_ERRORS } from "../schemas/error-envelope";
import { jsonResponse, tagListSchema } from "../schemas/resources";
import type { AppEnv } from "../types";

export const listTagsRoute = createRoute({
  method: "get",
  path: "/v1/tags",
  summary: "List tags with live link counts",
  responses: {
    // Unpaginated in v1 (D26.6): pilot tag cardinality is tiny. If it ever
    // approaches ~1,000 this needs a cursor, and that is a contract change.
    200: jsonResponse("Every tag, sorted by name, with its live link count.", tagListSchema),
    ...AUTHENTICATED_ROUTE_ERRORS,
  },
});

export function registerTagsRoute(app: OpenAPIHono<AppEnv>): void {
  app.openapi(listTagsRoute, async (c) => {
    return c.json({ tags: await listTagCounts(c.env.DB) }, 200);
  });
}
