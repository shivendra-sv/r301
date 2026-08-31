// Shared field schemas (api-contract §Field constraints). Built on
// @hono/zod-openapi's `z` so the OpenAPI document accrues for free (D22).

import { z } from "@hono/zod-openapi";
import { ERROR_STATUS, type ErrorCode } from "../errors";
import { isReservedSlug } from "../reserved-slugs";
import { validateDestination } from "../services/destination";

/**
 * Most validation failures are 400 `invalid_request`, but the api-contract
 * gives a few their own code and status — a reserved slug is 422
 * `slug_reserved`, a rejected destination 422 `destination_invalid`. Zod has
 * no slot for that, so those issues carry it here and `apiCodeOf` reads it
 * back. One place, so routes never re-derive which failure they are holding.
 */
const API_CODE_PARAM = "apiCode";

function tagged(code: ErrorCode): { readonly [API_CODE_PARAM]: ErrorCode } {
  return { [API_CODE_PARAM]: code };
}

export function apiCodeOf(issue: z.core.$ZodIssue): ErrorCode {
  // Only custom issues carry params; everything else is a plain 400.
  const code = issue.code === "custom" ? issue.params?.[API_CODE_PARAM] : undefined;

  return typeof code === "string" && code in ERROR_STATUS
    ? (code as ErrorCode)
    : "invalid_request";
}

/** PRD §7.1: 3–64 chars, case-sensitive; reserved words blocked separately. */
export const SLUG_PATTERN = /^[a-zA-Z0-9_-]{3,64}$/;

export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 64;
export const MAX_EXTERNAL_ID_LENGTH = 128;

/** The §7.1 battery lives in services/destination.ts; this only reports it. */
export const destinationSchema = z.string().superRefine((value, ctx) => {
  const result = validateDestination(value);

  if (!result.ok) {
    ctx.addIssue({ code: "custom", message: result.message, params: tagged("destination_invalid") });
  }
});

export const slugSchema = z
  .string()
  .regex(SLUG_PATTERN, "Slug must be 3–64 characters from a–z, A–Z, 0–9, _ and -.")
  .superRefine((value, ctx) => {
    if (isReservedSlug(value)) {
      ctx.addIssue({
        code: "custom",
        message: `Slug '${value}' is reserved.`,
        params: tagged("slug_reserved"),
      });
    }
  });

/** D5: 302 is the default, applied by the create schema — not here. */
export const redirectTypeSchema = z.union([
  z.literal(301),
  z.literal(302),
  z.literal(307),
  z.literal(308),
]);

/**
 * D26: strictly future at write time. Creating an already-expired link is a
 * footgun; `is_active: false` is the kill switch. An offset is required — a
 * local time without one names no instant.
 */
export const expiresAtSchema = z
  .iso
  .datetime({ offset: true })
  .refine((value) => Date.parse(value) > Date.now(), {
    message: "expires_at must be in the future; set is_active to false to disable a link now.",
  });

/** Trim runs before the length checks, so " x " is a 1-char tag, not 3. */
export const tagsSchema = z
  .array(z.string().trim().min(1).max(MAX_TAG_LENGTH))
  .max(MAX_TAGS);

/** D19: free-form and deliberately non-unique. */
export const externalIdSchema = z.string().max(MAX_EXTERNAL_ID_LENGTH);
