import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env as testEnv } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createRedirectApp } from "../../src/routes/redirect";
import type { Env } from "../../src/types";
import { seedApiKey } from "../helpers/auth";

const DEST = "https://clinic.example.com/appt/9182?t=abc123&sig=xyz";
const PAST = 1_700_000_000_000;
const FUTURE = 4_000_000_000_000;

let keyId: number;

beforeEach(async () => {
  keyId = (await seedApiKey()).id;
});

function bindings(overrides: Partial<Env> = {}): Env {
  return { DB: testEnv.DB, REDIRECTS: testEnv.REDIRECTS, ENVIRONMENT: "local", ...overrides } as Env;
}

function get(path: string, init?: RequestInit, env?: Env, ctx?: ExecutionContext): Promise<Response> {
  return Promise.resolve(
    createRedirectApp().request(`https://r301.dev${path}`, init, env ?? bindings(), ctx as ExecutionContext),
  );
}

interface LinkState {
  slug: string;
  destination?: string;
  redirectType?: number;
  isActive?: number;
  expiresAt?: number | null;
  deletedAt?: number | null;
}

async function seedD1(s: LinkState): Promise<void> {
  await testEnv.DB.prepare(
    `INSERT INTO links (slug, destination, redirect_type, is_active, expires_at, deleted_at,
       created_by_key_id, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, 0)`,
  )
    .bind(
      s.slug,
      s.destination ?? DEST,
      s.redirectType ?? 302,
      s.isActive ?? 1,
      s.expiresAt ?? null,
      s.deletedAt ?? null,
      keyId,
    )
    .run();
}

async function seedKv(s: LinkState): Promise<void> {
  await testEnv.REDIRECTS.put(
    s.slug,
    JSON.stringify({
      d: s.destination ?? DEST,
      t: s.redirectType ?? 302,
      x: s.expiresAt ?? null,
      a: s.isActive ?? 1,
    }),
  );
}

/** The api-contract §Redirect host matrix, as data (docs/testing.md §3). */
const MATRIX: Array<{
  name: string;
  state: Omit<LinkState, "slug">;
  status: number;
  location: string | null;
  cacheControl: string;
}> = [
  { name: "active, default 302", state: { redirectType: 302 }, status: 302, location: DEST, cacheControl: "no-store" },
  { name: "active, 307", state: { redirectType: 307 }, status: 307, location: DEST, cacheControl: "no-store" },
  { name: "active, 301", state: { redirectType: 301 }, status: 301, location: DEST, cacheControl: "public, max-age=3600" },
  { name: "active, 308", state: { redirectType: 308 }, status: 308, location: DEST, cacheControl: "public, max-age=3600" },
  { name: "expired", state: { expiresAt: PAST }, status: 410, location: null, cacheControl: "no-store" },
  { name: "not yet expired", state: { expiresAt: FUTURE }, status: 302, location: DEST, cacheControl: "no-store" },
  { name: "deactivated", state: { isActive: 0 }, status: 404, location: null, cacheControl: "no-store" },
  // D17 evaluation order: deactivation outranks expiry, so this is 404 not 410.
  { name: "deactivated AND expired", state: { isActive: 0, expiresAt: PAST }, status: 404, location: null, cacheControl: "no-store" },
];

// The matrix must hold identically whether the entry came from KV or from the
// D1 fallthrough — that equivalence is the whole point of KV being a cache.
describe.each([
  ["KV hit", async (s: LinkState) => seedKv(s)],
  ["D1 fallthrough", async (s: LinkState) => seedD1(s)],
])("redirect matrix via %s (api-contract §Redirect host)", (_source, seed) => {
  it.each(MATRIX)("$name", async ({ state, status, location, cacheControl }) => {
    await seed({ slug: "abc123", ...state });

    const ctx = createExecutionContext();
    const res = await get("/abc123", undefined, bindings(), ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(status);
    expect(res.headers.get("Location")).toBe(location);
    expect(res.headers.get("Cache-Control")).toBe(cacheControl);
  });
});

describe("slug resolution (PRD §7.5, D17)", () => {
  it("sends the stored destination verbatim, query string and all", async () => {
    await seedKv({ slug: "abc123" });

    expect((await get("/abc123")).headers.get("Location")).toBe(DEST);
  });

  // D17: appended params must never corrupt a signed destination.
  it("drops a query string on the short URL", async () => {
    await seedKv({ slug: "abc123" });

    const res = await get("/abc123?utm_source=sms&utm_campaign=x");

    expect(res.headers.get("Location")).toBe(DEST);
    expect(res.headers.get("Location")).not.toContain("utm_source");
  });

  it("says the link expired, without naming it", async () => {
    await seedKv({ slug: "abc123", expiresAt: PAST });
    const res = await get("/abc123");

    expect(res.status).toBe(410);
    expect((await res.text()).toLowerCase()).toContain("expired");
  });

  // `/` is excluded from "not a redirect" because D29 gives it one of its own;
  // what matters is that none of these resolve to the seeded slug.
  it.each(["/abc123/", "/a/b", "/abc123/x", "/ab", "/", "/a"])(
    "does not treat %s as a lookup of the slug abc123",
    async (path) => {
      await seedKv({ slug: "abc123" });
      const res = await get(path);

      expect(res.headers.get("Location")).not.toBe(DEST);
    },
  );

  it.each(["/abc123/", "/a/b", "/abc123/x"])("answers %s with 404", async (path) => {
    await seedKv({ slug: "abc123" });

    expect((await get(path)).status).toBe(404);
  });

  it.each(["ab", "a"])("rejects the too-short slug %s with 404", async (slug) => {
    expect((await get(`/${slug}`)).status).toBe(404);
  });

  it("accepts a 64-character slug and rejects 65", async () => {
    await seedKv({ slug: "a".repeat(64) });

    expect((await get(`/${"a".repeat(64)}`)).status).toBe(302);
    expect((await get(`/${"a".repeat(65)}`)).status).toBe(404);
  });

  it("answers an unknown slug with 404 and no-store", async () => {
    const res = await get("/unknown1");

    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("KV/D1 contract (D20, design §3)", () => {
  it("serves a KV hit without looking the slug up in D1", async () => {
    await seedKv({ slug: "abc123" });
    const statements: string[] = [];
    const db = {
      prepare(sql: string) {
        statements.push(sql);

        return testEnv.DB.prepare(sql);
      },
    } as unknown as D1Database;

    const res = await get("/abc123", undefined, bindings({ DB: db }));

    expect(res.status).toBe(302);
    // What D20 forbids is *resolving* a redirect from D1. Since prompt 13 the
    // click counter's UPDATE is the one statement a KV hit legitimately issues
    // (PRD §7.4) — so this pins the count at exactly that, and no read.
    expect(statements.filter((sql) => sql.includes("SELECT"))).toEqual([]);
    expect(statements).toHaveLength(1);
  });

  it("backfills KV from D1 on a miss", async () => {
    await seedD1({ slug: "abc123", redirectType: 301, expiresAt: FUTURE });

    const ctx = createExecutionContext();
    await get("/abc123", undefined, bindings(), ctx);
    await waitOnExecutionContext(ctx);

    expect(await testEnv.REDIRECTS.get("abc123", "json")).toEqual({
      d: DEST,
      t: 301,
      x: FUTURE,
      a: 1,
    });
  });

  it("backfills a deactivated row too — it is live, just not serving", async () => {
    await seedD1({ slug: "abc123", isActive: 0 });

    const ctx = createExecutionContext();
    await get("/abc123", undefined, bindings(), ctx);
    await waitOnExecutionContext(ctx);

    expect(await testEnv.REDIRECTS.get<{ a: number }>("abc123", "json")).toMatchObject({ a: 0 });
  });

  // No negative caching (D20): a slug scanner would otherwise burn the
  // 1k/day KV write budget.
  it("writes nothing to KV for an unknown slug", async () => {
    const ctx = createExecutionContext();
    const res = await get("/unknown1", undefined, bindings(), ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(404);
    expect(await testEnv.REDIRECTS.get("unknown1")).toBeNull();
  });

  it("writes nothing to KV for a tombstoned slug", async () => {
    await seedD1({ slug: "abc123", deletedAt: PAST });

    const ctx = createExecutionContext();
    const res = await get("/abc123", undefined, bindings(), ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(404);
    expect(await testEnv.REDIRECTS.get("abc123")).toBeNull();
  });
});

describe("housekeeping routes", () => {
  // D29: the apex keeps its PRD §8 role; `/` sends visitors to the marketing
  // site. Never counted, and it bypasses the slug path entirely.
  it("redirects / to the marketing site", async () => {
    const res = await get("/");

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://www.r301.dev/");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("disallows crawling in robots.txt", async () => {
    const res = await get("/robots.txt");

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/^text\/plain/);
    expect(await res.text()).toContain("Disallow: /");
  });

  it("answers favicon.ico with an empty 204", async () => {
    const res = await get("/favicon.ico");

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });
});

describe("methods (api-contract §Redirect host)", () => {
  it("serves HEAD with the same status and headers but no body", async () => {
    await seedKv({ slug: "abc123" });

    const head = await get("/abc123", { method: "HEAD" });
    const body = await head.text();

    expect(head.status).toBe(302);
    expect(head.headers.get("Location")).toBe(DEST);
    expect(head.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toBe("");
  });

  it("serves HEAD on a 404 with an empty body", async () => {
    const head = await get("/unknown1", { method: "HEAD" });

    expect(head.status).toBe(404);
    expect(await head.text()).toBe("");
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("answers %s on a slug with 405 plain text", async (method) => {
    await seedKv({ slug: "abc123" });
    const res = await get("/abc123", { method });

    expect(res.status).toBe(405);
    expect(res.headers.get("Content-Type")).toMatch(/^text\/plain/);
  });
});

describe("X-Request-Id (design §8)", () => {
  it.each(["/abc123", "/unknown1", "/", "/robots.txt", "/favicon.ico"])(
    "stamps %s",
    async (path) => {
      await seedKv({ slug: "abc123" });

      expect((await get(path)).headers.get("X-Request-Id")).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    },
  );
});
