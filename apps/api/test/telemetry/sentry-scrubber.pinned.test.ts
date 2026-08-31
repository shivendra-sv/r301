// D23 pinned — never weaken or delete (CLAUDE.md hard rule).
//
// PRD §12 D23: "a unit test pins the Sentry `beforeSend` scrubber so an
// implementation session can't silently regress it." Every assertion below is
// a leak that would otherwise reach Sentry. Do not relax one to make a change
// pass — fix the scrubber instead.

import type { ErrorEvent } from "@sentry/cloudflare";
import { describe, expect, it } from "vitest";
import { scrubEvent, sentryOptions } from "../../src/telemetry/sentry";

const DESTINATION = "https://clinic.example.com/appt/9182?t=PATIENT_TOKEN";

/** An event carrying every category D23 forbids. */
function leakyEvent(): ErrorEvent {
  return {
    type: undefined,
    event_id: "abc",
    tags: { request_id: "3f6a1e0c-0000-4000-8000-000000000000" },
    request: {
      url: "https://api.r301.dev/v1/links?cursor=CURSOR_SECRET&external_id=appt_9182",
      query_string: "cursor=CURSOR_SECRET&external_id=appt_9182",
      method: "POST",
      data: { destination: DESTINATION, slug: "launch" },
      cookies: { session: "COOKIE_SECRET" },
      headers: {
        Authorization: "Bearer r301_live_AUTHSECRET",
        Cookie: "session=COOKIE_SECRET",
        "Content-Type": "application/json",
      },
    },
    extra: { destination: DESTINATION, note: "harmless" },
    breadcrumbs: [
      {
        type: "http",
        category: "fetch",
        data: { url: DESTINATION, method: "GET" },
      },
    ],
  } as unknown as ErrorEvent;
}

/** Every secret planted above. None may survive in any form. */
const SECRETS = [
  "PATIENT_TOKEN",
  "CURSOR_SECRET",
  "COOKIE_SECRET",
  "AUTHSECRET",
  "clinic.example.com",
  "appt_9182",
];

describe("Sentry beforeSend scrubber (D23)", () => {
  it("leaves no secret anywhere in the serialized event", () => {
    const scrubbed = JSON.stringify(scrubEvent(leakyEvent()));

    for (const secret of SECRETS) {
      expect(scrubbed).not.toContain(secret);
    }
  });

  it("removes the request body, query string, headers and cookies", () => {
    const scrubbed = scrubEvent(leakyEvent());

    expect(scrubbed?.request?.data).toBeUndefined();
    expect(scrubbed?.request?.query_string).toBeUndefined();
    expect(scrubbed?.request?.headers).toBeUndefined();
    expect(scrubbed?.request?.cookies).toBeUndefined();
  });

  it("reduces the request URL to origin and path, dropping the query", () => {
    const scrubbed = scrubEvent(leakyEvent());

    expect(scrubbed?.request?.url).toBe("https://api.r301.dev/v1/links");
  });

  it("strips forbidden keys from extra while keeping benign ones", () => {
    const scrubbed = scrubEvent(leakyEvent());

    expect(scrubbed?.extra).toEqual({ note: "harmless" });
  });

  // Dropped, not reduced: a breadcrumb URL is an outgoing fetch, so origin+path
  // would still name the destination host. D23 forbids that outright.
  it("drops URLs carried in breadcrumbs entirely", () => {
    const scrubbed = scrubEvent(leakyEvent());

    expect(scrubbed?.breadcrumbs?.[0]?.data).toEqual({ method: "GET" });
  });

  // The request id is the whole point of the envelope — it must survive.
  it("keeps the request_id tag", () => {
    const scrubbed = scrubEvent(leakyEvent());

    expect(scrubbed?.tags?.request_id).toBe("3f6a1e0c-0000-4000-8000-000000000000");
  });

  it("survives an event with no request, extra or breadcrumbs", () => {
    expect(() => scrubEvent({ event_id: "bare" } as unknown as ErrorEvent)).not.toThrow();
  });
});

const DSN = "https://publickey@o0.ingest.sentry.io/1";

describe("Sentry options (D23)", () => {
  it("wires the pinned scrubber as beforeSend", () => {
    expect(sentryOptions({ SENTRY_DSN: DSN })?.beforeSend).toBe(scrubEvent);
  });

  // The SDK's own defaults collect cookies, request/response headers, request
  // bodies and URL query params. Every one of those is forbidden by D23, so
  // each is switched off explicitly rather than left to a default that a
  // dependency upgrade could flip back.
  it("opts out of every permissive data-collection default", () => {
    expect(sentryOptions({ SENTRY_DSN: DSN })?.dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: { request: false, response: false },
      httpBodies: [],
      urlQueryParams: false,
    });
  });

  it("never samples traces (v1 is errors-only)", () => {
    expect(sentryOptions({ SENTRY_DSN: DSN })?.tracesSampleRate).toBe(0);
  });

  // design.md §9: absent DSN (local, tests) disables Sentry entirely.
  it("returns undefined when no DSN is configured", () => {
    expect(sentryOptions({})).toBeUndefined();
    expect(sentryOptions({ SENTRY_DSN: "" })).toBeUndefined();
  });
});
