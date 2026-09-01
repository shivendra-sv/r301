// GET /v1/links query string (api-contract §GET /v1/links).

import { z } from "@hono/zod-openapi";
import { MAX_EXTERNAL_ID_LENGTH } from "./fields";

/**
 * Query values are always strings, so the numeric bound is applied after.
 *
 * Documented as an `integer` with its real bounds: a client sees `limit: 1–100,
 * default 25`, which is both what the API enforces and what every OpenAPI
 * generator expects of a numeric query parameter. Without the override the
 * document published `type: string, pattern: ^\d+$` and hid the 1–100 range
 * entirely, since the bounds live past the `transform` where the input schema
 * cannot see them.
 *
 * `.refine` rather than `.regex` for the same reason: `.regex` leaves a
 * `pattern` on the emitted schema, and a pattern next to `type: integer` is
 * inert under JSON Schema but renders as a contradiction.
 */
const limitSchema = z
  .string()
  .refine((value) => /^\d+$/.test(value), "limit must be a whole number.")
  .transform(Number)
  .pipe(z.int().min(1).max(100))
  .meta({ type: "integer", minimum: 1, maximum: 100, default: 25, example: 25 });

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
    tag: z.string().min(1).optional().meta({
      description:
        "Only links carrying this tag, matched exactly — no prefix or wildcard matching. Filters "
        + "combine with AND, so this narrows any other filter rather than widening it.",
      example: "tenant:42",
    }),
    active: activeSchema.optional().meta({
      description:
        "Only active (`true`) or only deactivated (`false`) links. Omit to get both. Must be "
        + "exactly `true` or `false` — `1`, `yes` and `TRUE` are rejected rather than guessed at, "
        + "because this is the filter that decides whether disabled links appear.",
      example: "true",
    }),
    created_after: z.iso.datetime({ offset: true }).optional().meta({
      description:
        "Only links created strictly after this instant. ISO 8601 with an offset "
        + "(`2026-08-01T00:00:00Z`). Useful for incremental sync alongside the default "
        + "newest-first ordering.",
      example: "2026-08-01T00:00:00Z",
    }),
    external_id: z.string().min(1).max(MAX_EXTERNAL_ID_LENGTH).optional().meta({
      description:
        "Only links whose `external_id` matches exactly. Since external ids are deliberately "
        + "non-unique, this may return several links — it is a lookup, not a get-by-id.",
      example: "appt_9182",
    }),
    cursor: z.string().min(1).optional().meta({
      description:
        "The `next_cursor` from a previous page. Opaque — pass it back unmodified. Omit for the "
        + "first page. Cursors do not expire, and keep the same filters as the request that "
        + "produced them, so re-sending the filters is unnecessary but harmless.",
      example: "eyJjIjoxNzU2NjM2ODAwMDAwLCJpIjo0MjF9",
    }),
    limit: limitSchema.default(25).meta({
      type: "integer",
      minimum: 1,
      maximum: 100,
      default: 25,
      example: 25,
      description:
        "How many links to return, 1–100. Defaults to 25. A full page does not imply more "
        + "results — check `next_cursor` for that.",
    }),
  })
  .strict()
  .meta({
    title: "List filters",
    description:
      "All filters are optional and AND-combine. Deleted links never appear under any filter.",
  });

export type ListLinksQuery = z.infer<typeof listLinksQuerySchema>;
