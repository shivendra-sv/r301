import type { MiddlewareHandler } from "hono";
import { ApiError } from "../errors";
import type { AppEnv } from "../types";

/** Methods whose requests may carry a body. */
const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

/**
 * JSON-only enforcement (api-contract §Global conventions): a request carrying
 * a body must declare `application/json` — else 415 — and that body must parse
 * — else 400. Both errors use code `invalid_request`; 415 is the one status the
 * code→status table does not derive (the table notes it explicitly).
 *
 * Parsing here is what makes malformed JSON fail uniformly, before any route
 * runs. Hono caches the body text, so a later `c.req.json()` re-reads nothing.
 */
export const jsonBody: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (BODY_METHODS.has(c.req.method) && c.req.raw.body !== null) {
    const mediaType = (c.req.header("Content-Type") ?? "").split(";")[0]?.trim().toLowerCase();

    if (mediaType !== "application/json") {
      throw new ApiError(
        "invalid_request",
        "Request bodies must be sent as application/json.",
        undefined,
        415,
      );
    }

    try {
      await c.req.json();
    } catch {
      throw new ApiError("invalid_request", "Request body is not valid JSON.");
    }
  }

  return next();
};
