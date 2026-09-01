import { env as testEnv } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createApiApp } from "../../src/routes/api";
import type { Env } from "../../src/types";
import { authHeaders, seedApiKey, type SeededApiKey } from "../helpers/auth";

const CREATED_AT = 1_788_000_000_000;

let key: SeededApiKey;

beforeEach(async () => {
  key = await seedApiKey();
});

function bindings(): Env {
  return { DB: testEnv.DB, REDIRECTS: testEnv.REDIRECTS, ENVIRONMENT: "local" } as Env;
}

async function seedLink(slug: string, tags: string[], deletedAt: number | null = null): Promise<void> {
  const row = await testEnv.DB.prepare(
    `INSERT INTO links (slug, destination, created_by_key_id, deleted_at, created_at, updated_at)
     VALUES (?1, 'https://clinic.example.com/x', ?2, ?3, ?4, ?4) RETURNING id`,
  )
    .bind(slug, key.id, deletedAt, CREATED_AT)
    .first<{ id: number }>();

  for (const name of tags) {
    const tag = await testEnv.DB.prepare(
      `INSERT INTO tags (name) VALUES (?1)
       ON CONFLICT(name) DO UPDATE SET name = excluded.name RETURNING id`,
    )
      .bind(name)
      .first<{ id: number }>();

    await testEnv.DB.prepare("INSERT INTO link_tags (link_id, tag_id) VALUES (?1, ?2)")
      .bind(row?.id, tag?.id)
      .run();
  }
}

function get(headers: Record<string, string> = authHeaders(key.key)): Promise<Response> {
  return Promise.resolve(
    createApiApp().request("https://api.r301.dev/v1/tags", { headers }, bindings()),
  );
}

interface TagList {
  tags: { name: string; link_count: number }[];
}

interface ErrorBody {
  error: { code: string; message: string; field?: string; request_id: string };
}

describe("GET /v1/tags (api-contract §tags, PRD §7.3, D26.6)", () => {
  it("returns an empty list when nothing is tagged", async () => {
    const res = await get();

    expect(res.status).toBe(200);
    expect(await res.json<TagList>()).toEqual({ tags: [] });
  });

  it("lists tags sorted by name with live link counts", async () => {
    await seedLink("a", ["tenant:42", "kind:invoice"]);
    await seedLink("b", ["tenant:42"]);
    await seedLink("c", ["kind:appointment"]);

    expect(await (await get()).json<TagList>()).toEqual({
      tags: [
        { name: "kind:appointment", link_count: 1 },
        { name: "kind:invoice", link_count: 1 },
        { name: "tenant:42", link_count: 2 },
      ],
    });
  });

  it("excludes tombstoned links from the counts (D15)", async () => {
    await seedLink("live", ["tenant:42"]);
    await seedLink("dead", ["tenant:42"], CREATED_AT);

    expect(await (await get()).json<TagList>()).toEqual({
      tags: [{ name: "tenant:42", link_count: 1 }],
    });
  });

  /**
   * Documented, not incidental: nothing prunes a `tags` row when its last link
   * is tombstoned (D15 tombstones, and no cascade reaches `tags`), so the tag
   * remains listed at zero. The alternative — hiding it — would make the tag
   * reappear on next use as if it were new.
   */
  it("still lists a tag whose only link was tombstoned, at zero", async () => {
    await seedLink("dead", ["kind:review"], CREATED_AT);

    expect(await (await get()).json<TagList>()).toEqual({
      tags: [{ name: "kind:review", link_count: 0 }],
    });
  });

  it("requires auth", async () => {
    const res = await get({});

    expect(res.status).toBe(401);
    expect((await res.json<ErrorBody>()).error.code).toBe("unauthorized");
  });

  it("answers 405 on a wrong method", async () => {
    const res = await createApiApp().request(
      "https://api.r301.dev/v1/tags",
      { method: "POST", headers: { ...authHeaders(key.key), "Content-Type": "application/json" }, body: "{}" },
      bindings(),
    );

    expect(res.status).toBe(405);
    expect((await res.json<ErrorBody>()).error.code).toBe("method_not_allowed");
  });
});
