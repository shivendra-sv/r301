import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { methodNotAllowed } from "../middleware/errors";
import { PUBLIC_ROUTE_ERRORS } from "../schemas/error-envelope";
import type { AppEnv } from "../types";

/** Applied to every operation by default; the two exempt paths opt out. */
export const BEARER_SCHEME_NAME = "bearerAuth";

export const OPENAPI_DOCUMENT_PATH = "/v1/openapi.json";

/**
 * `GET /v1/openapi.json` (PRD §8, D22). Served with `doc31` rather than `doc`:
 * the PRD asks for OpenAPI **3.1**, and `doc` emits 3.0.
 *
 * The config is a function of the request so `info.version` can read the
 * binding — it is the same string `GET /v1/health` reports, so a document and a
 * probe pulled from one deploy can never disagree about which deploy they are.
 */
export function registerOpenApiRoute(app: OpenAPIHono<AppEnv>): void {
  app.openAPIRegistry.registerComponent("securitySchemes", BEARER_SCHEME_NAME, {
    type: "http",
    scheme: "bearer",
    description:
      "An API key minted by `pnpm mint-key`, sent as `Authorization: Bearer r301_live_…`.",
  });

  // `doc31` registers the Hono handler but adds nothing to the registry, so the
  // document would omit itself. Registering the path (not a second handler)
  // makes it self-describing, which is what lets the security cross-check
  // compare against the auth middleware's exempt list with no special case.
  app.openAPIRegistry.registerPath({
    method: "get",
    path: OPENAPI_DOCUMENT_PATH,
    summary: "This document",
    security: [],
    responses: {
      ...PUBLIC_ROUTE_ERRORS,
      200: {
        description: "The OpenAPI 3.1 description of this API.",
        content: {
          // Loose on purpose: the body is an OpenAPI document, and restating
          // that specification inside itself would be a second copy of it to
          // maintain. The one field worth promising is which version it is.
          "application/json": { schema: z.looseObject({ openapi: z.string() }) },
        },
      },
    },
  });

  app.doc31(OPENAPI_DOCUMENT_PATH, (c) => ({
    openapi: "3.1.0",
    info: {
      title: "r301.dev API",
      version: c.env.GIT_SHA ?? "dev",
      description:
        "API-first URL shortener. Every /v1 route but health and this document requires a bearer API key.",
    },
    servers: [{ url: "https://api.r301.dev", description: "production" }],
    // Document-level default, deliberately: a route added without thinking
    // about auth is documented as authenticated, which is what the middleware
    // actually does to it. Opting out is the explicit act (`security: []`).
    security: [{ [BEARER_SCHEME_NAME]: [] }],
  }));

  methodNotAllowed(app, OPENAPI_DOCUMENT_PATH);
}
