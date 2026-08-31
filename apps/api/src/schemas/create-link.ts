// POST /v1/links body (api-contract §POST /v1/links).

import { z } from "@hono/zod-openapi";
import {
  destinationSchema,
  expiresAtSchema,
  externalIdSchema,
  redirectTypeSchema,
  slugSchema,
  tagsSchema,
} from "./fields";

// .strict() per D22: an unknown field is an error naming the field, so a
// misspelling is self-diagnosing rather than silently dropped.
export const createLinkSchema = z
  .object({
    destination: destinationSchema,
    slug: slugSchema.optional(),
    redirect_type: redirectTypeSchema.default(302),
    expires_at: expiresAtSchema.optional(),
    tags: tagsSchema.optional(),
    external_id: externalIdSchema.optional(),
  })
  .strict();

export type CreateLinkInput = z.infer<typeof createLinkSchema>;
