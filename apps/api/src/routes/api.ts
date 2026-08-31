import { Hono } from "hono";
import { errorHandler, notFoundHandler } from "../middleware/errors";
import { jsonBody } from "../middleware/json-body";
import { requestId } from "../middleware/request-id";
import type { AppEnv } from "../types";

/**
 * The `/v1/*` surface (api-contract §Global conventions). All responses are
 * JSON; every error renders the canonical envelope. Routes are added by later
 * prompts — each one registering `methodNotAllowed` for its own path.
 */
export function createApiApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", requestId);
  app.use("*", jsonBody);

  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  return app;
}
