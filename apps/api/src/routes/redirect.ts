import { Hono } from "hono";
import { requestId } from "../middleware/request-id";
import type { AppEnv } from "../types";

/**
 * The redirect surface (api-contract §Redirect host). Responses are minimal
 * plain text, never JSON — clients here are browsers, not API consumers.
 * The slug and housekeeping routes arrive in prompt 12; everything 404s today.
 */
export function createRedirectApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", requestId);

  app.notFound((c) => c.text("Not found", 404));

  return app;
}
