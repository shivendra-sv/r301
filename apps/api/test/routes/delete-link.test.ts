import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env as testEnv } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createApiApp } from "../../src/routes/api";
import { createRedirectApp } from "../../src/routes/redirect";
import type { Env } from "../../src/types";
import { authHeaders, seedApiKey, testBindings, type SeededApiKey } from "../helpers/auth";

let key: SeededApiKey;

beforeEach(async () => {
  key = await seedApiKey();
});

/** Well past any real clock this suite runs under, so the tombstone is unambiguous. */
const DELETE_AT = 1_790_000_000_000;

interface LinkBody {
  slug: string;
  destination: string;
  tags: string[];
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

function post(body: Record<string, unknown>): Promise<Response> {
  return Promise.resolve(
    createApiApp().request(
      "https://api.r301.dev/v1/links",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(key.key) },
        body: JSON.stringify(body),
      },
      testBindings(),
    ),
  );
}

interface DeleteOptions {
  env?: Env;
  headers?: Record<string, string>;
  reportError?: (err: unknown) => void;
}

function del(slug: string, options: DeleteOptions = {}): Promise<Response> {
  const app = createApiApp({
    now: () => DELETE_AT,
    ...(options.reportError === undefined ? {} : { reportError: options.reportError }),
  });

  return Promise.resolve(
    app.request(
      `https://api.r301.dev/v1/links/${slug}`,
      {
        method: "DELETE",
        headers: { ...authHeaders(key.key), ...options.headers },
      },
      options.env ?? testBindings(),
    ),
  );
}

/**
 * For tests whose premise is "after a successful delete" — asserting the 204
 * here stops them passing vacuously when DELETE is broken or unrouted.
 */
async function deleteOk(slug: string): Promise<void> {
  expect((await del(slug)).status).toBe(204);
}

function getOne(slug: string): Promise<Response> {
  return Promise.resolve(
    createApiApp().request(
      `https://api.r301.dev/v1/links/${slug}`,
      { headers: authHeaders(key.key) },
      testBindings(),
    ),
  );
}

async function listSlugs(query = ""): Promise<string[]> {
  const res = await createApiApp().request(
    `https://api.r301.dev/v1/links?${query}`,
    { headers: authHeaders(key.key) },
    testBindings(),
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as { links: LinkBody[] }).links.map((l) => l.slug);
}

function row(slug: string) {
  return testEnv.DB.prepare("SELECT * FROM links WHERE slug = ?1")
    .bind(slug)
    .first<Record<string, unknown>>();
}

describe("DELETE /v1/links/{slug} (api-contract §DELETE, D15)", () => {
  describe("the tombstone", () => {
    it("returns 204", async () => {
      const created = await createLink();

      expect((await del(created.slug)).status).toBe(204);
    });

    it("returns no body (D26.7)", async () => {
      const created = await createLink();

      const res = await del(created.slug);

      expect(await res.text()).toBe("");
    });

    it("sets deleted_at rather than removing the row", async () => {
      const created = await createLink();

      await deleteOk(created.slug);

      const stored = await row(created.slug);
      expect(stored).not.toBeNull();
      expect(stored?.deleted_at).toBe(DELETE_AT);
    });

    it("keeps the destination on the tombstoned row — this is a soft delete", async () => {
      const created = await createLink();

      await deleteOk(created.slug);

      expect((await row(created.slug))?.destination).toBe("https://clinic.example.com/appt/9182");
    });

    it("removes the KV entry before responding — the delete is awaited (D20)", async () => {
      const created = await createLink();
      expect(await testEnv.REDIRECTS.get(created.slug)).not.toBeNull();

      await deleteOk(created.slug);

      expect(await testEnv.REDIRECTS.get(created.slug)).toBeNull();
    });
  });

  describe("the redirect surface (D17)", () => {
    it("404s the deleted slug", async () => {
      const created = await createLink();
      await deleteOk(created.slug);

      const ctx = createExecutionContext();
      const res = await createRedirectApp().request(
        `https://r301.dev/${created.slug}`,
        {},
        testBindings(),
        ctx,
      );
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(404);
    });

    it("does not backfill the tombstone into KV (no negative caching, D20)", async () => {
      const created = await createLink();
      await deleteOk(created.slug);

      const ctx = createExecutionContext();
      await createRedirectApp().request(`https://r301.dev/${created.slug}`, {}, testBindings(), ctx);
      await waitOnExecutionContext(ctx);

      // The D1 row still exists, so a fallthrough that forgot to check
      // `deleted_at` would repopulate the cache and resurrect the link.
      expect(await testEnv.REDIRECTS.get(created.slug)).toBeNull();
    });

    it("is indistinguishable from a slug that never existed", async () => {
      const created = await createLink();
      await deleteOk(created.slug);

      const ctx = createExecutionContext();
      const deleted = await createRedirectApp().request(
        `https://r301.dev/${created.slug}`,
        {},
        testBindings(),
        ctx,
      );
      const unknown = await createRedirectApp().request(
        "https://r301.dev/neverexisted",
        {},
        testBindings(),
        ctx,
      );
      await waitOnExecutionContext(ctx);

      expect(deleted.status).toBe(unknown.status);
      expect(await deleted.text()).toBe(await unknown.text());
    });
  });

  describe("the API surface", () => {
    it("makes GET /v1/links/{slug} 404", async () => {
      const created = await createLink();
      await deleteOk(created.slug);

      expect((await getOne(created.slug)).status).toBe(404);
    });

    it("drops the link from the list", async () => {
      const created = await createLink();
      const survivor = await createLink({ slug: "kept-alive" });

      await deleteOk(created.slug);

      expect(await listSlugs()).toEqual([survivor.slug]);
    });

    it("drops the link from a tag-filtered list", async () => {
      const created = await createLink({ tags: ["tenant:42"] });

      await deleteOk(created.slug);

      expect(await listSlugs("tag=tenant:42")).toEqual([]);
    });

    it("makes PATCH 404 — a tombstone cannot be updated back to life", async () => {
      const created = await createLink();
      await deleteOk(created.slug);

      const res = await createApiApp().request(
        `https://api.r301.dev/v1/links/${created.slug}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...authHeaders(key.key) },
          body: JSON.stringify({ is_active: true }),
        },
        testBindings(),
      );

      expect(res.status).toBe(404);
    });
  });

  describe("repeat and unknown deletes", () => {
    it("404s a second delete of the same slug", async () => {
      const created = await createLink();
      expect((await del(created.slug)).status).toBe(204);

      expect((await del(created.slug)).status).toBe(404);
    });

    it("404s an unknown slug", async () => {
      expect((await del("nosuchslug")).status).toBe(404);
    });

    it("renders the contract's envelope on 404", async () => {
      const res = await del("nosuchslug");
      const body = (await res.json()) as ErrorBody;

      expect(body.error.code).toBe("not_found");
      expect(body.error.request_id).toBe(res.headers.get("X-Request-Id"));
    });

    it("requires a key", async () => {
      const created = await createLink();

      const res = await createApiApp().request(
        `https://api.r301.dev/v1/links/${created.slug}`,
        { method: "DELETE" },
        testBindings(),
      );

      expect(res.status).toBe(401);
      expect((await row(created.slug))?.deleted_at).toBeNull();
    });
  });

  // D15's whole point: UNIQUE(slug) spans tombstones, so the slug stays
  // blocked until the P1 purge cron. Asserted end-to-end through the route,
  // not just against the slug service.
  describe("slug reuse is blocked (D15)", () => {
    it("409s a recreate of the deleted slug", async () => {
      const created = await createLink({ slug: "clinic-launch" });
      await deleteOk(created.slug);

      const res = await post({ slug: "clinic-launch", destination: "https://example.com/other" });

      expect(res.status).toBe(409);
      expect(((await res.json()) as ErrorBody).error.code).toBe("slug_taken");
    });

    it("leaves the tombstone untouched by the rejected recreate", async () => {
      const created = await createLink({ slug: "clinic-launch" });
      await deleteOk(created.slug);

      await post({ slug: "clinic-launch", destination: "https://example.com/other" });

      const stored = await row("clinic-launch");
      expect(stored?.deleted_at).toBe(DELETE_AT);
      expect(stored?.destination).toBe("https://clinic.example.com/appt/9182");
    });

    it("does not resurrect the KV entry when the recreate is rejected", async () => {
      const created = await createLink({ slug: "clinic-launch" });
      await deleteOk(created.slug);

      await post({ slug: "clinic-launch", destination: "https://example.com/other" });

      expect(await testEnv.REDIRECTS.get("clinic-launch")).toBeNull();
    });
  });

  // The cascade on link_tags fires only when a links row is really deleted,
  // which v1 never does — the P1 purge cron (prompt 28) is what triggers it.
  describe("link_tags survive the tombstone", () => {
    async function tagRowCount(slug: string): Promise<number> {
      const counted = await testEnv.DB.prepare(
        `SELECT COUNT(*) AS n FROM link_tags lt
           JOIN links l ON l.id = lt.link_id WHERE l.slug = ?1`,
      )
        .bind(slug)
        .first<{ n: number }>();

      return counted?.n ?? 0;
    }

    it("keeps the link_tags rows", async () => {
      const created = await createLink({ tags: ["tenant:42", "kind:appointment"] });
      expect(await tagRowCount(created.slug)).toBe(2);

      await deleteOk(created.slug);

      expect(await tagRowCount(created.slug)).toBe(2);
    });

    it("keeps the tags rows themselves", async () => {
      const created = await createLink({ tags: ["tenant:42"] });

      await deleteOk(created.slug);

      const counted = await testEnv.DB.prepare("SELECT COUNT(*) AS n FROM tags").first<{
        n: number;
      }>();
      expect(counted?.n).toBe(1);
    });

    it("shows none of it to a caller", async () => {
      const created = await createLink({ tags: ["tenant:42"] });

      await deleteOk(created.slug);

      expect((await getOne(created.slug)).status).toBe(404);
      expect(await listSlugs("tag=tenant:42")).toEqual([]);
    });
  });

  // D20: the KV delete is awaited, so its failure is the request's failure.
  // The tombstone is left set on purpose — the retry converges.
  describe("KV failure (D20)", () => {
    function throwingKv(): Env {
      return {
        ...testBindings(),
        REDIRECTS: {
          ...testEnv.REDIRECTS,
          delete: () => Promise.reject(new Error("KV unavailable")),
        } as unknown as KVNamespace,
      };
    }

    it("returns 500 internal", async () => {
      const created = await createLink();

      const res = await del(created.slug, { env: throwingKv(), reportError: () => undefined });

      expect(res.status).toBe(500);
      expect(((await res.json()) as ErrorBody).error.code).toBe("internal");
    });

    it("leaves the tombstone set — documented state, healed by a retry", async () => {
      const created = await createLink();

      await del(created.slug, { env: throwingKv(), reportError: () => undefined });

      expect((await row(created.slug))?.deleted_at).toBe(DELETE_AT);
    });

    it("404s the retry, since the tombstone already landed (documented)", async () => {
      const created = await createLink();
      await del(created.slug, { env: throwingKv(), reportError: () => undefined });

      // The contract accepts this: DELETE is idempotent-shaped, but a completed
      // tombstone reports 404 on the retry that heals KV.
      expect((await del(created.slug)).status).toBe(404);
    });
  });
});
