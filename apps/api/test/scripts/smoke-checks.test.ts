import { describe, expect, it } from "vitest";
import { runSmoke } from "../../scripts/smoke-checks";

const BASE = "https://api-staging.r301.dev";

function respondWith(body: string, status = 200): typeof globalThis.fetch {
  return (async () =>
    new Response(body, {
      status,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof globalThis.fetch;
}

describe("smoke v1 — health only (docs/testing.md §5)", () => {
  it("passes when health reports ok", async () => {
    const result = await runSmoke({
      apiBase: BASE,
      fetchImpl: respondWith(JSON.stringify({ status: "ok", version: "9f2c1ab", env: "staging" })),
    });

    expect(result).toEqual({ ok: true, failures: [] });
  });

  it("fails on a non-2xx status, naming the endpoint and the status", async () => {
    const result = await runSmoke({
      apiBase: BASE,
      fetchImpl: respondWith("upstream exploded", 503),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain("/v1/health");
    expect(result.failures[0]).toContain("503");
  });

  it("fails when the body reports a status other than ok", async () => {
    const result = await runSmoke({
      apiBase: BASE,
      fetchImpl: respondWith(JSON.stringify({ status: "degraded" })),
    });

    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain("degraded");
  });

  it("fails rather than throws when the body is not JSON", async () => {
    const result = await runSmoke({ apiBase: BASE, fetchImpl: respondWith("<html>nope</html>") });

    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(1);
  });

  it("fails rather than throws when the request cannot be made", async () => {
    const result = await runSmoke({
      apiBase: BASE,
      fetchImpl: (() => Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof globalThis.fetch,
    });

    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain("ECONNREFUSED");
  });

  // v1 is unauthenticated on purpose: it must run before runbook Phase C mints
  // any key (prompt 20 adds the authenticated lifecycle checks).
  it("requires no API key", async () => {
    let sawAuth = true;
    const result = await runSmoke({
      apiBase: BASE,
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        sawAuth = new Headers(init?.headers).has("Authorization");
        return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      }) as unknown as typeof globalThis.fetch,
    });

    expect(result.ok).toBe(true);
    expect(sawAuth).toBe(false);
  });
});
