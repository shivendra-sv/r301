import type { Context, MiddlewareHandler } from "hono";
import { ApiError } from "../errors";
import {
  finalize,
  hashBody,
  MAX_KEY_LENGTH,
  purgeExpired,
  release,
  reserve,
  type Reservation,
} from "../services/idempotency";
import type { AppEnv } from "../types";

/** Only bodied creates are idempotent (design §5); reads need no reservation. */
const IDEMPOTENT_METHODS = new Set(["POST"]);

/**
 * Runs the purge off the response path when there is an execution context, and
 * inline otherwise so it still happens under `app.request()` in tests. Failures
 * are swallowed: housekeeping must never cost a caller their response.
 */
async function deferPurge(c: Context<AppEnv>, at: number): Promise<void> {
  const work = purgeExpired(c.env.DB, at).catch(() => undefined);

  try {
    c.executionCtx.waitUntil(work);
  } catch {
    await work;
  }
}

export interface IdempotencyOptions {
  /** Injected so the 24 h window and 60 s takeover are testable. */
  now?: () => number;
}

/**
 * The design §5 state machine, wrapping the route handler. It sits after auth
 * (the key scopes the reservation) and after the JSON guard (a request that
 * cannot be served should not reserve), but before validation — a body that
 * fails the schema reserves and then releases, which is the same net effect as
 * any other failed execution.
 */
export function createIdempotencyMiddleware(
  options: IdempotencyOptions = {},
): MiddlewareHandler<AppEnv> {
  const now = options.now ?? (() => Date.now());

  return async (c, next) => {
    const header = c.req.header("Idempotency-Key");

    if (header === undefined || !IDEMPOTENT_METHODS.has(c.req.method)) {
      return next();
    }

    if (header.length === 0 || header.length > MAX_KEY_LENGTH) {
      throw new ApiError(
        "invalid_request",
        `Idempotency-Key must be between 1 and ${MAX_KEY_LENGTH} characters.`,
        "Idempotency-Key",
      );
    }

    const apiKey = c.get("key");

    if (apiKey === undefined) {
      // Unreachable: auth runs first and this path is never exempt.
      throw new ApiError("unauthorized", "A valid API key is required.");
    }

    const at = now();
    const reservation: Reservation = {
      db: c.env.DB,
      key: header,
      apiKeyId: apiKey.id,
      // Raw bytes, read before any schema sees them (D26 item 8). Hono has
      // already cached the body text, so this re-reads nothing.
      hash: await hashBody(await c.req.text()),
      now: at,
    };

    const reserved = await reserve(reservation);

    if (reserved.outcome === "conflict") {
      throw new ApiError("idempotency_conflict", reserved.message);
    }

    if (reserved.outcome === "replay") {
      c.res = new Response(reserved.body, {
        status: reserved.status,
        headers: { "Content-Type": "application/json", "Idempotency-Replayed": "true" },
      });

      return;
    }

    await deferPurge(c, at);

    try {
      await next();
    } catch (err) {
      // Includes the awaited-KV-put 500 and any schema rejection.
      await release(reservation);
      throw err;
    }

    if (c.res.status < 400) {
      await finalize(reservation, c.res.status, await c.res.clone().text());
    } else {
      await release(reservation);
    }
  };
}
