import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { methodNotAllowed } from "../middleware/errors";
import { PUBLIC_ROUTE_ERRORS } from "../schemas/error-envelope";
import { healthSchema, jsonResponse } from "../schemas/resources";
import type { AppEnv } from "../types";

/**
 * Declared with `createRoute` like every other route so it reaches the OpenAPI
 * document (prompt 19). It carries **no** `security`: this is one of the two
 * unauthenticated paths (design §4), and the document has to say so — a probe
 * that needed a key would be a probe that fails whenever auth does.
 */
export const healthRoute = createRoute({
  method: "get",
  path: "/v1/health",
  summary: "Liveness probe",
  security: [],
  responses: {
    ...PUBLIC_ROUTE_ERRORS,
    200: jsonResponse("The Worker is serving, with the deploy's version and environment.", healthSchema),
  },
});

/**
 * `GET /v1/health` (PRD D25, api-contract §health). Unauthenticated by design —
 * it is what the external probe hits, and what answers "which deploy broke it"
 * via the SHA. Reads vars only; it must not touch D1 or KV, so a storage outage
 * cannot take the probe down with it.
 */
export function registerHealthRoute(app: OpenAPIHono<AppEnv>): void {
  app.openapi(healthRoute, (c) =>
    c.json(
      {
        status: "ok",
        version: c.env.GIT_SHA ?? "dev",
        env: c.env.ENVIRONMENT,
      },
      200,
    ),
  );

  // Registered after the GET handler — see methodNotAllowed's contract.
  methodNotAllowed(app, "/v1/health");
}
