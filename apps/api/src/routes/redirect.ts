import { Hono, type Context } from "hono";
import { findLinkBySlug } from "../db/queries";
import { ApiError } from "../errors";
import { getRedirect, putRedirect, redirectEntryFor, type RedirectEntry } from "../kv/redirects-cache";
import { requestId } from "../middleware/request-id";
import { createRequestLog } from "../middleware/request-log";
import { SLUG_PATTERN } from "../schemas/fields";
import { recordClick, shouldCount } from "../services/counting";
import { evaluateRedirect, NOT_FOUND_CACHE_CONTROL } from "../services/redirect";
import { reportError } from "../telemetry/sentry";
import type { AppEnv } from "../types";

/** D29: the apex keeps its redirect role; `/` sends visitors to the site. */
const MARKETING_SITE = "https://www.r301.dev/";

const TEXT_PLAIN = "text/plain; charset=UTF-8";

/**
 * A HEAD is a GET with the body withheld (PRD §7.5) — status and headers must
 * match exactly, which is why every response is built through here.
 */
function respond(
  c: Context<AppEnv>,
  status: number,
  cacheControl: string,
  body: string | null,
  extra: Record<string, string> = {},
): Response {
  const headers: Record<string, string> = { "Cache-Control": cacheControl, ...extra };

  if (body !== null) {
    headers["Content-Type"] = TEXT_PLAIN;
  }

  return new Response(c.req.method === "HEAD" ? null : body, { status, headers });
}

function notFound(c: Context<AppEnv>): Response {
  return respond(c, 404, NOT_FOUND_CACHE_CONTROL, "Not found");
}

/**
 * Hands work to the platform to finish after the response is sent. Awaiting the
 * *deferral* costs nothing when there is an execution context; without one —
 * which is tests — it degrades to awaiting the work itself. `work` must already
 * handle its own failures: nothing here may reject into the response path.
 */
function defer(c: Context<AppEnv>, work: Promise<unknown>): Promise<unknown> {
  try {
    c.executionCtx.waitUntil(work);

    return Promise.resolve();
  } catch {
    return work;
  }
}

/** Backfill is housekeeping, so it never blocks the response and never fails one. */
async function deferBackfill(c: Context<AppEnv>, slug: string, entry: RedirectEntry): Promise<void> {
  await defer(c, putRedirect(c.env.REDIRECTS, slug, entry).catch(() => undefined));
}

/**
 * PRD §7.4: counting is asynchronous and best-effort — the response is already
 * decided by the time this runs, and nothing here may change or delay it.
 *
 * A dropped count is a hole in the pilot's wedge metric rather than a broken
 * redirect, so the failure is reported instead of swallowed (design §7): silent
 * loss is exactly what makes the D21 drift number a lie.
 */
async function deferCount(
  c: Context<AppEnv>,
  slug: string,
  report: (err: unknown) => void,
): Promise<void> {
  if (!shouldCount(c.req.method, c.req.header("User-Agent") ?? null)) {
    return;
  }

  await defer(c, recordClick(c.env.DB, slug, Date.now()).catch(report));
}

function createServeSlug(report: (err: unknown) => void) {
  return async function serveSlug(c: Context<AppEnv>): Promise<Response> {
    // The generic Context is not tied to the path, so this is optional to TS;
    // an empty slug fails the pattern below and 404s like any other miss.
    const slug = c.req.param("slug") ?? "";

    // Exact, single-segment match (D17). `/abc/` and `/a/b` never reach here.
    if (!SLUG_PATTERN.test(slug)) {
      return notFound(c);
    }

    let entry = await getRedirect(c.env.REDIRECTS, slug);

    if (entry === null) {
      const row = await findLinkBySlug(c.env.DB, slug);

      // No row, or a tombstone (D15): 404 with **no** KV write. Negative caching
      // would let a slug scanner burn the 1k/day write budget (D20).
      if (row === null || row.deleted_at !== null) {
        return notFound(c);
      }

      entry = redirectEntryFor(row);
      // Any live row is backfilled, whatever its serving state — KV mirrors D1.
      await deferBackfill(c, slug, entry);
    }

    const decision = evaluateRedirect(entry, Date.now());

    if (decision.kind === "notFound") {
      return notFound(c);
    }
    if (decision.kind === "gone") {
      // Deliberately says what happened (D17): the recipient of a stale
      // transactional link is helped, and a random slug learns nothing.
      return respond(c, 410, decision.cacheControl, "This link has expired.");
    }

    // Only a successful 30x reaches here — the 404 and 410 exits above already
    // returned, which is what makes "successful GETs only" structural (PRD §7.4).
    await deferCount(c, slug, report);

    return respond(c, decision.status, decision.cacheControl, null, { Location: decision.location });
  };
}

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
  // The UA rides along on this surface only (D21): it is the input the bot
  // denylist is tuned from during the pilot. D23 is unchanged — destinations,
  // bodies, query strings and auth headers still never appear.
  app.use("*", createRequestLog({ userAgent: true }));

  // PRD §15 covers this path too, so a failure here is reported like any other
  // — but the body stays minimal text, and says nothing about the failure.
  app.onError((err, c) => {
    if (!(err instanceof ApiError)) {
      report(err);
    }

    return c.text("Internal error", 500);
  });

  // Housekeeping first (design §2 step 1), so these names are never treated
  // as slugs — `robots.txt` would fail the slug pattern anyway, but ordering
  // is what makes that a fact rather than a coincidence.
  app.on(["GET", "HEAD"], "/", (c) =>
    respond(c, 302, "no-store", null, { Location: MARKETING_SITE }),
  );
  app.on(["GET", "HEAD"], "/robots.txt", (c) =>
    respond(c, 200, "public, max-age=86400", "User-agent: *\nDisallow: /\n"),
  );
  app.on(["GET", "HEAD"], "/favicon.ico", (c) => respond(c, 204, "public, max-age=86400", null));

  app.on(["GET", "HEAD"], "/:slug", createServeSlug(report));

  // Registered after the method handlers, so only an unhandled method lands
  // here (the same contract as the API surface's methodNotAllowed).
  app.all("/:slug", (c) => respond(c, 405, "no-store", "Method not allowed"));
  app.all("/", (c) => respond(c, 405, "no-store", "Method not allowed"));

  app.notFound((c) => notFound(c));

  return app;
}
