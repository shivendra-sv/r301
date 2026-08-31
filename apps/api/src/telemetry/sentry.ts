// D23 pinned — never weaken or delete (CLAUDE.md hard rule).
// Enforced by test/telemetry/sentry-scrubber.pinned.test.ts.

import { captureException } from "@sentry/cloudflare";
import type { Breadcrumb, CloudflareOptions, ErrorEvent } from "@sentry/cloudflare";
import type { Env } from "../types";

/**
 * Keys that may never leave the Worker (PRD §12 D23). Matched case-insensitively
 * against every key in the free-form bags Sentry attaches to an event.
 */
const FORBIDDEN_KEYS = new Set([
  "authorization",
  "body",
  "cookie",
  "cookies",
  "data",
  "destination",
  "headers",
  "query",
  "query_string",
  "search",
  "url",
]);

/** Reduces any URL to origin + path — the query string is the leak vector. */
function stripQuery(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    // Not a parseable URL, so we cannot prove it is safe to keep.
    return "";
  }
}

function withoutForbiddenKeys(bag: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(bag).filter(([key]) => !FORBIDDEN_KEYS.has(key.toLowerCase())),
  );
}

/**
 * Breadcrumb URLs are dropped outright, not reduced. A breadcrumb URL is
 * typically an *outgoing* fetch — i.e. a destination — and PRD §12 D23 says
 * destination URLs never reach Sentry at all. Origin + path would still name
 * the destination host, so reducing is not enough here.
 */
function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb {
  if (crumb.data === undefined) {
    return crumb;
  }

  return { ...crumb, data: withoutForbiddenKeys(crumb.data) };
}

/**
 * The `beforeSend` hook (design.md §9). Strips request bodies, query strings,
 * headers and cookies, reduces every URL to origin + path, and drops forbidden
 * keys from the free-form bags — while keeping the `request_id` tag, which is
 * the only handle tying a Sentry event back to a response and a log line.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent | null {
  const scrubbed: ErrorEvent = { ...event };

  if (scrubbed.request !== undefined) {
    const { url, method } = scrubbed.request;

    // Rebuilt field by field: anything the SDK adds later is dropped by default.
    scrubbed.request = {
      ...(url === undefined ? {} : { url: stripQuery(url) }),
      ...(method === undefined ? {} : { method }),
    };
  }

  if (scrubbed.extra !== undefined) {
    scrubbed.extra = withoutForbiddenKeys(scrubbed.extra);
  }

  if (scrubbed.contexts !== undefined) {
    scrubbed.contexts = withoutForbiddenKeys(scrubbed.contexts) as NonNullable<
      ErrorEvent["contexts"]
    >;
  }

  if (scrubbed.breadcrumbs !== undefined) {
    scrubbed.breadcrumbs = scrubbed.breadcrumbs.map(scrubBreadcrumb);
  }

  return scrubbed;
}

/**
 * SDK options, or `undefined` to disable Sentry entirely — which is what an
 * absent DSN means locally and in tests (design.md §9). `withSentry` accepts
 * `undefined` from its options callback, so nothing is initialised and every
 * capture is a no-op: no throw, no fetch.
 *
 * `dataCollection` is spelled out rather than defaulted. The SDK's defaults
 * collect cookies, request and response headers, request bodies and URL query
 * params — every one of them forbidden by D23.
 */
export function sentryOptions(env: Pick<Env, "SENTRY_DSN">): CloudflareOptions | undefined {
  if (env.SENTRY_DSN === undefined || env.SENTRY_DSN === "") {
    return undefined;
  }

  return {
    dsn: env.SENTRY_DSN,
    // v1 is errors-only; tracing stays off (design.md §9).
    tracesSampleRate: 0,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: false, response: false },
      httpBodies: [],
      urlQueryParams: false,
    },
    beforeSend: scrubEvent,
  };
}

/**
 * Reports an unexpected failure. With no DSN the SDK was never initialised and
 * this is a no-op — no throw, no outbound fetch (design.md §9).
 */
export function reportError(err: unknown): void {
  captureException(err);
}
