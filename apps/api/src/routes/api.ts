import { OpenAPIHono } from "@hono/zod-openapi";
import { createAuthMiddleware } from "../middleware/auth";
import { createErrorHandler, notFoundHandler } from "../middleware/errors";
import { createIdempotencyMiddleware } from "../middleware/idempotency";
import { jsonBody } from "../middleware/json-body";
import { requestLog } from "../middleware/request-log";
import { requestId } from "../middleware/request-id";
import { registerHealthRoute } from "./health";
import { registerLinkRoutes } from "./links";
import { apiErrorFromZod } from "../schemas/fields";
import { reportError } from "../telemetry/sentry";
import type { AppEnv } from "../types";

/**
 * The `/v1/*` surface (api-contract §Global conventions). All responses are
 * JSON; every error renders the canonical envelope. Routes are added by later
 * prompts — each one registering `methodNotAllowed` for its own path.
 */
export interface ApiAppOptions {
  /** Where unexpected failures are reported. Overridden in tests. */
  reportError?: (err: unknown) => void;
  /** Clock for auth's staleness window and the idempotency machine. Injected in tests. */
  now?: () => number;
}

export function createApiApp(options: ApiAppOptions = {}): OpenAPIHono<AppEnv> {
  // defaultHook turns every zod-openapi validation failure into the contract's
  // envelope — carrying the code the issue was tagged with (prompt 08), so a
  // reserved slug is 422 and an unknown field 400, from one parse.
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result) => {
      if (!result.success) {
        throw apiErrorFromZod(result.error);
      }
    },
  });

  app.use("*", requestId);
  app.use("*", requestLog);
  // Auth precedes body parsing deliberately: an unauthenticated caller should
  // never get their payload parsed. Costs nothing, and keeps unauthenticated
  // work to one indexed SELECT.
  app.use("*", createAuthMiddleware(options.now === undefined ? {} : { now: options.now }));
  app.use("*", jsonBody);

  registerHealthRoute(app);

  // Registered before the route it guards, so it wraps that handler (D18).
  // Prompt 17 adds `/v1/links/batch` to the same list.
  app.use(
    "/v1/links",
    createIdempotencyMiddleware(options.now === undefined ? {} : { now: options.now }),
  );
  registerLinkRoutes(app, options.now === undefined ? {} : { now: options.now });

  app.onError(createErrorHandler(options.reportError ?? reportError));
  app.notFound(notFoundHandler);

  return app;
}
