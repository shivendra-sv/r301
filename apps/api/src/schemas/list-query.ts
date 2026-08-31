// GET /v1/links query string (api-contract §GET /v1/links).

import { z } from "@hono/zod-openapi";
import { MAX_EXTERNAL_ID_LENGTH } from "./fields";

/** Query values are always strings, so the numeric bound is applied after. */
const limitSchema = z
  .string()
  .regex(/^\d+$/, "limit must be a whole number.")
  .transform(Number)
  .pipe(z.int().min(1).max(100));

/**
 * Exactly `"true"` or `"false"`. Accepting `1`/`yes`/`TRUE` would make a
 * typo'd filter silently mean something, and this is the filter that decides
 * whether disabled links appear.
 */
const activeSchema = z.enum(["true", "false"]).transform((value) => value === "true");

// .strict() per D22: a misspelled filter is an error, never a silently wider
// result set. Filters AND-combine; absent means "no filter", which is why none
// of them carry a default.
export const listLinksQuerySchema = z
  .object({
    tag: z.string().min(1).optional(),
    active: activeSchema.optional(),
    created_after: z.iso.datetime({ offset: true }).optional(),
    external_id: z.string().min(1).max(MAX_EXTERNAL_ID_LENGTH).optional(),
    cursor: z.string().min(1).optional(),
    limit: limitSchema.default(25),
  })
  .strict();

export type ListLinksQuery = z.infer<typeof listLinksQuerySchema>;
