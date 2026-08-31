import { exports } from "cloudflare:workers";
import { authHeaders, seedApiKey, testBindings } from "./helpers/auth";
import { ApiError, ERROR_STATUS } from "../src/errors";
import { methodNotAllowed } from "../src/middleware/errors";
import { createApiApp } from "../src/routes/api";
import { createRedirectApp } from "../src/routes/redirect";
import { describe, expect, it } from "vitest";

// Global HTTP behaviours every route inherits (docs/api-contract.md §Global
// conventions, docs/design.md §1 + §8). Hosts are set explicitly: the surface
// split is by hostname (design.md §1).
const API_HOST = "api.r301.dev";
const REDIRECT_HOST = "r301.dev";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function request(host: string, path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(new Request(`https://${host}${path}`, init));
}

/** Same, but authenticated — every /v1 route needs a key from prompt 06 on. */
async function authedRequest(host: string, path: string, init: RequestInit = {}) {
  const { key } = await seedApiKey();

  return request(host, path, {
    ...init,
    headers: { ...authHeaders(key), ...(init.headers ?? {}) },
  });
}

describe("X-Request-Id (design.md §8)", () => {
  it("stamps a UUID on an API-surface 404", async () => {
    const res = await request(API_HOST, "/v1/nope");

    expect(res.headers.get("X-Request-Id")).toMatch(UUID);
  });

  it("stamps a UUID on a redirect-surface 404", async () => {
    const res = await request(REDIRECT_HOST, "/nope");

    expect(res.headers.get("X-Request-Id")).toMatch(UUID);
  });

  it("issues a distinct id per request", async () => {
    const [a, b] = await Promise.all([request(API_HOST, "/v1/a"), request(API_HOST, "/v1/b")]);

    expect(a.headers.get("X-Request-Id")).not.toBe(b.headers.get("X-Request-Id"));
  });
});

describe("error envelope (api-contract §Error envelope)", () => {
  it("renders an unknown /v1 path as a 404 not_found envelope", async () => {
    const res = await authedRequest(API_HOST, "/v1/nope");

    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toMatch(/^application\/json/);
    expect(await res.json()).toEqual({
      error: {
        code: "not_found",
        message: expect.any(String),
        request_id: res.headers.get("X-Request-Id"),
      },
    });
  });

  it("omits `field` when no single field is at fault", async () => {
    const res = await authedRequest(API_HOST, "/v1/nope");
    const body = await res.json<{ error: Record<string, unknown> }>();

    expect(body.error).not.toHaveProperty("field");
  });
});

// Pins the canonical table in docs/api-contract.md §Error envelope. Codes
// reserved for P1 (forbidden, destination_blocked, rate_limited) are carried
// now so later prompts add routes, not statuses.
describe("code to status table", () => {
  it("matches the api-contract table exactly", () => {
    expect(ERROR_STATUS).toEqual({
      invalid_request: 400,
      unauthorized: 401,
      forbidden: 403,
      not_found: 404,
      method_not_allowed: 405,
      slug_taken: 409,
      idempotency_conflict: 409,
      slug_reserved: 422,
      destination_invalid: 422,
      destination_blocked: 422,
      rate_limited: 429,
      internal: 500,
    });
  });
});

describe("surface split by hostname (design.md §1)", () => {
  it.each([
    ["r301.dev", "/nope"],
    ["staging.r301.dev", "/nope"],
  ])("answers an unknown path on redirect host %s with plain text", async (host, path) => {
    const res = await request(host, path);

    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toMatch(/^text\/plain/);
  });

  it.each(["api.r301.dev", "api-staging.r301.dev"])(
    "answers an unknown path on API host %s with a JSON envelope",
    async (host) => {
      const res = await request(host, "/v1/nope");

      expect(res.headers.get("Content-Type")).toMatch(/^application\/json/);
    },
  );

  // A redirect host serves slugs only — `/v1/...` is just a path that no slug matches.
  it("does not mount the API surface on a redirect host", async () => {
    const res = await request(REDIRECT_HOST, "/v1/nope");

    expect(res.headers.get("Content-Type")).toMatch(/^text\/plain/);
  });

  // An API host serves /v1 only — a bare path is not a slug lookup.
  it("does not treat a bare path on an API host as a slug", async () => {
    const res = await request(API_HOST, "/somethingelse");

    expect(res.headers.get("Content-Type")).toMatch(/^application\/json/);
  });

  // design.md §1: local and tests reach both surfaces on any host. `/v1` is
  // reserved and slugs are single-segment, so the two never collide.
  it("serves both surfaces on an unrecognised host", async () => {
    const api = await request("127.0.0.1:8787", "/v1/nope");
    const redirect = await request("127.0.0.1:8787", "/nope");

    expect(api.headers.get("Content-Type")).toMatch(/^application\/json/);
    expect(redirect.headers.get("Content-Type")).toMatch(/^text\/plain/);
  });
});

// No real /v1 route exists yet (prompt 05+), so 405 is proven against a
// throwaway route on a real API app — the prompt sanctions test-only wiring.
describe("405 on a known route shape", () => {
  function appWithProbe() {
    const app = createApiApp();
    app.get("/v1/_probe", (c) => c.json({ ok: true }));
    methodNotAllowed(app, "/v1/_probe");
    return app;
  }

  it("serves the registered method normally", async () => {
    const { key } = await seedApiKey();
    const res = await appWithProbe().request(
      "https://api.r301.dev/v1/_probe",
      { headers: authHeaders(key) },
      testBindings(),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Request-Id")).toMatch(UUID);
  });

  it("rejects an unregistered method with a method_not_allowed envelope", async () => {
    const { key } = await seedApiKey();
    const res = await appWithProbe().request(
      "https://api.r301.dev/v1/_probe",
      { method: "DELETE", headers: authHeaders(key) },
      testBindings(),
    );

    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({
      error: {
        code: "method_not_allowed",
        message: expect.any(String),
        request_id: res.headers.get("X-Request-Id"),
      },
    });
  });

  it("still 404s a path that was never registered", async () => {
    const { key } = await seedApiKey();
    const res = await appWithProbe().request(
      "https://api.r301.dev/v1/_absent",
      { method: "DELETE", headers: authHeaders(key) },
      testBindings(),
    );

    expect(res.status).toBe(404);
  });
});

// JSON-only (api-contract §Global conventions). Proven against a throwaway
// route so the guard, not a route's own parsing, is what answers.
describe("JSON-only enforcement", () => {
  function appWithEcho() {
    const app = createApiApp();
    app.post("/v1/_echo", async (c) => c.json({ received: await c.req.json() }));
    return app;
  }

  // fetch() stamps `text/plain` on a string body, so an absent Content-Type has
  // to be built by deleting the header off the constructed Request.
  async function post(body: string, contentType?: string): Promise<Response> {
    const { key } = await seedApiKey();
    const req = new Request("https://api.r301.dev/v1/_echo", { method: "POST", body });
    req.headers.set("Authorization", `Bearer ${key}`);
    if (contentType === undefined) {
      req.headers.delete("Content-Type");
    } else {
      req.headers.set("Content-Type", contentType);
    }

    return await appWithEcho().request(req, undefined, testBindings());
  }

  it("rejects a body sent without a Content-Type", async () => {
    const res = await post('{"a":1}');

    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({
      error: {
        code: "invalid_request",
        message: expect.any(String),
        request_id: res.headers.get("X-Request-Id"),
      },
    });
  });

  it("rejects a body sent as a non-JSON Content-Type", async () => {
    const res = await post("a=1", "application/x-www-form-urlencoded");

    expect(res.status).toBe(415);
  });

  it("accepts a JSON Content-Type carrying a charset", async () => {
    const res = await post('{"a":1}', "application/json; charset=utf-8");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: { a: 1 } });
  });

  it("rejects malformed JSON with 400 invalid_request", async () => {
    const res = await post("{not json", "application/json");

    expect(res.status).toBe(400);
    expect(await res.json<{ error: { code: string } }>()).toMatchObject({
      error: { code: "invalid_request" },
    });
  });
});

describe("unhandled errors", () => {
  const SECRET = "postgres://user:hunter2@db.internal/records";

  function appWithBoom() {
    const app = createApiApp();
    app.get("/v1/_boom", () => {
      throw new Error(`connection to ${SECRET} failed`);
    });
    return app;
  }

  async function callBoom(): Promise<Response> {
    const { key } = await seedApiKey();

    return await appWithBoom().request(
      "https://api.r301.dev/v1/_boom",
      { headers: authHeaders(key) },
      testBindings(),
    );
  }

  it("renders a thrown error as a 500 internal envelope", async () => {
    const res = await callBoom();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: {
        code: "internal",
        message: expect.any(String),
        request_id: res.headers.get("X-Request-Id"),
      },
    });
  });

  // D23's spirit at the HTTP edge: the client is told nothing about the failure.
  it("leaks neither the thrown message nor a stack trace", async () => {
    const res = await callBoom();
    const body = await res.text();

    expect(body).not.toContain(SECRET);
    expect(body).not.toContain("hunter2");
    expect(body).not.toMatch(/\bat .+:\d+:\d+/);
  });

  it("still carries X-Request-Id on the 500", async () => {
    const res = await callBoom();

    expect(res.headers.get("X-Request-Id")).toMatch(UUID);
  });
});

// The throw-based path every later route uses: routes raise an ApiError and the
// handler renders it, so no route builds an envelope by hand.
describe("thrown ApiError", () => {
  function appThrowing(error: ApiError) {
    const app = createApiApp();
    app.get("/v1/_raise", () => {
      throw error;
    });
    return app;
  }

  it("renders with the status from the code table and the faulting field", async () => {
    const { key } = await seedApiKey();
    const res = await appThrowing(
      new ApiError("slug_taken", "Slug 'launch' is already in use.", "slug"),
    ).request("https://api.r301.dev/v1/_raise", { headers: authHeaders(key) }, testBindings());

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: {
        code: "slug_taken",
        message: "Slug 'launch' is already in use.",
        field: "slug",
        request_id: res.headers.get("X-Request-Id"),
      },
    });
  });

  it("omits field when the error names none", async () => {
    const { key } = await seedApiKey();
    const res = await appThrowing(new ApiError("unauthorized", "Missing API key.")).request(
      "https://api.r301.dev/v1/_raise",
      { headers: authHeaders(key) },
      testBindings(),
    );

    expect(res.status).toBe(401);
    expect((await res.json<{ error: object }>()).error).not.toHaveProperty("field");
  });
});

// The redirect surface answers browsers, so no error path may hand back JSON.
// Hono's default handler already returns text; this pins that, since a future
// upgrade changing it would silently break the contract above.
describe("redirect surface errors", () => {
  it("renders an unexpected error as plain text carrying a request id", async () => {
    const app = createRedirectApp();
    app.get("/boom", () => {
      throw new Error("kaboom at db.internal");
    });

    const res = await app.request("https://r301.dev/boom");

    expect(res.status).toBe(500);
    expect(res.headers.get("Content-Type")).toMatch(/^text\/plain/);
    expect(res.headers.get("X-Request-Id")).toMatch(UUID);
    expect(await res.text()).not.toContain("kaboom");
  });
});
