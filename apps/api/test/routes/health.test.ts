import { describe, expect, it } from "vitest";
import { createApiApp } from "../../src/routes/api";
import type { Env } from "../../src/types";

/** Only the vars the health route reads; bindings are irrelevant to it. */
function env(overrides: Partial<Env> = {}): Env {
  return { ENVIRONMENT: "local", ...overrides } as Env;
}

function get(bindings: Env = env(), init?: RequestInit): Promise<Response> {
  return Promise.resolve(
    createApiApp().request("https://api.r301.dev/v1/health", init, bindings),
  );
}

describe("GET /v1/health (D25)", () => {
  it("returns status ok with the deploy version and environment", async () => {
    const res = await get(env({ ENVIRONMENT: "staging", GIT_SHA: "9f2c1ab" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", version: "9f2c1ab", env: "staging" });
  });

  it("mirrors whatever ENVIRONMENT is bound to", async () => {
    const res = await get(env({ ENVIRONMENT: "production" }));

    expect((await res.json<{ env: string }>()).env).toBe("production");
  });
});

describe("health version (D25 — 'which deploy broke it')", () => {
  it("reports the GIT_SHA stamped at deploy time", async () => {
    const res = await get(env({ GIT_SHA: "0732c7ef" }));

    expect((await res.json<{ version: string }>()).version).toBe("0732c7ef");
  });

  // Local dev and tests have no CI var to stamp.
  it("falls back to 'dev' when no GIT_SHA is bound", async () => {
    const res = await get(env());

    expect((await res.json<{ version: string }>()).version).toBe("dev");
  });
});

describe("health is unauthenticated (D25)", () => {
  // Pins the exemption ahead of prompt 06: when auth middleware lands, this
  // route must stay reachable without a key, and must not consult one.
  it("answers 200 with no Authorization header", async () => {
    expect((await get()).status).toBe(200);
  });

  it("answers 200 even when handed a bogus Authorization header", async () => {
    const res = await get(env(), { headers: { Authorization: "Bearer not-a-real-key" } });

    expect(res.status).toBe(200);
  });
});

describe("health method handling", () => {
  it("rejects a wrong method with the 405 envelope", async () => {
    const res = await get(env(), { method: "DELETE" });

    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({
      error: {
        code: "method_not_allowed",
        message: expect.any(String),
        request_id: res.headers.get("X-Request-Id"),
      },
    });
  });
});
