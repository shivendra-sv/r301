// POST /v1/links/batch body (api-contract §batch, PRD §7.2).

import { z } from "@hono/zod-openapi";
import { createLinkSchema } from "./create-link";

/** PRD §7.2: up to 100 link objects per request. */
export const MAX_BATCH_ITEMS = 100;

/**
 * The create body as JSON Schema, attached to the item type below as
 * documentation only. Nested `$schema` is stripped: it is meaningful at a
 * document's root, and prompt 19 owns that root.
 */
function createBodyJsonSchema(): Record<string, unknown> {
  const { $schema: _root, ...rest } = z.toJSONSchema(createLinkSchema, { io: "input" }) as Record<
    string,
    unknown
  >;

  return rest;
}

/**
 * Items are `unknown` here **by design**, not by omission. A batch is never
 * all-or-nothing (§7.2), so one bad item must become one `error` entry rather
 * than a 400 for the other 99 — which means each item is parsed with
 * `createLinkSchema` inside the loop, where its failure has somewhere to go.
 * This wrapper therefore validates only what genuinely is a whole-request
 * fault, which is exactly the api-contract's list: `links` missing, not an
 * array, empty, or over the cap.
 *
 * `.meta()` keeps the *document* honest regardless — it renders the real create
 * body, so a client reading the published contract never sees "items: anything"
 * (D22). Validation looseness is where-it-happens, not what-is-accepted.
 */
export const batchCreateSchema = z
  .object({
    links: z
      .array(z.unknown().meta(createBodyJsonSchema()))
      .min(1, "links must contain at least one item.")
      .max(MAX_BATCH_ITEMS, `links must contain at most ${MAX_BATCH_ITEMS} items.`),
  })
  .strict();

export type BatchCreateInput = z.infer<typeof batchCreateSchema>;
