// The canonical error body (api-contract §Error envelope), as a schema so the
// OpenAPI document can publish it once and every error response can point at it.

import { z } from "@hono/zod-openapi";
import { ERROR_STATUS, type ErrorCode } from "../errors";
import { STANDARD_RESPONSE_HEADERS } from "./headers";

/**
 * Derived from the code→status table rather than re-listed: adding a code there
 * documents it here automatically, and the two can never drift into disagreeing
 * about what the API can return.
 */
const ERROR_CODES = Object.keys(ERROR_STATUS) as [ErrorCode, ...ErrorCode[]];

/**
 * What each code means, in the client's terms. Typed as a total record over
 * `ErrorCode`, so adding a code to `ERROR_STATUS` without explaining it here is
 * a **compile error** rather than an undocumented code reaching a client.
 */
const ERROR_CODE_DOCS: Record<ErrorCode, string> = {
  invalid_request:
    "The request could not be understood: malformed JSON, a schema violation, an unknown or "
    + "misspelled field, a bad query parameter, a batch over 100 items, or an `expires_at` that "
    + "is not in the future. Validation is strict — an unknown field is an error naming the "
    + "field, never a silently ignored one. Also the code carried by a `415`.",
  unauthorized:
    "The `Authorization` header is missing, malformed, or names a key that is unknown or "
    + "revoked. All four are reported identically and deliberately: distinguishing them would "
    + "turn the endpoint into an oracle for guessing valid keys. Revocation takes effect "
    + "immediately — there is no key cache.",
  forbidden:
    "Reserved for an explicit capability denial. Unused in v1, where any live key may manage "
    + "any of the owner's links.",
  not_found:
    "No such resource — either it never existed, or it was deleted. Deleted links are "
    + "indistinguishable from links that never existed, so a takedown cannot be confirmed by "
    + "probing.",
  method_not_allowed: "The route exists but does not accept this HTTP method.",
  slug_taken:
    "The requested custom slug is already in use. This includes slugs held by **deleted** "
    + "links: a tombstone keeps its slug reserved so a short URL already in circulation can "
    + "never be re-pointed at someone else's destination.",
  idempotency_conflict:
    "The `Idempotency-Key` was reused with a different request body, or its original request is "
    + "still in flight. The message distinguishes the two. Retries must be byte-identical to "
    + "replay rather than conflict.",
  slug_reserved:
    "The requested slug is on the reserved-word list (`api`, `admin`, `login`, `robots.txt`, "
    + "and similar). Checked case-insensitively, so `Admin` is reserved just as `admin` is.",
  destination_invalid:
    "The destination URL failed validation — wrong scheme, unparseable, over 2048 characters, "
    + "a private or loopback host, embedded credentials, or `r301.dev` itself. The message names "
    + "which rule it broke.",
  destination_blocked:
    "Reserved. The destination was found on a threat list. Not returned in v1; safe-browsing "
    + "checks arrive with the public launch.",
  rate_limited:
    "Reserved. The API key has exceeded its request quota. Not returned in v1 — there are no "
    + "per-key quotas during the pilot, and no `RateLimit-*` headers are sent. Handle it anyway: "
    + "it will start appearing at public launch, and the redirect edge is already protected by a "
    + "network-level per-IP rule that answers outside this API.",
  internal:
    "An unexpected failure. Also returned when the database commit succeeded but the awaited "
    + "cache write did not — retry with the same `Idempotency-Key` and the state converges. "
    + "Every occurrence is reported to error tracking with the `request_id` in this body.",
};

/** Rendered into the `code` field's description, so the table ships with the API. */
function errorCodeTable(): string {
  const rows = ERROR_CODES.map(
    (code) => `| \`${code}\` | ${ERROR_STATUS[code]} | ${ERROR_CODE_DOCS[code]} |`,
  );

  return [
    "A stable, machine-readable reason. Switch on this rather than on the HTTP status: two "
      + "codes share `409` and two share `422`.",
    "",
    "| code | status | meaning |",
    "| --- | --- | --- |",
    ...rows,
  ].join("\n");
}

export const errorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: z.enum(ERROR_CODES).meta({ title: "Error code", description: errorCodeTable() }),
        message: z.string().meta({
          description:
            "A human-readable explanation, written for a developer reading a log. Intended to "
            + "be displayed or logged, never parsed — wording may change without notice.",
          example: "Slug 'launch' is already in use.",
        }),
        /** Present only when one field is at fault (api-contract). */
        field: z.string().optional().meta({
          description:
            "The single request field at fault, when exactly one is. Dotted for nested paths, "
            + "and the offending key itself for an unknown field. Absent when no one field is "
            + "to blame. Only the first problem is reported — fix it and re-submit to see the "
            + "next.",
          example: "slug",
        }),
        /** Mirrors the `X-Request-Id` header, for supportability (D22). */
        request_id: z.string().meta({
          description:
            "Echoes the `X-Request-Id` response header, so an error body pasted into a bug "
            + "report carries everything needed to find the request.",
          example: "3f6a1c2e-9b47-4d1a-8f30-6c2b91a7e5d4",
        }),
      })
      .meta({
        description:
          "The single object every failure is reported in. There is no top-level `errors` array "
          + "and no alternative shape — one failure is reported per response.",
      }),
  })
  .meta({
    title: "Error",
    description:
      "Every error from every endpoint has this shape — there is no second error format to "
      + "special-case. The one exception is a batch, whose per-item errors are the same object "
      + "minus `request_id`, since the batch's own `200` carries that once in the header.",
  })
  .openapi("ErrorEnvelope");

/** One worked error, used to render a response's `example`. */
export interface ErrorExample {
  code: ErrorCode;
  message: string;
  field?: string;
}

function exampleBody(example: ErrorExample): unknown {
  return {
    error: {
      code: example.code,
      message: example.message,
      ...(example.field === undefined ? {} : { field: example.field }),
      request_id: "3f6a1c2e-9b47-4d1a-8f30-6c2b91a7e5d4",
    },
  };
}

/**
 * Every error response in every route is built through here. Written as a
 * helper rather than repeated inline because "all errors share one shape" is a
 * contract guarantee — one that a hand-copied `content` block would quietly
 * break the first time someone edited a single route.
 *
 * At least one worked example is **required**: a status a client cannot picture
 * is a status they will not handle. Pass more than one where a status has more
 * than one meaning (`409` on create is both `slug_taken` and
 * `idempotency_conflict`), and they are published as named examples.
 */
export function errorResponse(
  description: string,
  first: ErrorExample,
  ...rest: ErrorExample[]
): {
  description: string;
  headers: typeof STANDARD_RESPONSE_HEADERS;
  content: { "application/json": Record<string, unknown> };
} {
  const all = [first, ...rest];
  const media: Record<string, unknown> =
    all.length === 1
      ? { schema: errorEnvelopeSchema, example: exampleBody(first) }
      : {
          schema: errorEnvelopeSchema,
          examples: Object.fromEntries(
            all.map((example) => [
              example.code,
              { summary: example.message, value: exampleBody(example) },
            ]),
          ),
        };

  return {
    description,
    headers: STANDARD_RESPONSE_HEADERS,
    content: { "application/json": media },
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
  405: errorResponse("The method is not allowed on this route.", {
    code: "method_not_allowed",
    message: "Method PUT is not allowed on /v1/links.",
  }),
  // Declared everywhere, not just on the write paths the api-contract names:
  // any operation can fail unexpectedly, and D20 returns this specific status
  // when the awaited KV write fails (retry with the same Idempotency-Key — it
  // converges). PROGRESS question 28.
  500: errorResponse("An unexpected error occurred.", {
    code: "internal",
    message: "An unexpected error occurred.",
  }),
} as const;

export const AUTHENTICATED_ROUTE_ERRORS = {
  401: errorResponse("Missing or invalid API key.", {
    code: "unauthorized",
    message: "A valid API key is required.",
  }),
  ...PUBLIC_ROUTE_ERRORS,
} as const;

/**
 * api-contract §Global conventions: a request carrying a body must declare
 * `application/json`. Enforced by `middleware/json-body.ts` for POST/PUT/PATCH.
 */
export const JSON_BODY_ERRORS = {
  415: errorResponse("Request bodies must be sent as application/json.", {
    code: "invalid_request",
    message: "Content-Type must be application/json.",
  }),
} as const;
