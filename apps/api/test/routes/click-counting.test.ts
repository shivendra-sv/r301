import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env as testEnv } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createRedirectApp, type RedirectAppOptions } from "../../src/routes/redirect";
import type { Env } from "../../src/types";
import { seedApiKey } from "../helpers/auth";

const DEST = "https://clinic.example.com/appt/9182?t=abc123&sig=xyz";
const PAST = 1_700_000_000_000;
const BROWSER_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

let keyId: number;

beforeEach(async () => {
  keyId = (await seedApiKey()).id;
});

function bindings(overrides: Partial<Env> = {}): Env {
  return { DB: testEnv.DB, REDIRECTS: testEnv.REDIRECTS, ENVIRONMENT: "local", ...overrides } as Env;
}

async function seedLink(state: { isActive?: number; expiresAt?: number | null } = {}): Promise<void> {
  await testEnv.DB.prepare(
    `INSERT INTO links (slug, destination, redirect_type, is_active, expires_at,
       created_by_key_id, created_at, updated_at)
     VALUES ('abc123', ?1, 302, ?2, ?3, ?4, 0, 0)`,
  )
    .bind(DEST, state.isActive ?? 1, state.expiresAt ?? null, keyId)
    .run();
}

interface Counts {
  click_count: number;
  last_clicked_at: number | null;
}

function counts(): Promise<Counts | null> {
  return testEnv.DB.prepare(
    "SELECT click_count, last_clicked_at FROM links WHERE slug = 'abc123'",
  ).first<Counts>();
}

/** Drives one redirect and flushes whatever the handler deferred. */
async function hit(
  path: string,
  init: RequestInit = {},
  env: Env = bindings(),
  options: RedirectAppOptions = {},
): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await createRedirectApp(options).request(`https://r301.dev${path}`, init, env, ctx);
  await waitOnExecutionContext(ctx);

  return res;
}

describe("click counting (PRD §7.4, D21)", () => {
  it("counts a successful 302 GET from a browser", async () => {
    await seedLink();
    const before = Date.now();

    const res = await hit("/abc123", { headers: { "User-Agent": BROWSER_UA } });

    expect(res.status).toBe(302);
    const row = await counts();
    expect(row?.click_count).toBe(1);
    expect(row?.last_clicked_at).toBeGreaterThanOrEqual(before);
  });

  // Single-statement increment: two clicks must not lose an update to each other.
  it("counts two sequential clicks as two", async () => {
    await seedLink();

    await hit("/abc123", { headers: { "User-Agent": BROWSER_UA } });
    await hit("/abc123", { headers: { "User-Agent": BROWSER_UA } });

    expect((await counts())?.click_count).toBe(2);
  });

  it("counts a GET that sends no User-Agent at all", async () => {
    await seedLink();

    await hit("/abc123");

    expect((await counts())?.click_count).toBe(1);
  });

  it("serves a denylisted UA but does not count it", async () => {
    await seedLink();

    const res = await hit("/abc123", { headers: { "User-Agent": "WhatsApp/2.24.10.75 A" } });

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(DEST);
    expect(await counts()).toEqual({ click_count: 0, last_clicked_at: null });
  });

  // PRD §7.4: HEAD serves the redirect, identically, and never counts.
  it("serves HEAD but does not count it", async () => {
    await seedLink();

    const res = await hit("/abc123", { method: "HEAD", headers: { "User-Agent": BROWSER_UA } });

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(DEST);
    expect(await counts()).toEqual({ click_count: 0, last_clicked_at: null });
  });

  it("does not count a 404 from a deactivated link", async () => {
    await seedLink({ isActive: 0 });

    const res = await hit("/abc123", { headers: { "User-Agent": BROWSER_UA } });

    expect(res.status).toBe(404);
    expect(await counts()).toEqual({ click_count: 0, last_clicked_at: null });
  });

  it("does not count a 410 from an expired link", async () => {
    await seedLink({ expiresAt: PAST });

    const res = await hit("/abc123", { headers: { "User-Agent": BROWSER_UA } });

    expect(res.status).toBe(410);
    expect(await counts()).toEqual({ click_count: 0, last_clicked_at: null });
  });

  it("does not count an unknown slug", async () => {
    const res = await hit("/unknown1", { headers: { "User-Agent": BROWSER_UA } });

    expect(res.status).toBe(404);
  });
});

describe("counter failure (design §7)", () => {
  /** Real D1 for every read; the counting UPDATE alone explodes. */
  function dbWithFailingCounter(): D1Database {
    return {
      prepare(sql: string) {
        if (sql.includes("click_count = click_count + 1")) {
          return {
            bind: () => ({
              run: () => Promise.reject(new Error("D1_ERROR: counter unavailable")),
            }),
          };
        }

        return testEnv.DB.prepare(sql);
      },
    } as unknown as D1Database;
  }

  it("still serves the redirect, and reports the failure instead of throwing", async () => {
    await seedLink();
    const reported: unknown[] = [];

    const res = await hit(
      "/abc123",
      { headers: { "User-Agent": BROWSER_UA } },
      bindings({ DB: dbWithFailingCounter() }),
      {
        reportError: (err) => {
          reported.push(err);
        },
      },
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(DEST);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toBeInstanceOf(Error);
  });
});
