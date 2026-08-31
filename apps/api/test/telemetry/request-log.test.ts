import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiApp } from "../../src/routes/api";
import { authHeaders, seedApiKey, testBindings } from "../helpers/auth";

let lines: string[];

beforeEach(() => {
  lines = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function parsed(): Record<string, unknown> {
  return JSON.parse(lines[0] as string) as Record<string, unknown>;
}

describe("per-request log line (PRD §15)", () => {
  function appWithLink() {
    const app = createApiApp();
    app.get("/v1/links/:slug", (c) => c.json({ slug: c.req.param("slug") }));
    return app;
  }

  async function callLink(): Promise<void> {
    const { key } = await seedApiKey();
    await appWithLink().request(
      "https://api.r301.dev/v1/links/aB3xY9k",
      { headers: authHeaders(key) },
      testBindings(),
    );
  }

  it("emits exactly one line for one request", async () => {
    await callLink();

    expect(lines).toHaveLength(1);
  });

  // The raw path carries the slug; the template is what may be logged.
  it("logs the route template, never the raw path", async () => {
    await callLink();

    expect(parsed().route).toBe("/v1/links/:slug");
    expect(lines[0]).not.toContain("aB3xY9k");
  });

  it("logs method, status, latency and the request id from the response", async () => {
    const { key, prefix } = await seedApiKey();
    const res = await appWithLink().request(
      "https://api.r301.dev/v1/links/aB3xY9k",
      { headers: authHeaders(key) },
      testBindings(),
    );

    expect(parsed()).toEqual({
      request_id: res.headers.get("X-Request-Id"),
      route: "/v1/links/:slug",
      method: "GET",
      status: 200,
      latency_ms: expect.any(Number),
      key_prefix: prefix,
    });
  });

  it("logs the error status when a route fails", async () => {
    const app = createApiApp();
    app.get("/v1/_boom", () => {
      throw new Error("kaboom");
    });

    const { key } = await seedApiKey();
    await app.request("https://api.r301.dev/v1/_boom", { headers: authHeaders(key) }, testBindings());

    expect(parsed().status).toBe(500);
  });
});

// Regression guard, not a new behaviour: an unmatched request logs the wildcard
// template. Swapping routePath() for c.req.path would put the raw slug in logs.
it("never logs the raw path, even when no route matched", async () => {
  const { key } = await seedApiKey();
  await createApiApp().request(
    "https://api.r301.dev/v1/links/SECRET_SLUG",
    { headers: authHeaders(key) },
    testBindings(),
  );

  expect(lines[0]).not.toContain("SECRET_SLUG");
  expect(parsed().route).toBe("/*");
});
