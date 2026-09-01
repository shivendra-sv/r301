import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env as testEnv } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createApiApp } from "../../src/routes/api";
import { createRedirectApp } from "../../src/routes/redirect";
import type { Env } from "../../src/types";
import { authHeaders, seedApiKey, type SeededApiKey } from "../helpers/auth";

/** A UA the D21 denylist does not match, so its clicks are counted. */
const BROWSER_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const CREATED_AT = 1_788_000_000_000;

let key: SeededApiKey;

beforeEach(async () => {
  key = await seedApiKey();
});

function bindings(overrides: Partial<Env> = {}): Env {
  return { DB: testEnv.DB, REDIRECTS: testEnv.REDIRECTS, ENVIRONMENT: "local", ...overrides } as Env;
}

interface SeedOptions {
  slug: string;
  destination?: string;
  deletedAt?: number | null;
  isActive?: number;
  clickCount?: number;
  lastClickedAt?: number | null;
  tags?: string[];
}

async function seedLink(options: SeedOptions): Promise<number> {
  const row = await testEnv.DB.prepare(
    `INSERT INTO links (slug, destination, redirect_type, is_active, deleted_at,
       click_count, last_clicked_at, created_by_key_id, created_at, updated_at)
     VALUES (?1, ?2, 302, ?3, ?4, ?5, ?6, ?7, ?8, ?8) RETURNING id`,
  )
    .bind(
      options.slug,
      options.destination ?? `https://clinic.example.com/${options.slug}`,
      options.isActive ?? 1,
      options.deletedAt ?? null,
      options.clickCount ?? 0,
      options.lastClickedAt ?? null,
      key.id,
      CREATED_AT,
    )
    .first<{ id: number }>();

  const linkId = row?.id as number;

  for (const name of options.tags ?? []) {
    const tag = await testEnv.DB.prepare(
      `INSERT INTO tags (name) VALUES (?1)
       ON CONFLICT(name) DO UPDATE SET name = excluded.name RETURNING id`,
    )
      .bind(name)
      .first<{ id: number }>();

    await testEnv.DB.prepare("INSERT INTO link_tags (link_id, tag_id) VALUES (?1, ?2)")
      .bind(linkId, tag?.id)
      .run();
  }

  return linkId;
}

function get(path: string, headers: Record<string, string> = authHeaders(key.key)): Promise<Response> {
  return Promise.resolve(
    createApiApp().request(`https://api.r301.dev${path}`, { headers }, bindings()),
  );
}

/** One real click through the redirect surface, with its deferred count flushed. */
async function click(slug: string): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await createRedirectApp().request(
    `https://r301.dev/${slug}`,
    { headers: { "User-Agent": BROWSER_UA } },
    bindings(),
    ctx,
  );
  await waitOnExecutionContext(ctx);

  return res;
}

interface LinkStats {
  slug: string;
  click_count: number;
  last_clicked_at: string | null;
  created_at: string;
}

interface ErrorBody {
  error: { code: string; message: string; field?: string; request_id: string };
}

describe("GET /v1/links/{slug}/stats (api-contract §stats, PRD §7.4)", () => {
  it("reports zeros for a link nobody has clicked", async () => {
    await seedLink({ slug: "fresh" });

    const res = await get("/v1/links/fresh/stats");

    expect(res.status).toBe(200);
    expect(await res.json<LinkStats>()).toEqual({
      slug: "fresh",
      click_count: 0,
      last_clicked_at: null,
      created_at: new Date(CREATED_AT).toISOString(),
    });
  });

  // The prompt's "drive real clicks" case: counts come from the redirect path
  // (prompt 13), not from a hand-written UPDATE.
  it("reports two real clicks driven through the redirect route", async () => {
    await seedLink({ slug: "clicked" });

    expect((await click("clicked")).status).toBe(302);
    expect((await click("clicked")).status).toBe(302);

    const stats = await (await get("/v1/links/clicked/stats")).json<LinkStats>();

    expect(stats.click_count).toBe(2);
    expect(stats.last_clicked_at).not.toBeNull();
    // ISO 8601 UTC, per the api-contract's timestamp convention.
    expect(stats.last_clicked_at).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  });

  it("answers 404 for an unknown slug", async () => {
    const res = await get("/v1/links/nope/stats");

    expect(res.status).toBe(404);
    expect((await res.json<ErrorBody>()).error.code).toBe("not_found");
  });

  it("answers 404 for a tombstoned link (D15)", async () => {
    await seedLink({ slug: "gone", deletedAt: CREATED_AT, clickCount: 9 });

    expect((await get("/v1/links/gone/stats")).status).toBe(404);
  });

  it("requires auth", async () => {
    await seedLink({ slug: "fresh" });

    const res = await get("/v1/links/fresh/stats", {});

    expect(res.status).toBe(401);
    expect((await res.json<ErrorBody>()).error.code).toBe("unauthorized");
  });
});

interface TagStats {
  tag: string;
  link_count: number;
  click_count: number;
}

describe("GET /v1/stats?tag=x (api-contract §stats)", () => {
  /** Curastax's per-clinic shape: three tagged links, 2 + 1 + 0 clicks. */
  async function seedTenant42(): Promise<void> {
    await seedLink({ slug: "t42-a", clickCount: 2, tags: ["tenant:42", "kind:invoice"] });
    await seedLink({ slug: "t42-b", clickCount: 1, tags: ["tenant:42"] });
    await seedLink({ slug: "t42-c", clickCount: 0, tags: ["tenant:42"] });
    await seedLink({ slug: "t7-a", clickCount: 50, tags: ["tenant:7"] });
  }

  it("sums links and clicks across the tag", async () => {
    await seedTenant42();

    const res = await get("/v1/stats?tag=tenant:42");

    expect(res.status).toBe(200);
    expect(await res.json<TagStats>()).toEqual({
      tag: "tenant:42",
      link_count: 3,
      click_count: 3,
    });
  });

  it("leaves other tags out of the sum", async () => {
    await seedTenant42();

    expect(await (await get("/v1/stats?tag=tenant:7")).json<TagStats>()).toEqual({
      tag: "tenant:7",
      link_count: 1,
      click_count: 50,
    });
  });

  // D15: a tombstone takes its clicks and its membership with it.
  it("drops a tombstoned link from both counts", async () => {
    await seedTenant42();
    await testEnv.DB.prepare("UPDATE links SET deleted_at = ?1 WHERE slug = 't42-a'")
      .bind(CREATED_AT)
      .run();

    expect(await (await get("/v1/stats?tag=tenant:42")).json<TagStats>()).toEqual({
      tag: "tenant:42",
      link_count: 2,
      click_count: 1,
    });
  });

  // Deactivation is reversible and the row still exists — only tombstones vanish.
  it("still counts a deactivated link", async () => {
    await seedLink({ slug: "off", isActive: 0, clickCount: 4, tags: ["tenant:42"] });

    expect(await (await get("/v1/stats?tag=tenant:42")).json<TagStats>()).toEqual({
      tag: "tenant:42",
      link_count: 1,
      click_count: 4,
    });
  });

  it("answers zeros for a tag that never existed", async () => {
    await seedTenant42();

    const res = await get("/v1/stats?tag=tenant:999");

    expect(res.status).toBe(200);
    expect(await res.json<TagStats>()).toEqual({
      tag: "tenant:999",
      link_count: 0,
      click_count: 0,
    });
  });

  it("rejects a missing tag with 400 invalid_request", async () => {
    const res = await get("/v1/stats");

    expect(res.status).toBe(400);
    expect((await res.json<ErrorBody>()).error).toMatchObject({
      code: "invalid_request",
      field: "tag",
    });
  });

  it("rejects an empty tag with 400", async () => {
    expect((await get("/v1/stats?tag=")).status).toBe(400);
  });

  it("rejects an unknown query parameter (D22)", async () => {
    expect((await get("/v1/stats?tag=tenant:42&limit=5")).status).toBe(400);
  });

  it("requires auth", async () => {
    expect((await get("/v1/stats?tag=tenant:42", {})).status).toBe(401);
  });
});

// Both paths are registered, so a wrong method is `method_not_allowed` rather
// than `not_found` (api-contract: 405 is "wrong method on a *known* route").
describe("405 guards on the stats paths", () => {
  async function post(path: string): Promise<Response> {
    return createApiApp().request(
      `https://api.r301.dev${path}`,
      {
        method: "POST",
        headers: { ...authHeaders(key.key), "Content-Type": "application/json" },
        body: "{}",
      },
      bindings(),
    );
  }

  it("answers 405 on POST /v1/links/{slug}/stats", async () => {
    await seedLink({ slug: "fresh" });

    const res = await post("/v1/links/fresh/stats");

    expect(res.status).toBe(405);
    expect((await res.json<ErrorBody>()).error.code).toBe("method_not_allowed");
  });

  it("answers 405 on POST /v1/stats", async () => {
    expect((await post("/v1/stats")).status).toBe(405);
  });
});
