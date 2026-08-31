import type { Hono } from "hono";
import { methodNotAllowed } from "../middleware/errors";
import type { AppEnv } from "../types";

/**
 * `GET /v1/health` (PRD D25, api-contract §health). Unauthenticated by design —
 * it is what the external probe hits, and what answers "which deploy broke it"
 * via the SHA. Reads vars only; it must not touch D1 or KV, so a storage outage
 * cannot take the probe down with it.
 */
export function registerHealthRoute(app: Hono<AppEnv>): void {
  app.get("/v1/health", (c) =>
    c.json({
      status: "ok",
      version: c.env.GIT_SHA ?? "dev",
      env: c.env.ENVIRONMENT,
    }),
  );

  // Registered after the GET handler — see methodNotAllowed's contract.
  methodNotAllowed(app, "/v1/health");
}
