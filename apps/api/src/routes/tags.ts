import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { listTagCounts } from "../db/queries";
import type { AppEnv } from "../types";

export const listTagsRoute = createRoute({
  method: "get",
  path: "/v1/tags",
  summary: "List tags with live link counts",
  responses: {
    // Unpaginated in v1 (D26.6): pilot tag cardinality is tiny. If it ever
    // approaches ~1,000 this needs a cursor, and that is a contract change.
    200: { description: "Every tag, sorted by name, with its live link count." },
    401: { description: "Missing or invalid API key." },
  },
});

export function registerTagsRoute(app: OpenAPIHono<AppEnv>): void {
  app.openapi(listTagsRoute, async (c) => {
    return c.json({ tags: await listTagCounts(c.env.DB) }, 200);
  });
}
