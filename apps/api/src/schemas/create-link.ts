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
  .strict()
  .meta({
    title: "Create link",
    description:
      "Everything needed to mint a short link. `destination` is the only required field; every "
      + "other field has a sensible default.\n\n"
      + "Validation is **strict**: an unknown or misspelled field is a `400` naming the field, "
      + "never a silently ignored one. Send `Idempotency-Key` to make the request safe to retry.",
    examples: [
      {
        destination: "https://clinic.example.com/appt/9182?t=abc123",
        tags: ["tenant:42", "kind:appointment"],
        external_id: "appt_9182",
        expires_at: "2026-09-30T12:00:00Z",
      },
      {
        destination: "https://clinic.example.com/invoice/4471",
        slug: "inv-4471",
        redirect_type: 301,
      },
    ],
  });

export type CreateLinkInput = z.infer<typeof createLinkSchema>;
