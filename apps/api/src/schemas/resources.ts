// Response bodies, as schemas (api-contract §The Link resource, §stats, §tags).
//
// These are the source of both halves: the OpenAPI components the document
// publishes, and — via `z.infer` in the serializers — the TypeScript types the
// handlers must satisfy. One definition, so a documented field that the code
// stopped sending is a type error rather than a lie in the published contract.

import { z } from "@hono/zod-openapi";
import { redirectTypeSchema } from "./fields";

export const linkResourceSchema = z
  .object({
    slug: z.string(),
    /** Convenience field (D26.2); uses the environment's redirect host. */
    short_url: z.string(),
    destination: z.string(),
    redirect_type: redirectTypeSchema,
    is_active: z.boolean(),
    /** ISO 8601 UTC, or null when the link never expires. */
    expires_at: z.string().nullable(),
    tags: z.array(z.string()),
    external_id: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi("Link");

export const linkListSchema = z
  .object({
    links: z.array(linkResourceSchema),
    /** Null exactly when the last page has been reached. */
    next_cursor: z.string().nullable(),
  })
  .openapi("LinkList");

/**
 * The per-item error inside a batch. Deliberately *not* the error envelope:
 * it carries no `request_id`, because the batch's own 200 response carries
 * `X-Request-Id` once rather than repeating one id up to 100 times
 * (api-contract §batch; PROGRESS question 25).
 */
const batchItemErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  field: z.string().optional(),
});

export const batchResultSchema = z
  .object({
    items: z.array(
      z.union([
        z.object({
          index: z.int(),
          status: z.literal("created"),
          link: linkResourceSchema,
        }),
        z.object({
          index: z.int(),
          status: z.literal("error"),
          error: batchItemErrorSchema,
        }),
      ]),
    ),
    summary: z.object({ created: z.int(), failed: z.int() }),
  })
  .openapi("BatchResult");

export const linkStatsSchema = z
  .object({
    slug: z.string(),
    /** At-least-approximate by design (PRD §7.4, D21). */
    click_count: z.int(),
    last_clicked_at: z.string().nullable(),
    created_at: z.string(),
  })
  .openapi("LinkStats");

export const tagStatsSchema = z
  .object({
    tag: z.string(),
    link_count: z.int(),
    click_count: z.int(),
  })
  .openapi("TagStats");

export const tagListSchema = z
  .object({
    tags: z.array(z.object({ name: z.string(), link_count: z.int() })),
  })
  .openapi("TagList");

export const healthSchema = z
  .object({
    status: z.literal("ok"),
    /** The deploy's git SHA, or "dev" when none was injected. */
    version: z.string(),
    env: z.string(),
  })
  .openapi("Health");

/** Wraps a response body schema in the one content type this API speaks (D22). */
export function jsonResponse<T extends z.ZodType>(
  description: string,
  schema: T,
): { description: string; content: { "application/json": { schema: T } } } {
  return { description, content: { "application/json": { schema } } };
}
