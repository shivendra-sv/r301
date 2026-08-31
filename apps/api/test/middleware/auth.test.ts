import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env as testEnv } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { createApiApp } from "../../src/routes/api";
import { generateKey, type GeneratedKey } from "../../src/services/keys";
import type { Env } from "../../src/types";

const HOUR_MS = 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

interface SeededKey extends GeneratedKey {
  id: number;
}

async function seedKey(
  options: { revokedAt?: number; lastUsedAt?: number; environment?: string } = {},
): Promise<SeededKey> {
  const generated = await generateKey("live");
  const row = await testEnv.DB.prepare(
    `INSERT INTO api_keys (prefix, key_hash, name, environment, created_at, revoked_at, last_used_at)
     VALUES (?1, ?2, 'pilot key', ?3, 0, ?4, ?5) RETURNING id`,
  )
    .bind(
      generated.prefix,
      generated.hash,
      options.environment ?? "live",
      options.revokedAt ?? null,
      options.lastUsedAt ?? null,
    )
    .first<{ id: number }>();

  return { ...generated, id: row?.id as number };
}

/** The real API app plus a stub route that reports the attached key context. */
function protectedApp(now: () => number = () => NOW) {
  const app = createApiApp({ now });
  app.get("/v1/_probe", (c) => c.json({ key: c.get("key") ?? null }));

  return app;
}

function bindings(): Env {
  return { DB: testEnv.DB, ENVIRONMENT: "local" } as Env;
}

function callProbe(headers: Record<string, string> = {}): Promise<Response> {
  return Promise.resolve(
    protectedApp().request("https://api.r301.dev/v1/_probe", { headers }, bindings()),
  );
}

function bearer(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}` };
}

async function expectUnauthorized(res: Response): Promise<void> {
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({
    error: {
      code: "unauthorized",
      message: expect.any(String),
      request_id: res.headers.get("X-Request-Id"),
    },
  });
}

describe("auth middleware — rejected requests (PRD §7.6, design.md §4)", () => {
  it("rejects a request with no Authorization header", async () => {
    await expectUnauthorized(await callProbe());
  });

  it.each([
    ["a non-Bearer scheme", { Authorization: "Basic cjMwMV9saXZl" }],
    ["a bare key with no scheme", { Authorization: `r301_live_${"a".repeat(32)}` }],
    ["an empty Bearer value", { Authorization: "Bearer " }],
    ["a malformed key shape", { Authorization: "Bearer not-a-key" }],
    ["a key with the wrong marker", { Authorization: `Bearer r301_prod_${"a".repeat(32)}` }],
  ])("rejects %s", async (_name, headers) => {
    await expectUnauthorized(await callProbe(headers));
  });

  // D10 keeps auth to one indexed SELECT; a malformed shape should not spend it.
  it("does not query D1 for a malformed key shape", async () => {
    const spy = vi.spyOn(testEnv.DB, "prepare");

    await callProbe({ Authorization: "Bearer not-a-key" });

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("rejects a well-formed key whose prefix is unknown", async () => {
    const stranger = await generateKey("live");

    await expectUnauthorized(await callProbe(bearer(stranger.key)));
  });

  // The dangerous case: right prefix, wrong secret.
  it("rejects a key with a known prefix but the wrong secret", async () => {
    const seeded = await seedKey();
    const tampered = `${seeded.key.slice(0, -1)}${seeded.key.endsWith("a") ? "b" : "a"}`;

    await expectUnauthorized(await callProbe(bearer(tampered)));
  });

  // D10: revocation is immediate precisely because there is no key cache.
  it("rejects a revoked key immediately", async () => {
    const seeded = await seedKey({ revokedAt: NOW - 1000 });

    await expectUnauthorized(await callProbe(bearer(seeded.key)));
  });
});

describe("auth middleware — accepted requests", () => {
  it("lets a valid key through and attaches its context", async () => {
    const seeded = await seedKey();

    const res = await callProbe(bearer(seeded.key));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      key: { id: seeded.id, environment: "live", prefix: seeded.prefix },
    });
  });

  it("echoes key_prefix into the log line, and never the key itself", async () => {
    const seeded = await seedKey();
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });

    await callProbe(bearer(seeded.key));
    spy.mockRestore();

    expect(JSON.parse(lines[0] as string)).toMatchObject({ key_prefix: seeded.prefix });
    expect(lines[0]).not.toContain(seeded.key);
  });
});

// PRD §7.6 mandates a constant-time compare. Asserted by contract — timing
// assertions are inherently flaky and prove nothing on a shared runner.
describe("constant-time hash comparison", () => {
  it("compares digests via crypto.subtle.timingSafeEqual", async () => {
    const seeded = await seedKey();
    const spy = vi.spyOn(crypto.subtle, "timingSafeEqual");

    await callProbe(bearer(seeded.key));

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("hands it equal-length buffers, which is its documented precondition", async () => {
    const seeded = await seedKey();
    const spy = vi.spyOn(crypto.subtle, "timingSafeEqual");

    await callProbe(bearer(seeded.key));
    const [a, b] = spy.mock.calls[0] as [ArrayBufferView, ArrayBufferView];

    expect(a.byteLength).toBe(b.byteLength);
    spy.mockRestore();
  });
});

describe("auth middleware — exemptions (D25, design.md §4)", () => {
  it("still serves /v1/health with no Authorization header", async () => {
    const res = await protectedApp().request("https://api.r301.dev/v1/health", {}, bindings());

    expect(res.status).toBe(200);
  });
});

describe("last_used_at (PRD §7.6 — lazy, at most one write per key per hour)", () => {
  async function lastUsedAfterRequest(seeded: SeededKey): Promise<number | null> {
    const ctx = createExecutionContext();

    await protectedApp().request(
      "https://api.r301.dev/v1/_probe",
      { headers: bearer(seeded.key) },
      bindings(),
      ctx,
    );
    await waitOnExecutionContext(ctx);

    const row = await testEnv.DB.prepare("SELECT last_used_at FROM api_keys WHERE id = ?1")
      .bind(seeded.id)
      .first<{ last_used_at: number | null }>();

    return row?.last_used_at ?? null;
  }

  it("stamps last_used_at when it has never been set", async () => {
    expect(await lastUsedAfterRequest(await seedKey())).toBe(NOW);
  });

  it("refreshes last_used_at once it is more than an hour stale", async () => {
    const seeded = await seedKey({ lastUsedAt: NOW - (HOUR_MS + 1000) });

    expect(await lastUsedAfterRequest(seeded)).toBe(NOW);
  });

  // The point of the hour window: a busy key costs at most one write per hour.
  it("leaves a last_used_at from within the hour untouched", async () => {
    const fresh = NOW - 60_000;
    const seeded = await seedKey({ lastUsedAt: fresh });

    expect(await lastUsedAfterRequest(seeded)).toBe(fresh);
  });

  it("does not stamp last_used_at for a rejected key", async () => {
    const seeded = await seedKey({ revokedAt: NOW - 1000 });
    const ctx = createExecutionContext();

    await protectedApp().request(
      "https://api.r301.dev/v1/_probe",
      { headers: bearer(seeded.key) },
      bindings(),
      ctx,
    );
    await waitOnExecutionContext(ctx);

    const row = await testEnv.DB.prepare("SELECT last_used_at FROM api_keys WHERE id = ?1")
      .bind(seeded.id)
      .first<{ last_used_at: number | null }>();

    expect(row?.last_used_at).toBeNull();
  });
});

describe("last_used_at is best effort", () => {
  /** A DB whose writes always fail; reads still work, so auth itself succeeds. */
  function dbRejectingWrites(): D1Database {
    return new Proxy(testEnv.DB, {
      get(target, prop, receiver) {
        if (prop === "prepare") {
          return (sql: string) => {
            if (sql.trimStart().toUpperCase().startsWith("UPDATE")) {
              throw new Error("D1 write failed");
            }

            return target.prepare(sql);
          };
        }

        return Reflect.get(target, prop, receiver) as unknown;
      },
    }) as D1Database;
  }

  // A transient write failure must never cost the caller their request — auth
  // already succeeded by this point.
  it("still authenticates when the last_used_at write fails", async () => {
    const seeded = await seedKey();

    const res = await protectedApp().request(
      "https://api.r301.dev/v1/_probe",
      { headers: bearer(seeded.key) },
      { DB: dbRejectingWrites(), ENVIRONMENT: "local" } as Env,
    );

    expect(res.status).toBe(200);
  });
});

describe("auth precedes everything else on /v1", () => {
  // No existence oracle: an unauthenticated caller cannot tell a real route
  // from an imaginary one.
  it("answers 401, not 404, for an unknown path without a key", async () => {
    const res = await protectedApp().request(
      "https://api.r301.dev/v1/definitely-not-a-route",
      {},
      bindings(),
    );

    await expectUnauthorized(res);
  });

  // Auth runs before the JSON guard, so an unauthenticated body is never parsed.
  it("answers 401, not 415, when an unauthenticated request has a bad body type", async () => {
    const res = await protectedApp().request(
      "https://api.r301.dev/v1/_probe",
      { method: "POST", body: "a=1", headers: { "Content-Type": "application/x-www-form-urlencoded" } },
      bindings(),
    );

    expect(res.status).toBe(401);
  });
});
