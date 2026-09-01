// The canonical error body (api-contract §Error envelope), as a schema so the
// OpenAPI document can publish it once and every error response can point at it.

import { z } from "@hono/zod-openapi";
import { ERROR_STATUS, type ErrorCode } from "../errors";

/**
 * Derived from the code→status table rather than re-listed: adding a code there
 * documents it here automatically, and the two can never drift into disagreeing
 * about what the API can return.
 */
const ERROR_CODES = Object.keys(ERROR_STATUS) as [ErrorCode, ...ErrorCode[]];

export const errorEnvelopeSchema = z
  .object({
    error: z.object({
      code: z.enum(ERROR_CODES),
      message: z.string(),
      /** Present only when one field is at fault (api-contract). */
      field: z.string().optional(),
      /** Mirrors the `X-Request-Id` header, for supportability (D22). */
      request_id: z.string(),
    }),
  })
  .openapi("ErrorEnvelope");

/**
 * Every error response in every route is built through here. Written as a
 * helper rather than repeated inline because "all errors share one shape" is a
 * contract guarantee — one that a hand-copied `content` block would quietly
 * break the first time someone edited a single route.
 */
export function errorResponse(description: string): {
  description: string;
  content: { "application/json": { schema: typeof errorEnvelopeSchema } };
} {
  return {
    description,
    content: { "application/json": { schema: errorEnvelopeSchema } },
  };
}

/**
 * The errors any operation can produce regardless of what it does. Every path
 * registers a `methodNotAllowed` guard (prompt 03), so 405 is universal; 401
 * covers every path the auth middleware does not exempt. Spread rather than
 * repeated, so the document cannot end up describing it on eight routes and
 * forgetting the ninth.
 */
export const PUBLIC_ROUTE_ERRORS = {
  405: errorResponse("The method is not allowed on this route."),
  // Declared everywhere, not just on the write paths the api-contract names:
  // any operation can fail unexpectedly, and D20 returns this specific status
  // when the awaited KV write fails (retry with the same Idempotency-Key — it
  // converges). PROGRESS question 28.
  500: errorResponse("An unexpected error occurred."),
} as const;

export const AUTHENTICATED_ROUTE_ERRORS = {
  401: errorResponse("Missing or invalid API key."),
  ...PUBLIC_ROUTE_ERRORS,
} as const;

/**
 * api-contract §Global conventions: a request carrying a body must declare
 * `application/json`. Enforced by `middleware/json-body.ts` for POST/PUT/PATCH.
 */
export const JSON_BODY_ERRORS = {
  415: errorResponse("Request bodies must be sent as application/json."),
} as const;
