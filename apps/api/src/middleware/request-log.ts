import type { MiddlewareHandler } from "hono";
import { routePath } from "hono/route";
import { logRequest } from "../telemetry/logger";
import type { AppEnv } from "../types";

/**
 * Emits the one structured line per request (PRD §15). Everything it passes on
 * is allowlisted by `logRequest`, so this middleware cannot widen telemetry.
 *
 * `routePath(c, -1)` is the *last* matched route — the handler's template. Plain
 * `routePath(c)` would return this middleware's own `*` pattern instead.
 */
export const requestLog: MiddlewareHandler<AppEnv> = async (c, next) => {
  const startedAt = Date.now();

  await next();

  logRequest({
    request_id: c.get("requestId"),
    route: routePath(c, -1),
    method: c.req.method,
    status: c.res.status,
    latency_ms: Date.now() - startedAt,
  });
};
