// POST /v1/links/batch body (api-contract §batch, PRD §7.2).

import { z } from "@hono/zod-openapi";
import { createLinkSchema } from "./create-link";

/** PRD §7.2: up to 100 link objects per request. */
export const MAX_BATCH_ITEMS = 100;

/**
 * Drops an `anyOf`/`oneOf` from any node that also declares a concrete `type`
 * with an `enum`.
 *
 * Such a node comes from a schema whose `.meta()` overrides how it is
 * published — `redirectTypeSchema` is a union of four literals presented as one
 * `enum`. `z.toJSONSchema` *merges* that metadata rather than replacing the
 * branches, leaving a node carrying both. The two agree, so nothing is lost by
 * dropping the branches; leaving them in means this one path publishes the
 * four-way `anyOf` that every other path stopped publishing, which is exactly
 * the "Any of number / number / number / number" rendering the override exists
 * to remove.
 *
 * Deliberately narrow: only a node that states both `type` and `enum` — that
 * is, one whose author said explicitly what it is — has its branches removed.
 */
function withoutRedundantBranches(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(withoutRedundantBranches);
  }

  if (typeof node !== "object" || node === null) {
    return node;
  }

  const entries = Object.entries(node as Record<string, unknown>);
  const record = Object.fromEntries(
    entries.map(([key, value]) => [key, withoutRedundantBranches(value)]),
  );

  if (record["type"] !== undefined && Array.isArray(record["enum"])) {
    delete record["anyOf"];
    delete record["oneOf"];
  }

  return record;
}

/**
 * The create body as JSON Schema, attached to the item type below as
 * documentation only. Nested `$schema` is stripped: it is meaningful at a
 * document's root, and prompt 19 owns that root.
 *
 * This is a second conversion path — the route bodies go through
 * @hono/zod-openapi, this goes through `z.toJSONSchema` directly — so it needs
 * the normalisation above to publish the same shapes the other path does.
 */
function createBodyJsonSchema(): Record<string, unknown> {
  const { $schema: _root, ...rest } = z.toJSONSchema(createLinkSchema, { io: "input" }) as Record<
    string,
    unknown
  >;

  return withoutRedundantBranches(rest) as Record<string, unknown>;
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
      .max(MAX_BATCH_ITEMS, `links must contain at most ${MAX_BATCH_ITEMS} items.`)
      .meta({
        description:
          `Between 1 and ${MAX_BATCH_ITEMS} create bodies, each identical in shape to `
          + "`POST /v1/links`. Processed sequentially, in order, and **not** transactionally: "
          + "each item succeeds or fails on its own.",
      }),
  })
  .strict()
  .meta({
    title: "Create links in bulk",
    description:
      `Up to ${MAX_BATCH_ITEMS} links in one request. Only whole-request faults — \`links\` `
      + "missing, not an array, empty, or over the cap — are rejected with a `400`; anything "
      + "wrong with an individual item becomes an `error` entry in the `200` response.",
    example: {
      links: [
        {
          destination: "https://clinic.example.com/appt/9182?t=abc123",
          tags: ["tenant:42", "kind:appointment"],
          external_id: "appt_9182",
        },
        {
          destination: "https://clinic.example.com/appt/9183?t=def456",
          slug: "launch",
          tags: ["tenant:42", "kind:appointment"],
        },
      ],
    },
  });

export type BatchCreateInput = z.infer<typeof batchCreateSchema>;
