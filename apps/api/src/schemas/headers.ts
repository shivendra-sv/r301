// Response and request headers the API actually sends and honours, as schemas
// so the OpenAPI document publishes them (api-contract §Global conventions).

import { z } from "@hono/zod-openapi";

/** api-contract: 1–255 characters. Mirrors middleware/idempotency.ts. */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

/**
 * `X-Request-Id` is set by `middleware/request-id.ts` on **every** response —
 * success, error, redirect alike — so it is documented on every response rather
 * than on the ones that happen to be interesting. Required, because it is never
 * absent.
 */
export const requestIdHeader = z.string().uuid().meta({
  description:
    "A unique id for this request, generated at the edge. It is echoed in the `request_id` "
    + "field of every error body and attached to the matching Sentry event and structured log "
    + "line — quote it in a support request and the exact request can be found.",
  example: "3f6a1c2e-9b47-4d1a-8f30-6c2b91a7e5d4",
});

/**
 * Present only on a replay (D18). Optional rather than required: on a first
 * request the header is absent, not `false`.
 */
export const idempotencyReplayedHeader = z
  .literal("true")
  .optional()
  .meta({
    description:
      "Present with the value `true` when this response was replayed from a stored result "
      + "rather than executed. Absent on a request that actually ran. A replay returns the "
      + "original status and body byte for byte, including any per-item errors in a batch.",
    example: "true",
  });

/** Attached to every documented response (success and error alike). */
export const STANDARD_RESPONSE_HEADERS = z.object({ "X-Request-Id": requestIdHeader });

/** The success of an idempotent write additionally reports whether it replayed. */
export const IDEMPOTENT_RESPONSE_HEADERS = z.object({
  "X-Request-Id": requestIdHeader,
  "Idempotency-Replayed": idempotencyReplayedHeader,
});

/**
 * The `Idempotency-Key` request header (D18), declared as an OpenAPI parameter
 * so it appears on the two operations that honour it. Optional — sending one is
 * a client's choice, and omitting it simply means the request is not replayable.
 */
export const idempotencyKeyHeaderSchema = z.object({
  "Idempotency-Key": z
    .string()
    .min(1)
    .max(MAX_IDEMPOTENCY_KEY_LENGTH)
    .optional()
    .meta({
      description:
        "An opaque key of your choosing (1–255 characters) that makes this request safe to "
        + "retry — a UUID per logical operation is the usual choice.\n\n"
        + "Scope is (API key, key) and the window is **24 hours**. Within it:\n"
        + "- the same key with a **byte-identical** body replays the original status and body, "
        + "with `Idempotency-Replayed: true`\n"
        + "- the same key with a **different** body is `409 idempotency_conflict`\n"
        + "- the same key while the original is **still in flight** is also `409` (the message "
        + "distinguishes the two)\n\n"
        + "Retries must be byte-identical because the stored fingerprint is a hash of the raw "
        + "request body — re-serialising with different key order or spacing counts as a "
        + "different payload. Reservations are released if a request fails, so a `500` "
        + "(including the one D20 returns when the KV write fails) can be retried with the same "
        + "key until it converges.\n\n"
        + "For a batch, one key covers the whole request: a replay returns the stored per-item "
        + "results verbatim.",
      example: "8b1f0c2a-4d3e-4f6a-9b2c-7e5d1a3f0c94",
    }),
});
