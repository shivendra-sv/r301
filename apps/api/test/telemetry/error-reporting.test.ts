import { exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/errors";
import { createApiApp } from "../../src/routes/api";
import { createRedirectApp } from "../../src/routes/redirect";
import { authHeaders, seedApiKey, testBindings } from "../helpers/auth";

describe("error reporting to Sentry", () => {
  function appReporting(thrown: unknown) {
    const reported: unknown[] = [];
    const app = createApiApp({
      reportError: (err) => {
        reported.push(err);
      },
    });
    app.get("/v1/_raise", () => {
      throw thrown;
    });

    return { app, reported };
  }

  it("reports an unexpected error", async () => {
    const { app, reported } = appReporting(new Error("kaboom"));
    const { key } = await seedApiKey();

    const res = await app.request(
      "https://api.r301.dev/v1/_raise",
      { headers: authHeaders(key) },
      testBindings(),
    );

    expect(res.status).toBe(500);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toBeInstanceOf(Error);
  });

  // Expected, handled outcomes are not incidents — they would drown the signal.
  it("does not report an expected ApiError", async () => {
    const { app, reported } = appReporting(new ApiError("slug_taken", "Slug taken.", "slug"));
    const { key } = await seedApiKey();

    const res = await app.request(
      "https://api.r301.dev/v1/_raise",
      { headers: authHeaders(key) },
      testBindings(),
    );

    expect(res.status).toBe(409);
    expect(reported).toEqual([]);
  });

  // design.md §9: no DSN locally means Sentry is never initialised, and the
  // Worker must serve exactly as it would with one.
  it("serves normally with no DSN configured", async () => {
    const { key } = await seedApiKey();
    const res = await exports.default.fetch(
      new Request("https://api.r301.dev/v1/nope", { headers: authHeaders(key) }),
    );

    expect(res.status).toBe(404);
    expect(await res.json<{ error: { code: string } }>()).toMatchObject({
      error: { code: "not_found" },
    });
  });
});

// PRD §15: "Sentry for exceptions (API + redirect path)". The hot path must not
// be the one surface that fails silently.
describe("redirect surface telemetry", () => {
  it("reports an unexpected error and still answers in plain text", async () => {
    const reported: unknown[] = [];
    const app = createRedirectApp({
      reportError: (err) => {
        reported.push(err);
      },
    });
    app.get("/boom", () => {
      throw new Error("kaboom");
    });

    const res = await app.request("https://r301.dev/boom");

    expect(res.status).toBe(500);
    expect(res.headers.get("Content-Type")).toMatch(/^text\/plain/);
    expect(await res.text()).not.toContain("kaboom");
    expect(reported).toHaveLength(1);
  });

  it("emits one log line per redirect-surface request", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });

    // Bindings are required from prompt 12 on: `/nope` is slug-shaped, so it
    // is a real KV/D1 lookup rather than a bare 404.
    await createRedirectApp().request("https://r301.dev/nope", undefined, testBindings());
    spy.mockRestore();

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toMatchObject({ method: "GET", status: 404 });
  });
});
