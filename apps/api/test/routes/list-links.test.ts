import { env as testEnv } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createApiApp } from "../../src/routes/api";
import { authHeaders, seedApiKey, testBindings, type SeededApiKey } from "../helpers/auth";

let key: SeededApiKey;

beforeEach(async () => {
  key = await seedApiKey();
});

/** Base epoch for seeded rows: 2026-08-31T08:00:00Z. */
const T0 = 1_788_163_200_000;

interface SeedOptions {
  createdAt?: number;
  isActive?: number;
  deletedAt?: number | null;
  externalId?: string | null;
  tags?: readonly string[];
}

/**
 * `created_at` is supplied, never observed — ties and ordering have to be
 * reproducible for the keyset assertions to mean anything.
 */
async function seedLink(slug: string, options: SeedOptions = {}): Promise<number> {
  const row = await testEnv.DB.prepare(
    `INSERT INTO links
       (slug, destination, is_active, deleted_at, external_id,
        created_by_key_id, created_at, updated_at)
     VALUES (?1, 'https://clinic.example.com/appt/9182', ?2, ?3, ?4, ?5, ?6, ?6)
     RETURNING id`,
  )
    .bind(
      slug,
      options.isActive ?? 1,
      options.deletedAt ?? null,
      options.externalId ?? null,
      key.id,
      options.createdAt ?? T0,
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

interface ListBody {
  links: { slug: string; tags: string[]; is_active: boolean; external_id: string | null }[];
  next_cursor: string | null;
}

interface ErrorBody {
  error: { code: string; message: string; field?: string; request_id: string };
}

function list(query = "", headers: Record<string, string> = authHeaders(key.key)) {
  return createApiApp().request(
    `https://api.r301.dev/v1/links${query}`,
    { headers },
    testBindings(),
  );
}

async function slugsOf(query = ""): Promise<string[]> {
  const res = await list(query);
  expect(res.status).toBe(200);
  return ((await res.json()) as ListBody).links.map((l) => l.slug);
}

/** Follows `next_cursor` to exhaustion, returning every slug seen in order. */
async function walk(pageSize: number, query = ""): Promise<string[]> {
  const seen: string[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < 50; page++) {
    const suffix: string = cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`;
    const res = await list(`?limit=${pageSize}${query}${suffix}`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as ListBody;
    seen.push(...body.links.map((l) => l.slug));
    cursor = body.next_cursor;

    if (cursor === null) {
      return seen;
    }
  }

  throw new Error("pagination did not terminate");
}

describe("GET /v1/links (api-contract §GET /v1/links)", () => {
  describe("default page", () => {
    it("returns links newest-first with a null cursor when exhausted", async () => {
      await seedLink("oldest", { createdAt: T0 });
      await seedLink("middle", { createdAt: T0 + 1000 });
      await seedLink("newest", { createdAt: T0 + 2000 });

      const res = await list();
      const body = (await res.json()) as ListBody;

      expect(res.status).toBe(200);
      expect(body.links.map((l) => l.slug)).toEqual(["newest", "middle", "oldest"]);
      expect(body.next_cursor).toBeNull();
    });

    it("returns an empty list, not an error, when there is nothing to list", async () => {
      const body = (await (await list()).json()) as ListBody;

      expect(body).toEqual({ links: [], next_cursor: null });
    });

    it("caps an unspecified limit at 25 and offers a cursor", async () => {
      for (let i = 0; i < 26; i++) {
        await seedLink(`link-${i}`, { createdAt: T0 + i * 1000 });
      }

      const body = (await (await list()).json()) as ListBody;

      expect(body.links).toHaveLength(25);
      expect(body.next_cursor).not.toBeNull();
    });

    it("serves the full Link resource for each row", async () => {
      await seedLink("tagged", { externalId: "appt_9182", tags: ["tenant:42"] });

      const body = (await (await list()).json()) as ListBody;

      expect(body.links[0]).toEqual({
        slug: "tagged",
        short_url: "http://127.0.0.1:8787/tagged",
        destination: "https://clinic.example.com/appt/9182",
        redirect_type: 302,
        is_active: true,
        expires_at: null,
        tags: ["tenant:42"],
        external_id: "appt_9182",
        created_at: "2026-08-31T08:00:00.000Z",
        updated_at: "2026-08-31T08:00:00.000Z",
      });
    });

    it("requires a key", async () => {
      expect((await list("", {})).status).toBe(401);
    });
  });

  describe("cursor pagination", () => {
    it("returns exactly `limit` links plus a cursor when more remain", async () => {
      for (let i = 0; i < 5; i++) {
        await seedLink(`link-${i}`, { createdAt: T0 + i * 1000 });
      }

      const body = (await (await list("?limit=2")).json()) as ListBody;

      expect(body.links.map((l) => l.slug)).toEqual(["link-4", "link-3"]);
      expect(body.next_cursor).not.toBeNull();
    });

    it("walks to exhaustion visiting every link exactly once", async () => {
      const expected: string[] = [];
      for (let i = 0; i < 9; i++) {
        await seedLink(`link-${i}`, { createdAt: T0 + i * 1000 });
        expected.unshift(`link-${i}`);
      }

      expect(await walk(2)).toEqual(expected);
    });

    it("walks a page size that divides the set exactly, without a phantom page", async () => {
      for (let i = 0; i < 4; i++) {
        await seedLink(`link-${i}`, { createdAt: T0 + i * 1000 });
      }

      expect(await walk(2)).toEqual(["link-3", "link-2", "link-1", "link-0"]);
    });

    it("breaks created_at ties by id, so identical timestamps neither dupe nor gap", async () => {
      // Every row shares one instant: without the id tie-break, the keyset
      // comparison is `created_at < X`, which either skips or repeats the tie.
      const ids = new Map<string, number>();
      for (let i = 0; i < 7; i++) {
        ids.set(`tie-${i}`, await seedLink(`tie-${i}`, { createdAt: T0 }));
      }

      const seen = await walk(2);

      expect(new Set(seen).size).toBe(7);
      expect(seen).toHaveLength(7);
      // id DESC within the tie, matching the created_at DESC ordering.
      expect(seen).toEqual([...ids.keys()].reverse());
    });

    it("breaks ties across a mixed set of tied and distinct timestamps", async () => {
      await seedLink("a", { createdAt: T0 + 2000 });
      await seedLink("b", { createdAt: T0 + 1000 });
      await seedLink("c", { createdAt: T0 + 1000 });
      await seedLink("d", { createdAt: T0 + 1000 });
      await seedLink("e", { createdAt: T0 });

      expect(await walk(2)).toEqual(["a", "d", "c", "b", "e"]);
    });

    it("mints an opaque cursor that survives URL encoding unchanged", async () => {
      await seedLink("one", { createdAt: T0 });
      await seedLink("two", { createdAt: T0 + 1000 });

      const body = (await (await list("?limit=1")).json()) as ListBody;
      const cursor = body.next_cursor as string;

      expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(encodeURIComponent(cursor)).toBe(cursor);
      expect(cursor).not.toContain("two");
    });

    it("resumes from a cursor that has been through URL encoding", async () => {
      await seedLink("one", { createdAt: T0 });
      await seedLink("two", { createdAt: T0 + 1000 });

      const first = (await (await list("?limit=1")).json()) as ListBody;
      const second = (await (
        await list(`?limit=1&cursor=${encodeURIComponent(first.next_cursor as string)}`)
      ).json()) as ListBody;

      expect(second.links.map((l) => l.slug)).toEqual(["one"]);
      expect(second.next_cursor).toBeNull();
    });

    it("rejects a garbage cursor with 400 invalid_request", async () => {
      const res = await list("?cursor=not-a-real-cursor");
      const body = (await res.json()) as ErrorBody;

      expect(res.status).toBe(400);
      expect(body.error.code).toBe("invalid_request");
      expect(body.error.field).toBe("cursor");
    });

    it("rejects a cursor carrying a non-position payload", async () => {
      const forged = btoa("'; DROP TABLE links; --").replace(/=+$/, "");

      expect((await list(`?cursor=${encodeURIComponent(forged)}`)).status).toBe(400);
    });

    it("keeps earlier pages stable when links are created between fetches", async () => {
      for (let i = 0; i < 5; i++) {
        await seedLink(`link-${i}`, { createdAt: T0 + i * 1000 });
      }

      const first = (await (await list("?limit=2")).json()) as ListBody;
      expect(first.links.map((l) => l.slug)).toEqual(["link-4", "link-3"]);

      // Three newer links land while the client is between pages. Under offset
      // pagination these would shift the window and re-serve link-3/link-4.
      for (let i = 0; i < 3; i++) {
        await seedLink(`interleaved-${i}`, { createdAt: T0 + 10_000 + i * 1000 });
      }

      const second = (await (
        await list(`?limit=2&cursor=${encodeURIComponent(first.next_cursor as string)}`)
      ).json()) as ListBody;

      expect(second.links.map((l) => l.slug)).toEqual(["link-2", "link-1"]);
    });
  });

  describe("filters", () => {
    beforeEach(async () => {
      await seedLink("tagged-active", { createdAt: T0 + 3000, tags: ["tenant:42"] });
      await seedLink("tagged-off", { createdAt: T0 + 2000, isActive: 0, tags: ["tenant:42"] });
      await seedLink("plain-active", { createdAt: T0 + 1000, externalId: "appt_9182" });
      await seedLink("plain-off", { createdAt: T0, isActive: 0, externalId: "appt_0001" });
    });

    it("filters by tag", async () => {
      expect(await slugsOf("?tag=tenant:42")).toEqual(["tagged-active", "tagged-off"]);
    });

    it("returns an empty list for a tag nothing carries", async () => {
      expect(await slugsOf("?tag=tenant:99")).toEqual([]);
    });

    it("filters by active=false", async () => {
      expect(await slugsOf("?active=false")).toEqual(["tagged-off", "plain-off"]);
    });

    it("filters by active=true", async () => {
      expect(await slugsOf("?active=true")).toEqual(["tagged-active", "plain-active"]);
    });

    it("filters by created_after, exclusive of the boundary instant", async () => {
      const boundary = new Date(T0 + 2000).toISOString();

      expect(await slugsOf(`?created_after=${encodeURIComponent(boundary)}`)).toEqual([
        "tagged-active",
      ]);
    });

    it("filters by external_id on an exact match (D19)", async () => {
      expect(await slugsOf("?external_id=appt_9182")).toEqual(["plain-active"]);
    });

    it("does not treat external_id as a prefix", async () => {
      expect(await slugsOf("?external_id=appt_")).toEqual([]);
    });

    it("AND-combines tag and active", async () => {
      expect(await slugsOf("?tag=tenant:42&active=true")).toEqual(["tagged-active"]);
    });

    it("AND-combines every filter at once", async () => {
      const boundary = new Date(T0 + 1000).toISOString();
      const query = `?tag=tenant:42&active=false&created_after=${encodeURIComponent(boundary)}`;

      expect(await slugsOf(query)).toEqual(["tagged-off"]);
    });

    it("paginates a filtered set without leaking rows the filter excludes", async () => {
      expect(await walk(1, "&tag=tenant:42")).toEqual(["tagged-active", "tagged-off"]);
    });
  });

  describe("tombstones (D15)", () => {
    it("omits tombstoned links from the default list", async () => {
      await seedLink("live", { createdAt: T0 + 1000 });
      await seedLink("gone", { createdAt: T0 + 2000, deletedAt: T0 + 3000 });

      expect(await slugsOf()).toEqual(["live"]);
    });

    it("omits tombstoned links from every filter", async () => {
      await seedLink("gone", {
        createdAt: T0 + 2000,
        deletedAt: T0 + 3000,
        externalId: "appt_9182",
        tags: ["tenant:42"],
      });

      expect(await slugsOf("?tag=tenant:42")).toEqual([]);
      expect(await slugsOf("?external_id=appt_9182")).toEqual([]);
      expect(await slugsOf("?active=true")).toEqual([]);
      const since = encodeURIComponent(new Date(T0).toISOString());
      expect(await slugsOf(`?created_after=${since}`)).toEqual([]);
    });

    it("does not let a tombstone consume a page slot", async () => {
      await seedLink("live-1", { createdAt: T0 + 1000 });
      await seedLink("gone", { createdAt: T0 + 2000, deletedAt: T0 + 3000 });
      await seedLink("live-2", { createdAt: T0 + 3000 });

      const body = (await (await list("?limit=2")).json()) as ListBody;

      expect(body.links.map((l) => l.slug)).toEqual(["live-2", "live-1"]);
      expect(body.next_cursor).toBeNull();
    });
  });

  describe("query validation (schema from prompt 08)", () => {
    it("rejects limit=0", async () => {
      const res = await list("?limit=0");

      expect(res.status).toBe(400);
      expect(((await res.json()) as ErrorBody).error.code).toBe("invalid_request");
    });

    it("rejects limit=101", async () => {
      expect((await list("?limit=101")).status).toBe(400);
    });

    it("accepts the boundaries 1 and 100", async () => {
      expect((await list("?limit=1")).status).toBe(200);
      expect((await list("?limit=100")).status).toBe(200);
    });

    it("rejects a non-numeric limit", async () => {
      expect((await list("?limit=lots")).status).toBe(400);
    });

    it("rejects active=maybe", async () => {
      const res = await list("?active=maybe");

      expect(res.status).toBe(400);
      expect(((await res.json()) as ErrorBody).error.code).toBe("invalid_request");
    });

    it("rejects an unknown filter rather than widening the result set (D22)", async () => {
      const res = await list("?tenant=42");
      const body = (await res.json()) as ErrorBody;

      expect(res.status).toBe(400);
      expect(body.error.field).toBe("tenant");
    });

    it("rejects a created_after that is not ISO 8601", async () => {
      expect((await list("?created_after=yesterday")).status).toBe(400);
    });
  });

  it("answers 405, not 404, on a method the collection does not serve", async () => {
    const res = await createApiApp().request(
      "https://api.r301.dev/v1/links",
      { method: "DELETE", headers: authHeaders(key.key) },
      testBindings(),
    );

    expect(res.status).toBe(405);
  });
});
