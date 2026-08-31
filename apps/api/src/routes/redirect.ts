import { Hono } from "hono";
import { ApiError } from "../errors";
import { requestId } from "../middleware/request-id";
import { requestLog } from "../middleware/request-log";
import { reportError } from "../telemetry/sentry";
import type { AppEnv } from "../types";

export interface RedirectAppOptions {
  /** Where unexpected failures are reported. Overridden in tests. */
  reportError?: (err: unknown) => void;
}

/**
 * The redirect surface (api-contract §Redirect host). Responses are minimal
 * plain text, never JSON — clients here are browsers, not API consumers.
 * The slug and housekeeping routes arrive in prompt 12; everything 404s today.
 */
export function createRedirectApp(options: RedirectAppOptions = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const report = options.reportError ?? reportError;

  app.use("*", requestId);
  app.use("*", requestLog);

  // PRD §15 covers this path too, so a failure here is reported like any other
  // — but the body stays minimal text, and says nothing about the failure.
  app.onError((err, c) => {
    if (!(err instanceof ApiError)) {
      report(err);
    }

    return c.text("Internal error", 500);
  });

  app.notFound((c) => c.text("Not found", 404));

  return app;
}
