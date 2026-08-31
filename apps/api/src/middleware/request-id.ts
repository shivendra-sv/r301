import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";

/**
 * Stamps `X-Request-Id` on every response — API and redirect surfaces alike
 * (design.md §8). Error envelopes and, later, log lines echo the same id.
 */
export const requestId: MiddlewareHandler<AppEnv> = async (c, next) => {
  const id = crypto.randomUUID();
  c.set("requestId", id);

  await next();

  c.res.headers.set("X-Request-Id", id);
};
