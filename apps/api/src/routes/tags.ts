import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { listTagCounts } from "../db/queries";
import { AUTHENTICATED_ROUTE_ERRORS } from "../schemas/error-envelope";
import { jsonResponse, tagListSchema } from "../schemas/resources";
import type { AppEnv } from "../types";

export const listTagsRoute = createRoute({
  method: "get",
  path: "/v1/tags",
  operationId: "listTags",
  tags: ["Tags & stats"],
  summary: "List tags with live link counts",
  description:
    "Every tag currently in use, sorted by name, with how many live links carry it. Tags are "
    + "created implicitly when a link uses them, so this is the only way to discover which "
    + "exist.\n\n"
    + "A tag whose last link was deleted disappears from this list. Unpaginated in v1 — the "
    + "response is the complete set.",
  responses: {
    // Unpaginated in v1 (D26.6): pilot tag cardinality is tiny. If it ever
    // approaches ~1,000 this needs a cursor, and that is a contract change.
    200: jsonResponse("Every tag, sorted by name, with its live link count.", tagListSchema, {
      tags: [
        { name: "kind:appointment", link_count: 12 },
        { name: "tenant:42", link_count: 17 },
      ],
    }),
    ...AUTHENTICATED_ROUTE_ERRORS,
  },
});

export function registerTagsRoute(app: OpenAPIHono<AppEnv>): void {
  app.openapi(listTagsRoute, async (c) => {
    return c.json({ tags: await listTagCounts(c.env.DB) }, 200);
  });
}
