// Shared field schemas (api-contract §Field constraints). Built on
// @hono/zod-openapi's `z` so the OpenAPI document accrues for free (D22).

import { z } from "@hono/zod-openapi";
import { ApiError, ERROR_STATUS, type ErrorCode } from "../errors";
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
export const destinationSchema = z
  .string()
  .superRefine((value, ctx) => {
    const result = validateDestination(value);

    if (!result.ok) {
      ctx.addIssue({
        code: "custom",
        message: result.message,
        params: tagged("destination_invalid"),
      });
    }
  })
  .meta({
    title: "Destination URL",
    description:
      "Where the short link sends visitors. Must be an absolute `http:` or `https:` URL of at "
      + "most 2048 characters that parses under the WHATWG URL standard.\n\n"
      + "Rejected with `422 destination_invalid`:\n"
      + "- any scheme other than `http`/`https` (notably `javascript:`, `data:`, `file:`)\n"
      + "- private, loopback or link-local hosts — `localhost`, `127.0.0.1`, `10.0.0.0/8`, "
      + "`172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` and their IPv6 equivalents "
      + "(internationalised hosts are normalised to punycode before this check)\n"
      + "- embedded credentials (`https://user:pass@host/`)\n"
      + "- `r301.dev` itself, which would create a redirect loop\n\n"
      + "The URL is stored and returned **verbatim**. Query strings are preserved exactly, so "
      + "signed or tokenised destinations survive the round trip; a query string on the *short* "
      + "URL is dropped rather than merged into this one.",
    examples: [
      "https://clinic.example.com/appt/9182?t=abc123",
      "https://clinic.example.com/invoice/4471",
    ],
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
  })
  .meta({
    title: "Custom slug",
    description:
      "The path segment of the short URL — `https://r301.dev/{slug}`. Omit it and a 7-character "
      + "base62 slug is generated for you.\n\n"
      + "3–64 characters from `a–z`, `A–Z`, `0–9`, `_` and `-`. **Matching is case-sensitive**, "
      + "so `Launch` and `launch` are two different links; the reserved-word check is *not* "
      + "case-sensitive, so neither `admin` nor `Admin` can be claimed.\n\n"
      + "- `409 slug_taken` — already in use, including by a deleted link, whose slug stays "
      + "blocked so it can never be silently taken over\n"
      + "- `422 slug_reserved` — on the reserved-word list (`api`, `admin`, `login`, …)\n\n"
      + "Immutable once created: `PATCH` rejects it as an unknown field. To change a slug, "
      + "create a new link and delete the old one.",
    examples: ["appt-9182", "spring-checkup"],
  });

/** D5: 302 is the default, applied by the create schema — not here. */
export const redirectTypeSchema = z
  .union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)])
  .meta({
    title: "Redirect status",
    description:
      "The HTTP status the redirect answers with. Defaults to `302`.\n\n"
      + "- **301 Moved Permanently** — cached hard by browsers and intermediaries. Good for "
      + "durable marketing links; a permanently cached hit never reaches the edge, so click "
      + "counts under-report and later changes to the destination may not be seen by clients "
      + "that already cached it.\n"
      + "- **302 Found** (default) — not cached (`Cache-Control: no-store`). Every visit reaches "
      + "the edge, which is what makes counts accurate and edits take effect. The right choice "
      + "for transactional links.\n"
      + "- **307 Temporary Redirect** — like 302, but the method and body are guaranteed to be "
      + "preserved. Use when the short URL might be reached by something other than a GET.\n"
      + "- **308 Permanent Redirect** — like 301, with the same method-preserving guarantee.\n\n"
      + "301 and 308 are served with `Cache-Control: public, max-age=3600`; 302 and 307 with "
      + "`no-store`.",
    example: 302,
  });

/**
 * D26: strictly future at write time. Creating an already-expired link is a
 * footgun; `is_active: false` is the kill switch. An offset is required — a
 * local time without one names no instant.
 */
export const expiresAtSchema = z.iso
  .datetime({ offset: true })
  .refine((value) => Date.parse(value) > Date.now(), {
    message: "expires_at must be in the future; set is_active to false to disable a link now.",
  })
  .meta({
    title: "Expiry",
    description:
      "When the link stops redirecting, as an ISO 8601 timestamp **with an offset** "
      + "(`2026-09-30T12:00:00Z` or `2026-09-30T17:30:00+05:30`). A local time without an "
      + "offset names no instant and is rejected. Stored and returned normalised to UTC.\n\n"
      + "Must be strictly in the future at write time — creating an already-expired link is a "
      + "footgun, so `400 invalid_request` is returned instead. To switch a link off *now*, set "
      + "`is_active: false`.\n\n"
      + "After this instant the short URL answers **410 Gone** rather than 404: the recipient of "
      + "an expired appointment link learns it existed and is over. Omit for a link that never "
      + "expires; send `null` in a `PATCH` to clear an existing expiry.",
    example: "2026-09-30T12:00:00Z",
  });

/** Trim runs before the length checks, so " x " is a 1-char tag, not 3. */
export const tagsSchema = z
  .array(z.string().trim().min(1).max(MAX_TAG_LENGTH).meta({ description: "A single tag name." }))
  .max(MAX_TAGS)
  .meta({
    title: "Tags",
    description:
      `Free-form labels for grouping and filtering, at most ${MAX_TAGS} per link and `
      + `${MAX_TAG_LENGTH} characters each. Surrounding whitespace is trimmed, so \` x \` is the `
      + "one-character tag `x`; a tag that trims to nothing is rejected.\n\n"
      + "Tags are created implicitly on first use — there is no endpoint to register one. A "
      + "`namespace:value` convention keeps them tidy and is what the aggregate endpoints are "
      + "designed around, but nothing enforces it.\n\n"
      + "In `PATCH` this field **replaces** the whole set rather than merging into it: send the "
      + "full list you want, or `[]` to clear every tag.",
    examples: [["tenant:42", "kind:appointment"], ["kind:invoice"]],
  });

/** D19: free-form and deliberately non-unique. */
export const externalIdSchema = z.string().max(MAX_EXTERNAL_ID_LENGTH).meta({
  title: "External id",
  description:
    `Your own identifier for whatever this link points at, up to ${MAX_EXTERNAL_ID_LENGTH} `
    + "characters. Stored verbatim, returned on the link, and filterable via "
    + "`GET /v1/links?external_id=…`, so you can find r301 links from your records without "
    + "keeping a mapping table.\n\n"
    + "**Deliberately not unique** — several links may carry the same value (a reminder and a "
    + "confirmation for one appointment, say). It is not a deduplication key: use "
    + "`Idempotency-Key` for that. Send `null` in a `PATCH` to clear it.",
  example: "appt_9182",
});

/**
 * Turns a parse failure into the contract's error (api-contract §Error
 * envelope). Only the first issue is reported: the envelope has room for one
 * `field`, and a caller fixing errors one at a time re-submits anyway.
 */
export function apiErrorFromZod(error: z.ZodError): ApiError {
  const issue = error.issues[0];

  if (issue === undefined) {
    return new ApiError("invalid_request", "Request body is invalid.");
  }

  // An unrecognized key is not addressed by `path` — the key names itself, and
  // naming it is the whole point of strict requests (D22).
  const field =
    issue.code === "unrecognized_keys"
      ? issue.keys[0]
      : issue.path.length > 0
        ? issue.path.join(".")
        : undefined;

  return new ApiError(apiCodeOf(issue), issue.message, field);
}
