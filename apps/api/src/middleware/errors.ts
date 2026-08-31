import type { ErrorHandler, Hono, NotFoundHandler } from "hono";
import { ApiError, envelope } from "../errors";
import type { AppEnv } from "../types";

/**
 * Renders every JSON-surface error as the canonical envelope
 * (api-contract §Error envelope). Routes raise `ApiError`; anything else is an
 * unexpected failure and is reported as a bare `internal` — nothing about it
 * reaches the client, leaving the request id as the only handle, which ties the
 * response to the (later) log line and Sentry event.
 */
export function createErrorHandler(reportError: (err: unknown) => void): ErrorHandler<AppEnv> {
  return (err, c) => {
    // An ApiError is an expected outcome the contract already describes, so it
    // is answered but never reported — incidents only.
    if (err instanceof ApiError) {
      return c.json(envelope(err.code, err.message, c.get("requestId"), err.field), err.status);
    }

    reportError(err);

    return c.json(envelope("internal", "An unexpected error occurred.", c.get("requestId")), 500);
  };
}

export const notFoundHandler: NotFoundHandler<AppEnv> = (c) =>
  c.json(envelope("not_found", "Resource not found.", c.get("requestId")), 404);

/**
 * Registers the 405 fallthrough for a path (api-contract: `method_not_allowed`
 * is "wrong method on a *known* route"). Hono matches in registration order, so
 * call this **after** the path's method handlers — they return first, and only
 * an unhandled method reaches this one.
 */
export function methodNotAllowed(app: Hono<AppEnv>, path: string): void {
  app.all(path, (c) => {
    throw new ApiError("method_not_allowed", `${c.req.method} is not allowed on this route.`);
  });
}
