import type { MiddlewareHandler } from "hono";
import { routePath } from "hono/route";
import { logRequest } from "../telemetry/logger";
import type { AppEnv } from "../types";

export interface RequestLogOptions {
  /**
   * Adds the User-Agent to the line. Redirect path only, during the pilot
   * (D21): those UAs are what the bot denylist is tuned from, and the API
   * surface has no such need. Opt-in so widening telemetry is a call site
   * someone had to write, never a default.
   */
  userAgent?: boolean;
}

/**
 * Emits the one structured line per request (PRD §15). Everything it passes on
 * is allowlisted by `logRequest`, so this middleware cannot widen telemetry.
 *
 * `routePath(c, -1)` is the *last* matched route — the handler's template. Plain
 * `routePath(c)` would return this middleware's own `*` pattern instead.
 */
export function createRequestLog(options: RequestLogOptions = {}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const startedAt = Date.now();

    await next();

    // Only the prefix, never the key: the prefix is the allowlisted identifier
    // (PRD §15) and is already stored in plaintext.
    const keyPrefix = c.get("key")?.prefix;
    const ua = options.userAgent === true ? c.req.header("User-Agent") : undefined;

    logRequest({
      request_id: c.get("requestId"),
      route: routePath(c, -1),
      method: c.req.method,
      status: c.res.status,
      latency_ms: Date.now() - startedAt,
      ...(keyPrefix === undefined ? {} : { key_prefix: keyPrefix }),
      ...(ua === undefined ? {} : { ua }),
    });
  };
}

/** The API surface's line: the narrow allowlist, no user-agent. */
export const requestLog = createRequestLog();
