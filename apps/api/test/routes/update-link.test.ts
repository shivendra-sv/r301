import { env as testEnv } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { RedirectEntry } from "../../src/kv/redirects-cache";
import { createApiApp } from "../../src/routes/api";
import { createRedirectApp } from "../../src/routes/redirect";
import type { Env } from "../../src/types";
import { authHeaders, seedApiKey, testBindings, type SeededApiKey } from "../helpers/auth";

let key: SeededApiKey;

beforeEach(async () => {
  key = await seedApiKey();
});

/** Well past any real clock this suite runs under, so the bump is unambiguous. */
const PATCH_AT = 1_790_000_000_000;

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

/** Created through the real POST route, so KV is written by production code. */
async function createLink(body: Record<string, unknown> = {}): Promise<LinkBody> {
  const res = await createApiApp().request(
    "https://api.r301.dev/v1/links",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(key.key) },
      body: JSON.stringify({ destination: "https://clinic.example.com/appt/9182", ...body }),
    },
    testBindings(),
  );

  expect(res.status).toBe(201);
  return (await res.json()) as LinkBody;
}

interface PatchOptions {
  env?: Env;
  now?: () => number;
  headers?: Record<string, string>;
  raw?: string;
  reportError?: (err: unknown) => void;
}

function patch(slug: string, body: unknown, options: PatchOptions = {}): Promise<Response> {
  const app = createApiApp({
    now: options.now ?? (() => PATCH_AT),
    ...(options.reportError === undefined ? {} : { reportError: options.reportError }),
  });

  return Promise.resolve(
    app.request(
      `https://api.r301.dev/v1/links/${slug}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(key.key),
          ...options.headers,
        },
        body: options.raw ?? JSON.stringify(body),
      },
      options.env ?? testBindings(),
    ),
  );
}

function kvEntry(slug: string): Promise<RedirectEntry | null> {
  return testEnv.REDIRECTS.get<RedirectEntry>(slug, "json");
}

function row(slug: string) {
  return testEnv.DB.prepare("SELECT * FROM links WHERE slug = ?1")
    .bind(slug)
    .first<Record<string, unknown>>();
}

function redirectTo(slug: string): Promise<Response> {
  return Promise.resolve(
    createRedirectApp().request(`https://r301.dev/${slug}`, {}, testBindings()),
  );
}

describe("PATCH /v1/links/{slug} (api-contract §PATCH)", () => {
  describe("destination", () => {
    it("returns the updated Link", async () => {
      const created = await createLink();

      const res = await patch(created.slug, { destination: "https://clinic.example.com/new" });
      const body = (await res.json()) as LinkBody;

      expect(res.status).toBe(200);
      expect(body.destination).toBe("https://clinic.example.com/new");
      expect(body.slug).toBe(created.slug);
    });

    it("writes the new destination to D1", async () => {
      const created = await createLink();

      await patch(created.slug, { destination: "https://clinic.example.com/new" });

      expect((await row(created.slug))?.destination).toBe("https://clinic.example.com/new");
    });

    it("bumps updated_at to the time of the write, leaving created_at alone", async () => {
      const created = await createLink();

      const body = (await (
        await patch(created.slug, { destination: "https://clinic.example.com/new" })
      ).json()) as LinkBody;

      expect(body.updated_at).toBe(new Date(PATCH_AT).toISOString());
      expect(body.created_at).toBe(created.created_at);
      expect(Date.parse(body.updated_at)).toBeGreaterThan(Date.parse(body.created_at));
    });

    it("converges KV before responding — the put is awaited (D20)", async () => {
      const created = await createLink();

      // No polling and no delay: if the put were fire-and-forget this read
      // would still see the old destination.
      await patch(created.slug, { destination: "https://clinic.example.com/new" });

      expect((await kvEntry(created.slug))?.d).toBe("https://clinic.example.com/new");
    });

    it("leaves untouched fields alone", async () => {
      const created = await createLink({ redirect_type: 307, external_id: "appt_9182" });

      const body = (await (
        await patch(created.slug, { destination: "https://clinic.example.com/new" })
      ).json()) as LinkBody;

      expect(body.redirect_type).toBe(307);
      expect(body.external_id).toBe("appt_9182");
      expect(body.is_active).toBe(true);
    });
  });

  describe("is_active — the takedown switch (D26.3)", () => {
    it("writes a:0 to KV", async () => {
      const created = await createLink();

      await patch(created.slug, { is_active: false });

      expect((await kvEntry(created.slug))?.a).toBe(0);
    });

    it("makes the redirect 404 the slug", async () => {
      const created = await createLink();
      expect((await redirectTo(created.slug)).status).toBe(302);

      await patch(created.slug, { is_active: false });

      expect((await redirectTo(created.slug)).status).toBe(404);
    });

    it("serves the redirect again once reactivated", async () => {
      const created = await createLink();
      await patch(created.slug, { is_active: false });
      expect((await redirectTo(created.slug)).status).toBe(404);

      await patch(created.slug, { is_active: true });

      const res = await redirectTo(created.slug);
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("https://clinic.example.com/appt/9182");
    });

    it("keeps the link readable while deactivated — this is not a delete", async () => {
      const created = await createLink();

      await patch(created.slug, { is_active: false });

      const body = (await (
        await createApiApp().request(
          `https://api.r301.dev/v1/links/${created.slug}`,
          { headers: authHeaders(key.key) },
          testBindings(),
        )
      ).json()) as LinkBody;

      expect(body.is_active).toBe(false);
    });
  });

  describe("expires_at", () => {
    const future = "2027-09-30T12:00:00.000Z";

    it("writes the new expiry to KV", async () => {
      const created = await createLink();

      await patch(created.slug, { expires_at: future });

      expect((await kvEntry(created.slug))?.x).toBe(Date.parse(future));
    });

    it("rejects an expiry in the past (D26.3)", async () => {
      const created = await createLink();

      const res = await patch(created.slug, { expires_at: "2020-01-01T00:00:00.000Z" });

      expect(res.status).toBe(400);
      expect(((await res.json()) as ErrorBody).error.field).toBe("expires_at");
    });

    it("clears the expiry in D1 when set to null", async () => {
      const created = await createLink({ expires_at: future });

      const body = (await (await patch(created.slug, { expires_at: null })).json()) as LinkBody;

      expect(body.expires_at).toBeNull();
      expect((await row(created.slug))?.expires_at).toBeNull();
    });

    it("clears the expiry in KV when set to null", async () => {
      const created = await createLink({ expires_at: future });

      await patch(created.slug, { expires_at: null });

      expect((await kvEntry(created.slug))?.x).toBeNull();
    });
  });

  describe("redirect_type", () => {
    it("writes the new type to KV", async () => {
      const created = await createLink();

      await patch(created.slug, { redirect_type: 301 });

      expect((await kvEntry(created.slug))?.t).toBe(301);
    });

    it("changes what the redirect emits, headers included", async () => {
      const created = await createLink();

      await patch(created.slug, { redirect_type: 301 });

      const res = await redirectTo(created.slug);
      expect(res.status).toBe(301);
      expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
    });
  });

  describe("tags replace wholesale (D26.5)", () => {
    it("replaces the set rather than merging it", async () => {
      const created = await createLink({ tags: ["a", "b"] });

      const body = (await (await patch(created.slug, { tags: ["b", "c"] })).json()) as LinkBody;

      expect(body.tags).toEqual(["b", "c"]);
    });

    it("drops the removed tag's link_tags row", async () => {
      const created = await createLink({ tags: ["a", "b"] });

      await patch(created.slug, { tags: ["b", "c"] });

      const read = await createApiApp().request(
        `https://api.r301.dev/v1/links/${created.slug}`,
        { headers: authHeaders(key.key) },
        testBindings(),
      );
      expect(((await read.json()) as LinkBody).tags).toEqual(["b", "c"]);
    });

    it("clears every tag when given an empty array", async () => {
      const created = await createLink({ tags: ["a", "b"] });

      const body = (await (await patch(created.slug, { tags: [] })).json()) as LinkBody;

      expect(body.tags).toEqual([]);
    });

    it("leaves the orphaned tag row in place — v1 does not prune (documented)", async () => {
      const created = await createLink({ tags: ["a", "b"] });

      const body = (await (await patch(created.slug, { tags: [] })).json()) as LinkBody;
      expect(body.tags).toEqual([]);

      // The `tags` rows outlive their last link_tags reference: nothing in v1
      // prunes them, and the next link to use "a" reuses the row.
      const orphan = await testEnv.DB.prepare("SELECT COUNT(*) AS n FROM tags").first<{
        n: number;
      }>();
      expect(orphan?.n).toBe(2);
    });

    it("leaves tags untouched when the field is absent", async () => {
      const created = await createLink({ tags: ["a", "b"] });

      const body = (await (
        await patch(created.slug, { destination: "https://clinic.example.com/new" })
      ).json()) as LinkBody;

      expect(body.tags).toEqual(["a", "b"]);
    });

    it("returns the set as stored, not the array it was handed", async () => {
      const created = await createLink({ tags: ["a"] });

      // `link_tags` is keyed (link_id, tag_id), so a repeated tag stores one
      // row. Echoing the request would claim two and disagree with the next GET.
      const body = (await (await patch(created.slug, { tags: ["b", "b"] })).json()) as LinkBody;

      expect(body.tags).toEqual(["b"]);
    });

    it("agrees with what a subsequent GET reports", async () => {
      const created = await createLink({ tags: ["a", "b"] });

      const patched = (await (
        await patch(created.slug, { tags: ["c", "a"] })
      ).json()) as LinkBody;
      const read = (await (
        await createApiApp().request(
          `https://api.r301.dev/v1/links/${created.slug}`,
          { headers: authHeaders(key.key) },
          testBindings(),
        )
      ).json()) as LinkBody;

      expect(patched.tags).toEqual(read.tags);
      expect(patched.tags).toEqual(["c", "a"]);
    });

    it("keeps the caller's order, so a link reads back as it was written", async () => {
      const created = await createLink({ tags: ["a"] });

      const body = (await (await patch(created.slug, { tags: ["z", "b"] })).json()) as LinkBody;

      expect(body.tags).toEqual(["z", "b"]);
    });
  });

  describe("external_id (D19)", () => {
    async function listBy(query: string): Promise<string[]> {
      const res = await createApiApp().request(
        `https://api.r301.dev/v1/links?${query}`,
        { headers: authHeaders(key.key) },
        testBindings(),
      );
      expect(res.status).toBe(200);
      return ((await res.json()) as { links: LinkBody[] }).links.map((l) => l.slug);
    }

    it("sets the correlation id and makes the list filter find it", async () => {
      const created = await createLink();

      await patch(created.slug, { external_id: "appt_9182" });

      expect(await listBy("external_id=appt_9182")).toEqual([created.slug]);
    });

    it("clears it when set to null, and the filter stops matching", async () => {
      const created = await createLink({ external_id: "appt_9182" });

      const body = (await (await patch(created.slug, { external_id: null })).json()) as LinkBody;

      expect(body.external_id).toBeNull();
      expect(await listBy("external_id=appt_9182")).toEqual([]);
    });
  });

  describe("strictness and errors", () => {
    it("rejects slug in the body as an unknown field — slug is immutable (§7.1)", async () => {
      const created = await createLink();

      const res = await patch(created.slug, { slug: "renamed" });
      const body = (await res.json()) as ErrorBody;

      expect(res.status).toBe(400);
      expect(body.error.code).toBe("invalid_request");
      expect(body.error.field).toBe("slug");
    });

    it("rejects an empty body (D26.5)", async () => {
      const created = await createLink();

      const res = await patch(created.slug, {});

      expect(res.status).toBe(400);
      expect(((await res.json()) as ErrorBody).error.code).toBe("invalid_request");
    });

    it("rejects an unknown field", async () => {
      const created = await createLink();

      const res = await patch(created.slug, { tenant: "42" });

      expect(res.status).toBe(400);
      expect(((await res.json()) as ErrorBody).error.field).toBe("tenant");
    });

    it("runs the full destination battery on the new value", async () => {
      const created = await createLink();

      const res = await patch(created.slug, { destination: "javascript:alert(1)" });

      expect(res.status).toBe(422);
      expect(((await res.json()) as ErrorBody).error.code).toBe("destination_invalid");
    });

    it("rejects a private-IP destination, as create does", async () => {
      const created = await createLink();

      expect((await patch(created.slug, { destination: "http://127.0.0.1/" })).status).toBe(422);
    });

    it("returns 404 for an unknown slug", async () => {
      expect((await patch("nosuch", { is_active: false })).status).toBe(404);
    });

    it("returns 404 for a tombstoned link (D15)", async () => {
      const created = await createLink();
      await testEnv.DB.prepare("UPDATE links SET deleted_at = ?2 WHERE slug = ?1")
        .bind(created.slug, PATCH_AT)
        .run();

      expect((await patch(created.slug, { is_active: false })).status).toBe(404);
    });

    it("does not touch D1 when validation fails", async () => {
      const created = await createLink();

      const res = await patch(created.slug, { destination: "javascript:alert(1)" });

      expect(res.status).toBe(422);
      expect((await row(created.slug))?.destination).toBe("https://clinic.example.com/appt/9182");
    });

    it("requires a key", async () => {
      const created = await createLink();

      const res = await createApiApp().request(
        `https://api.r301.dev/v1/links/${created.slug}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_active: false }),
        },
        testBindings(),
      );

      expect(res.status).toBe(401);
    });
  });

  // D20: the put is awaited, so its failure is the request's failure. The D1
  // row is left updated on purpose — an identical retry converges.
  describe("KV failure (D20)", () => {
    function throwingKv(): Env {
      return {
        ...testBindings(),
        REDIRECTS: {
          ...testEnv.REDIRECTS,
          put: () => Promise.reject(new Error("KV unavailable")),
        } as unknown as KVNamespace,
      };
    }

    it("returns 500 internal", async () => {
      const created = await createLink();

      const res = await patch(
        created.slug,
        { destination: "https://clinic.example.com/new" },
        { env: throwingKv(), reportError: () => undefined },
      );

      expect(res.status).toBe(500);
      expect(((await res.json()) as ErrorBody).error.code).toBe("internal");
    });

    it("leaves the D1 row updated — documented state, healed by a retry", async () => {
      const created = await createLink();

      await patch(
        created.slug,
        { destination: "https://clinic.example.com/new" },
        { env: throwingKv(), reportError: () => undefined },
      );

      expect((await row(created.slug))?.destination).toBe("https://clinic.example.com/new");
    });
  });
});
