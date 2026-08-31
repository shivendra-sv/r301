import type { Context, MiddlewareHandler } from "hono";
import { findApiKeyByPrefix, touchApiKeyLastUsed } from "../db/queries";
import { ApiError } from "../errors";
import { hashKey, KEY_PATTERN, KEY_PREFIX_LENGTH } from "../services/keys";
import type { AppEnv } from "../types";

/** The only `/v1` routes served without a key (design.md §4, D25/D22). */
export const UNAUTHENTICATED_PATHS = new Set(["/v1/health", "/v1/openapi.json"]);

/** PRD §7.6: at most one `last_used_at` write per key per hour. */
const LAST_USED_STALE_AFTER_MS = 60 * 60 * 1000;

/**
 * Every failure is the same 401 with the same message. Distinguishing "unknown
 * prefix" from "wrong secret" from "revoked" would hand an attacker an oracle,
 * and v1 never answers 403 (api-contract).
 */
function unauthorized(): ApiError {
  return new ApiError("unauthorized", "A valid API key is required.");
}

/**
 * Constant-time compare of two hex digests. `timingSafeEqual` throws on
 * unequal lengths, so the length check comes first — a stored hash that is not
 * 64 hex characters is corrupt, and corrupt means unauthenticated.
 */
function digestsMatch(presented: string, stored: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(presented);
  const b = encoder.encode(stored);

  if (a.byteLength !== b.byteLength) {
    return false;
  }

  return crypto.subtle.timingSafeEqual(a, b);
}

/**
 * Runs a best-effort write through `waitUntil` when there is an execution
 * context, and awaits it otherwise. A real `fetch` always has one; the fallback
 * keeps the write correct rather than silently dropping it.
 *
 * Failures are swallowed on purpose: auth has already succeeded by this point,
 * and a transient D1 write error must not cost the caller their request.
 */
async function deferBestEffort(c: Context<AppEnv>, work: Promise<void>): Promise<void> {
  const settled = work.catch(() => undefined);

  try {
    c.executionCtx.waitUntil(settled);
  } catch {
    await settled;
  }
}

export interface AuthOptions {
  /** Injected so the staleness window is testable (docs/testing.md §2). */
  now?: () => number;
}

/** Enforces PRD §7.6 / design.md §4 on every `/v1` route but the exempt two. */
export function createAuthMiddleware(options: AuthOptions = {}): MiddlewareHandler<AppEnv> {
  const now = options.now ?? (() => Date.now());

  return async (c, next) => {
    if (UNAUTHENTICATED_PATHS.has(c.req.path)) {
      return next();
    }

    const header = c.req.header("Authorization") ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";

    // Shape is checked before touching D1, so a malformed key costs no query.
    if (!KEY_PATTERN.test(presented)) {
      throw unauthorized();
    }

    const prefix = presented.slice(0, KEY_PREFIX_LENGTH);
    const row = await findApiKeyByPrefix(c.env.DB, prefix);

    if (row === null) {
      throw unauthorized();
    }
    if (!digestsMatch(await hashKey(presented), row.key_hash)) {
      throw unauthorized();
    }
    if (row.revoked_at !== null) {
      throw unauthorized();
    }

    c.set("key", { id: row.id, environment: row.environment, prefix });

    const at = now();
    if (row.last_used_at === null || at - row.last_used_at > LAST_USED_STALE_AFTER_MS) {
      await deferBestEffort(c, touchApiKeyLastUsed(c.env.DB, row.id, at));
    }

    return next();
  };
}
