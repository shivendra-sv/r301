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
    is_active: z.boolean().optional().meta({
      description:
        "Whether the link redirects. Setting this to `false` is the immediate kill switch: the "
        + "short URL starts answering `404` — the same as an unknown link — while the link "
        + "itself, its tags and its counts are all preserved. Set it back to `true` to restore "
        + "it. Deactivation outranks expiry, so an inactive link answers `404` even after its "
        + "`expires_at` has passed.",
      example: false,
    }),
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
  })
  .meta({
    title: "Update link",
    description:
      "Any non-empty subset of the mutable fields. Omitted fields are left alone; an empty "
      + "object is a `400` rather than a successful no-op.\n\n"
      + "Two fields accept `null` to *clear* them — `expires_at` and `external_id`. `tags` "
      + "**replaces** the whole set rather than merging, so send the full list you want (or `[]` "
      + "to remove them all).\n\n"
      + "`slug` is immutable and is rejected as an unknown field. A change reaches the redirect "
      + "edge worldwide within about 60 seconds — the response is immediate, propagation is not.",
    examples: [
      { destination: "https://clinic.example.com/appt/9182/rescheduled" },
      { is_active: false },
      { expires_at: null, tags: ["tenant:42", "kind:archived"] },
    ],
  });

export type PatchLinkInput = z.infer<typeof patchLinkSchema>;
