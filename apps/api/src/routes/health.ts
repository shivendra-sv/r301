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
  operationId: "getHealth",
  tags: ["Meta"],
  summary: "Liveness probe",
  security: [],
  description:
    "Reports that the Worker is serving, and which deploy is answering. **Unauthenticated** — a "
    + "probe that needed a key would fail whenever authentication did, which is exactly when you "
    + "need it to answer.\n\n"
    + "Reads configuration only: it deliberately touches neither the database nor the cache, so "
    + "a storage incident cannot take the probe down with it. It is a liveness check, not a "
    + "dependency check — a `200` here does not promise that writes are working.\n\n"
    + "`version` is the running deploy\u2019s git SHA, matching `info.version` in the OpenAPI "
    + "document served by the same deploy.",
  responses: {
    ...PUBLIC_ROUTE_ERRORS,
    200: jsonResponse(
      "The Worker is serving, with the deploy's version and environment.",
      healthSchema,
      { status: "ok", version: "047714d", env: "production" },
    ),
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
