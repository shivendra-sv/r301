import { env as testEnv } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiApp } from "../../src/routes/api";
import { createRedirectApp } from "../../src/routes/redirect";
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
  /**
   * Prompt 14 made `GET /v1/links/:slug` a real route, so this file no longer
   * stubs one — it seeds the row the real route reads. Same assertions, one
   * less fixture between them and the code.
   */
  async function seedLink(keyId: number): Promise<void> {
    await testEnv.DB.prepare(
      `INSERT INTO links (slug, destination, created_by_key_id, created_at, updated_at)
       VALUES ('aB3xY9k', 'https://clinic.example.com/appt/9182', ?1, 0, 0)`,
    )
      .bind(keyId)
      .run();
  }

  async function callLink(): Promise<void> {
    const seeded = await seedApiKey();
    await seedLink(seeded.id);
    await createApiApp().request(
      "https://api.r301.dev/v1/links/aB3xY9k",
      { headers: authHeaders(seeded.key) },
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
    const { id, key, prefix } = await seedApiKey();
    await seedLink(id);
    const res = await createApiApp().request(
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
// The path is one no route claims — `/v1/links/…` is a real route from prompt
// 14 on, and this test is specifically about the *unmatched* case.
it("never logs the raw path, even when no route matched", async () => {
  const { key } = await seedApiKey();
  await createApiApp().request(
    "https://api.r301.dev/v1/nosuchcollection/SECRET_SLUG",
    { headers: authHeaders(key) },
    testBindings(),
  );

  expect(lines[0]).not.toContain("SECRET_SLUG");
  expect(parsed().route).toBe("/*");
});

// Prompt 13 wires `LogFields.ua`, unset since prompt 04 (PROGRESS question 8).
// D21: the pilot tunes the bot denylist from UAs seen on the redirect path, so
// that path — and only that path — logs it.
describe("redirect-path log line (D21, D23)", () => {
  const WHATSAPP_UA = "WhatsApp/2.24.10.75 A";

  function hit(path: string, headers: Record<string, string> = {}): Promise<Response> {
    return Promise.resolve(
      createRedirectApp().request(`https://r301.dev${path}`, { headers }, testBindings()),
    );
  }

  it("logs the user-agent", async () => {
    await hit("/abc123", { "User-Agent": WHATSAPP_UA });

    expect(parsed().ua).toBe(WHATSAPP_UA);
  });

  it("omits ua entirely when the request sends none", async () => {
    await hit("/abc123");

    expect(parsed()).not.toHaveProperty("ua");
  });

  // D23 still holds on this path: the UA joined the allowlist, nothing else did.
  it("still never logs the destination or the raw slug", async () => {
    await testEnv.REDIRECTS.put(
      "abc123",
      JSON.stringify({ d: "https://clinic.example.com/appt/9182?sig=xyz", t: 302, x: null, a: 1 }),
    );

    const res = await hit("/abc123", { "User-Agent": WHATSAPP_UA });

    expect(res.status).toBe(302);
    expect(lines[0]).not.toContain("clinic.example.com");
    expect(lines[0]).not.toContain("abc123");
    expect(parsed().route).toBe("/:slug");
  });
});

// The API surface keeps the narrower allowlist: D21 scopes the UA to redirects.
it("never carries the user-agent on the API surface", async () => {
  const { key } = await seedApiKey();
  await createApiApp().request(
    "https://api.r301.dev/v1/links",
    { headers: { ...authHeaders(key), "User-Agent": "Mozilla/5.0" } },
    testBindings(),
  );

  expect(parsed()).not.toHaveProperty("ua");
});
