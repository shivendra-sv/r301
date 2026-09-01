// GET /v1/stats query string (api-contract §GET /v1/stats).

import { z } from "@hono/zod-openapi";
import { MAX_TAG_LENGTH } from "./fields";

/**
 * `tag` is required — the contract has no "all tags" aggregate, and defaulting
 * to one would answer a question nobody asked. `.strict()` per D22, so a
 * misspelled parameter is an error rather than a silently ignored filter.
 */
export const tagStatsQuerySchema = z
  .object({
    tag: z.string().min(1).max(MAX_TAG_LENGTH).meta({
      description:
        "The tag to aggregate over, matched exactly. Required — there is no all-tags aggregate, "
        + "and defaulting to one would answer a question nobody asked. A tag that does not "
        + "exist reports zeros with a `200`, so this endpoint cannot be used to discover which "
        + "tags exist; use `GET /v1/tags` for that.",
      example: "tenant:42",
    }),
  })
  .strict();

export type TagStatsQuery = z.infer<typeof tagStatsQuerySchema>;
