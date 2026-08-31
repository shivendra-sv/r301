// PATCH /v1/links/{slug} body (api-contract §PATCH, D26).

import { z } from "@hono/zod-openapi";
import {
  destinationSchema,
  expiresAtSchema,
  externalIdSchema,
  redirectTypeSchema,
  tagsSchema,
} from "./fields";

// Every mutable field, all optional; `slug` is absent because it is immutable
// (PRD §7.1) and .strict() therefore reports it as an unknown field. `tags`
// replaces the whole set rather than merging (D26).
export const patchLinkSchema = z
  .object({
    destination: destinationSchema.optional(),
    redirect_type: redirectTypeSchema.optional(),
    expires_at: expiresAtSchema.nullable().optional(),
    is_active: z.boolean().optional(),
    tags: tagsSchema.optional(),
    external_id: externalIdSchema.nullable().optional(),
  })
  .strict()
  // D26: an empty PATCH is a malformed request, not a successful no-op. Guarded
  // on `ctx.issues` because unknown keys are stripped before this runs — without
  // it, `{"slug":"x"}` would also be reported as "empty", which is misleading.
  .check((ctx) => {
    if (ctx.issues.length === 0 && Object.keys(ctx.value).length === 0) {
      ctx.issues.push({
        code: "custom",
        message: "PATCH body must contain at least one field to update.",
        input: ctx.value,
      });
    }
  });

export type PatchLinkInput = z.infer<typeof patchLinkSchema>;
