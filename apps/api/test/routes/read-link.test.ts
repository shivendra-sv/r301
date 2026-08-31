import { env as testEnv } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createApiApp } from "../../src/routes/api";
import { authHeaders, seedApiKey, testBindings, type SeededApiKey } from "../helpers/auth";

let key: SeededApiKey;

beforeEach(async () => {
  key = await seedApiKey();
});

interface SeedOptions {
  destination?: string;
  redirectType?: number;
  isActive?: number;
  expiresAt?: number | null;
  deletedAt?: number | null;
  externalId?: string | null;
  createdAt?: number;
  tags?: readonly string[];
  clickCount?: number;
}

/** Rows are seeded directly so `created_at` is controlled rather than observed. */
async function seedLink(slug: string, options: SeedOptions = {}): Promise<number> {
  const at = options.createdAt ?? 1_756_684_800_000;
  const row = await testEnv.DB.prepare(
    `INSERT INTO links
       (slug, destination, redirect_type, is_active, expires_at, deleted_at,
        external_id, click_count, created_by_key_id, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
     RETURNING id`,
  )
    .bind(
      slug,
      options.destination ?? "https://clinic.example.com/appt/9182",
      options.redirectType ?? 302,
      options.isActive ?? 1,
      options.expiresAt ?? null,
      options.deletedAt ?? null,
      options.externalId ?? null,
      options.clickCount ?? 0,
      key.id,
      at,
    )
    .first<{ id: number }>();

  const id = row?.id as number;

  for (const name of options.tags ?? []) {
    const tag = await testEnv.DB.prepare(
      `INSERT INTO tags (name) VALUES (?1)
       ON CONFLICT(name) DO UPDATE SET name = excluded.name RETURNING id`,
    )
      .bind(name)
      .first<{ id: number }>();

    await testEnv.DB.prepare("INSERT INTO link_tags (link_id, tag_id) VALUES (?1, ?2)")
      .bind(id, tag?.id as number)
      .run();
  }

  return id;
}

function get(path: string, headers: Record<string, string> = authHeaders(key.key)) {
  return createApiApp().request(`https://api.r301.dev${path}`, { headers }, testBindings());
}

interface LinkBody {
  slug: string;
  short_url: string;
  destination: string;
  redirect_type: number;
  is_active: boolean;
  expires_at: string | null;
  tags: string[];
  external_id: string | null;
  created_at: string;
  updated_at: string;
}

interface ErrorBody {
  error: { code: string; message: string; field?: string; request_id: string };
}

describe("GET /v1/links/{slug} (api-contract §GET /v1/links/{slug})", () => {
  it("returns the Link resource for an existing slug", async () => {
    await seedLink("aB3xY9k", {
      destination: "https://clinic.example.com/appt/9182?t=abc123",
      redirectType: 301,
      expiresAt: 1_790_769_600_000,
      externalId: "appt_9182",
      createdAt: 1_788_163_200_000,
      tags: ["tenant:42", "kind:appointment"],
    });

    const res = await get("/v1/links/aB3xY9k");
    const body = (await res.json()) as LinkBody;

    expect(res.status).toBe(200);
    expect(body).toEqual({
      slug: "aB3xY9k",
      short_url: "http://127.0.0.1:8787/aB3xY9k",
      destination: "https://clinic.example.com/appt/9182?t=abc123",
      redirect_type: 301,
      is_active: true,
      expires_at: "2026-09-30T12:00:00.000Z",
      tags: ["tenant:42", "kind:appointment"],
      external_id: "appt_9182",
      created_at: "2026-08-31T08:00:00.000Z",
      updated_at: "2026-08-31T08:00:00.000Z",
    });
  });

  it("omits counts — they belong to the stats endpoints (D26)", async () => {
    await seedLink("counted", { clickCount: 940 });

    const res = await get("/v1/links/counted");
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body).not.toHaveProperty("click_count");
    expect(body).not.toHaveProperty("last_clicked_at");
  });

  it("returns an empty tag list for an untagged link", async () => {
    await seedLink("bare");

    const body = (await (await get("/v1/links/bare")).json()) as LinkBody;

    expect(body.tags).toEqual([]);
  });

  it("returns a deactivated link — deactivation is not deletion", async () => {
    await seedLink("paused", { isActive: 0 });

    const body = (await (await get("/v1/links/paused")).json()) as LinkBody;

    expect(body.is_active).toBe(false);
  });

  it("matches the slug case-sensitively", async () => {
    await seedLink("Launch");

    expect((await get("/v1/links/Launch")).status).toBe(200);
    expect((await get("/v1/links/launch")).status).toBe(404);
  });

  it("returns 404 for an unknown slug", async () => {
    const res = await get("/v1/links/nosuch");
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("not_found");
  });

  it("returns 404 for a tombstoned link (D15)", async () => {
    await seedLink("gone", { deletedAt: 1_756_684_900_000 });

    expect((await get("/v1/links/gone")).status).toBe(404);
  });

  it("makes a tombstone indistinguishable from an unknown slug", async () => {
    await seedLink("gone", { deletedAt: 1_756_684_900_000 });

    const tombstoned = (await (await get("/v1/links/gone")).json()) as ErrorBody;
    const unknown = (await (await get("/v1/links/nosuch")).json()) as ErrorBody;

    // request_id differs by construction; everything a client could probe with
    // must not.
    expect({ ...tombstoned.error, request_id: "" }).toEqual({ ...unknown.error, request_id: "" });
  });

  it("requires a key", async () => {
    await seedLink("secret");

    expect((await get("/v1/links/secret", {})).status).toBe(401);
  });

  it("answers 405, not 404, on a method the route does not serve", async () => {
    await seedLink("aB3xY9k");

    const res = await createApiApp().request(
      "https://api.r301.dev/v1/links/aB3xY9k",
      { method: "PUT", headers: authHeaders(key.key) },
      testBindings(),
    );

    expect(res.status).toBe(405);
    expect(((await res.json()) as ErrorBody).error.code).toBe("method_not_allowed");
  });
});
