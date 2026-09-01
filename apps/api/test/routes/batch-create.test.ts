import { env as testEnv } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createApiApp } from "../../src/routes/api";
import type { Env } from "../../src/types";
import { authHeaders, seedApiKey, type SeededApiKey } from "../helpers/auth";

let key: SeededApiKey;

beforeEach(async () => {
  key = await seedApiKey();
});

function bindings(overrides: Partial<Env> = {}): Env {
  return {
    DB: testEnv.DB,
    REDIRECTS: testEnv.REDIRECTS,
    ENVIRONMENT: "local",
    ...overrides,
  } as Env;
}

interface PostOptions {
  body?: unknown;
  raw?: string;
  headers?: Record<string, string>;
  env?: Env;
  reportError?: (err: unknown) => void;
}

function post(options: PostOptions = {}): Promise<Response> {
  const app = createApiApp(
    options.reportError === undefined ? {} : { reportError: options.reportError },
  );

  return Promise.resolve(
    app.request(
      "https://api.r301.dev/v1/links/batch",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(key.key),
          ...options.headers,
        },
        body: options.raw ?? JSON.stringify(options.body ?? {}),
      },
      options.env ?? bindings(),
    ),
  );
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

interface BatchItem {
  index: number;
  status: "created" | "error";
  link?: LinkBody;
  error?: { code: string; message: string; field?: string };
}

interface ErrorBody {
  error: { code: string; message: string; field?: string; request_id: string };
}

interface BatchBody {
  items: BatchItem[];
  summary: { created: number; failed: number };
}

function countLinks(): Promise<number> {
  return testEnv.DB.prepare("SELECT COUNT(*) AS n FROM links")
    .first<{ n: number }>()
    .then((row) => row?.n ?? 0);
}

describe("POST /v1/links/batch (api-contract §batch, PRD §7.2)", () => {
  describe("all items valid", () => {
    const body = {
      links: [
        { destination: "https://example.com/appt/1" },
        { destination: "https://example.com/appt/2" },
        { destination: "https://example.com/appt/3" },
      ],
    };

    it("answers 200 with one created item per request item, in order", async () => {
      const res = await post({ body });

      expect(res.status).toBe(200);
      const batch = await res.json<BatchBody>();
      expect(batch.items.map((item) => item.index)).toEqual([0, 1, 2]);
      expect(batch.items.map((item) => item.status)).toEqual(["created", "created", "created"]);
      expect(batch.items.map((item) => item.link?.destination)).toEqual([
        "https://example.com/appt/1",
        "https://example.com/appt/2",
        "https://example.com/appt/3",
      ]);
    });

    it("carries a full Link resource on each created item", async () => {
      const batch = await (await post({ body })).json<BatchBody>();
      const link = batch.items[0]?.link;

      expect(Object.keys(link ?? {}).sort()).toEqual([
        "created_at",
        "destination",
        "expires_at",
        "external_id",
        "is_active",
        "redirect_type",
        "short_url",
        "slug",
        "tags",
        "updated_at",
      ]);
      expect(link?.redirect_type).toBe(302);
      expect(link?.is_active).toBe(true);
      expect(link?.short_url).toBe(`http://127.0.0.1:8787/${link?.slug}`);
    });

    it("summarizes the batch as three created, none failed", async () => {
      const batch = await (await post({ body })).json<BatchBody>();

      expect(batch.summary).toEqual({ created: 3, failed: 0 });
    });

    it("persists three D1 rows and three KV entries", async () => {
      const batch = await (await post({ body })).json<BatchBody>();

      expect(await countLinks()).toBe(3);

      for (const item of batch.items) {
        expect(await testEnv.REDIRECTS.get(item.link?.slug as string, "json")).toEqual({
          d: item.link?.destination,
          t: 302,
          x: null,
          a: 1,
        });
      }
    });

    // D12: attribution only, but it must be the *caller's* key on every row —
    // a batch is still one authenticated request.
    it("attributes every created row to the calling key", async () => {
      await post({ body });

      const rows = await testEnv.DB.prepare(
        "SELECT DISTINCT created_by_key_id AS id FROM links",
      ).all<{ id: number }>();

      expect(rows.results.map((row) => row.id)).toEqual([key.id]);
    });
  });

  // §7.2: the batch never all-or-nothing fails. One bad item is one error
  // entry; its neighbours are created regardless.
  describe("mixed batch", () => {
    beforeEach(async () => {
      await testEnv.DB.prepare(
        `INSERT INTO links (slug, destination, created_by_key_id, created_at, updated_at)
         VALUES ('taken', 'https://example.com/', ?1, 0, 0)`,
      )
        .bind(key.id)
        .run();
    });

    const body = {
      links: [
        { destination: "https://example.com/ok" },
        { destination: "javascript:alert(1)" },
        { destination: "https://example.com/dupe", slug: "taken" },
      ],
    };

    it("still answers 200", async () => {
      expect((await post({ body })).status).toBe(200);
    });

    it("reports per-item status in request order", async () => {
      const batch = await (await post({ body })).json<BatchBody>();

      expect(batch.items.map((item) => item.status)).toEqual(["created", "error", "error"]);
      expect(batch.summary).toEqual({ created: 1, failed: 2 });
    });

    it("carries the contract's code and field on each failed item", async () => {
      const batch = await (await post({ body })).json<BatchBody>();

      expect(batch.items[1]?.error?.code).toBe("destination_invalid");
      expect(batch.items[1]?.error?.field).toBe("destination");
      expect(batch.items[2]?.error).toMatchObject({ code: "slug_taken", field: "slug" });
    });

    it("persists the valid item and nothing from the failed ones", async () => {
      const batch = await (await post({ body })).json<BatchBody>();

      // One seeded + one created.
      expect(await countLinks()).toBe(2);
      expect(await testEnv.REDIRECTS.get(batch.items[0]?.link?.slug as string)).not.toBeNull();

      const destinations = await testEnv.DB.prepare(
        "SELECT destination FROM links ORDER BY id",
      ).all<{ destination: string }>();
      expect(destinations.results.map((row) => row.destination)).toEqual([
        "https://example.com/",
        "https://example.com/ok",
      ]);
    });

    it("names the offending field on an unknown-field item (D22)", async () => {
      const batch = await (
        await post({
          body: {
            links: [{ destination: "https://example.com/", destinaton: "typo" }],
          },
        })
      ).json<BatchBody>();

      expect(batch.items[0]?.error).toMatchObject({
        code: "invalid_request",
        field: "destinaton",
      });
    });
  });

  // Sequential execution (§7.2) is what gives this its defined outcome: the
  // second item meets the first item's committed row.
  describe("a custom slug repeated inside one batch", () => {
    const body = {
      links: [
        { destination: "https://example.com/first", slug: "appt-2026-09" },
        { destination: "https://example.com/second", slug: "appt-2026-09" },
      ],
    };

    it("creates the first and fails the second as slug_taken", async () => {
      const batch = await (await post({ body })).json<BatchBody>();

      expect(batch.items[0]?.status).toBe("created");
      expect(batch.items[0]?.link?.slug).toBe("appt-2026-09");
      expect(batch.items[1]?.error?.code).toBe("slug_taken");
      expect(batch.summary).toEqual({ created: 1, failed: 1 });
    });

    it("stores the first item's destination, not the second's", async () => {
      await post({ body });

      const row = await testEnv.DB.prepare(
        "SELECT destination FROM links WHERE slug = 'appt-2026-09'",
      ).first<{ destination: string }>();

      expect(await countLinks()).toBe(1);
      expect(row?.destination).toBe("https://example.com/first");
    });
  });

  // A fault of the request as a whole — unlike a bad item, this one *is*
  // all-or-nothing, and the contract puts it before any work (api-contract
  // §batch: ">100 → 400 before any work").
  describe("wrapper-level rejection", () => {
    function manyLinks(n: number): unknown {
      return {
        links: Array.from({ length: n }, (_unused, i) => ({
          destination: `https://example.com/${i}`,
        })),
      };
    }

    it("rejects 101 items as 400 invalid_request", async () => {
      const res = await post({ body: manyLinks(101) });

      expect(res.status).toBe(400);
      expect((await res.json<ErrorBody>()).error.code).toBe("invalid_request");
    });

    it("inserts nothing when the cap is exceeded", async () => {
      await post({ body: manyLinks(101) });

      expect(await countLinks()).toBe(0);
    });

    it("accepts exactly 100 items", async () => {
      const res = await post({ body: manyLinks(100) });

      expect(res.status).toBe(200);
      expect((await res.json<BatchBody>()).summary).toEqual({ created: 100, failed: 0 });
    });

    it.each([
      ["an empty array", { links: [] }],
      ["a non-array", { links: "nope" }],
      ["a missing key", {}],
      ["an unknown wrapper field (D22)", { links: [{ destination: "https://a.co/" }], n: 1 }],
    ])("rejects %s as 400", async (_name, body) => {
      const res = await post({ body });

      expect(res.status).toBe(400);
      expect((await res.json<ErrorBody>()).error.code).toBe("invalid_request");
      expect(await countLinks()).toBe(0);
    });
  });

  // D20: the KV put is awaited, so its failure is the item's failure — but
  // only that item's. §7.2 forbids one item ending the batch.
  describe("a KV put that fails mid-batch", () => {
    /** Fails the nth put (1-based); every other put is the real binding. */
    function kvFailingOnPut(n: number): Env {
      let puts = 0;

      return bindings({
        REDIRECTS: {
          ...testEnv.REDIRECTS,
          put: (slug: string, value: string) => {
            puts += 1;

            return puts === n
              ? Promise.reject(new Error("KV unavailable"))
              : testEnv.REDIRECTS.put(slug, value);
          },
        } as unknown as KVNamespace,
      });
    }

    const body = {
      links: [
        { destination: "https://example.com/1" },
        { destination: "https://example.com/2" },
        { destination: "https://example.com/3" },
      ],
    };

    it("still answers 200", async () => {
      const res = await post({ body, env: kvFailingOnPut(2), reportError: () => undefined });

      expect(res.status).toBe(200);
    });

    it("marks only that item as internal and processes the rest", async () => {
      const batch = await (
        await post({ body, env: kvFailingOnPut(2), reportError: () => undefined })
      ).json<BatchBody>();

      expect(batch.items.map((item) => item.status)).toEqual(["created", "error", "created"]);
      expect(batch.items[1]?.error?.code).toBe("internal");
      expect(batch.summary).toEqual({ created: 2, failed: 1 });
    });

    it("leaves the failed item's D1 row behind, as single create does (D20)", async () => {
      await post({ body, env: kvFailingOnPut(2), reportError: () => undefined });

      // All three rows committed; only the KV entry is missing, which a retry
      // with the same Idempotency-Key heals.
      expect(await countLinks()).toBe(3);
    });

    it("does not leak the destination into the item's message", async () => {
      const batch = await (
        await post({ body, env: kvFailingOnPut(2), reportError: () => undefined })
      ).json<BatchBody>();

      expect(batch.items[1]?.error?.message).not.toContain("example.com");
    });
  });

  // PRD §8 / D18: one key covers the whole batch (§7.2).
  describe("Idempotency-Key over a batch", () => {
    const body = {
      links: [
        { destination: "https://example.com/a" },
        { destination: "https://example.com/b" },
      ],
    };
    const headers = { "Idempotency-Key": "batch-key-1" };

    it("replays the stored per-item results byte-identically", async () => {
      const first = await (await post({ body, headers })).text();
      const replay = await post({ body, headers });

      expect(replay.status).toBe(200);
      expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
      expect(await replay.text()).toBe(first);
    });

    it("creates no new rows on replay", async () => {
      await post({ body, headers });
      const after = await countLinks();

      await post({ body, headers });

      expect(await countLinks()).toBe(after);
      expect(after).toBe(2);
    });

    it("stores the batch's own 200, not a per-item status", async () => {
      await post({ body, headers });

      const row = await testEnv.DB.prepare(
        "SELECT response_status AS status FROM idempotency_keys WHERE key = 'batch-key-1'",
      ).first<{ status: number }>();

      expect(row?.status).toBe(200);
    });
  });

  // The path collides with `/v1/links/:slug`; registration order is what keeps
  // it reachable (see registerLinkRoutes).
  describe("route registration order", () => {
    it("does not let the :slug 405 guard swallow the batch POST", async () => {
      expect((await post({ body: { links: [{ destination: "https://a.co/" }] } })).status).toBe(
        200,
      );
    });

    it("answers 405 on a wrong method rather than treating 'batch' as a slug", async () => {
      const app = createApiApp();
      const res = await app.request(
        "https://api.r301.dev/v1/links/batch",
        { method: "GET", headers: authHeaders(key.key) },
        bindings(),
      );

      expect(res.status).toBe(405);
      expect((await res.json<ErrorBody>()).error.code).toBe("method_not_allowed");
    });
  });
});
