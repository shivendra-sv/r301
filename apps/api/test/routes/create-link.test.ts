import { env as testEnv } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
      "https://api.r301.dev/v1/links",
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

interface ErrorBody {
  error: { code: string; message: string; field?: string; request_id: string };
}

async function seedLink(slug: string, deletedAt: number | null = null): Promise<void> {
  await testEnv.DB.prepare(
    `INSERT INTO links (slug, destination, created_by_key_id, deleted_at, created_at, updated_at)
     VALUES (?1, 'https://example.com/', ?2, ?3, 0, 0)`,
  )
    .bind(slug, key.id, deletedAt)
    .run();
}

describe("POST /v1/links (api-contract §POST /v1/links)", () => {
  describe("minimal body", () => {
    it("creates a link with contract defaults", async () => {
      const res = await post({ body: { destination: "https://example.com/appt/1" } });

      expect(res.status).toBe(201);
      const link = await res.json<LinkBody>();
      expect(link.destination).toBe("https://example.com/appt/1");
      expect(link.redirect_type).toBe(302);
      expect(link.is_active).toBe(true);
      expect(link.expires_at).toBeNull();
      expect(link.external_id).toBeNull();
      expect(link.tags).toEqual([]);
    });

    it("assigns a 7-char base62 auto-slug", async () => {
      const link = await (await post({ body: { destination: "https://example.com/" } })).json<LinkBody>();

      expect(link.slug).toMatch(/^[0-9A-Za-z]{7}$/);
    });

    it("builds short_url from the environment's redirect host", async () => {
      const link = await (await post({ body: { destination: "https://example.com/" } })).json<LinkBody>();

      expect(link.short_url).toBe(`http://127.0.0.1:8787/${link.slug}`);
    });

    it("renders timestamps as ISO 8601 UTC", async () => {
      const link = await (await post({ body: { destination: "https://example.com/" } })).json<LinkBody>();

      expect(link.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(link.updated_at).toBe(link.created_at);
    });

    // Resolved as PROGRESS question 24: one clock for every route in the file.
    it("stamps created_at from the injected clock", async () => {
      const at = 1_790_000_000_000;
      const res = await createApiApp({ now: () => at }).request(
        "https://api.r301.dev/v1/links",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders(key.key) },
          body: JSON.stringify({ destination: "https://example.com/" }),
        },
        bindings(),
      );
      const link = await res.json<LinkBody>();

      expect(link.created_at).toBe(new Date(at).toISOString());
      expect(link.updated_at).toBe(link.created_at);
    });

    it("returns the Link resource and nothing else — no counts (D26)", async () => {
      const link = await (await post({ body: { destination: "https://example.com/" } })).json<LinkBody>();

      expect(Object.keys(link).sort()).toEqual([
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
    });
  });

  it("echoes every field of a full body", async () => {
    const res = await post({
      body: {
        destination: "https://clinic.example.com/appt/9182?t=abc",
        slug: "launch",
        redirect_type: 301,
        expires_at: "2099-09-30T12:00:00Z",
        tags: ["tenant:42", "kind:appointment", "campaign:q4"],
        external_id: "appt_9182",
      },
    });

    expect(res.status).toBe(201);
    const link = await res.json<LinkBody>();
    expect(link.slug).toBe("launch");
    expect(link.redirect_type).toBe(301);
    expect(link.expires_at).toBe("2099-09-30T12:00:00.000Z");
    expect(link.external_id).toBe("appt_9182");
    expect([...link.tags].sort()).toEqual(["campaign:q4", "kind:appointment", "tenant:42"]);
  });

  // D20 / design §3: the entry is exactly {d,t,x,a} — the hot path parses it
  // on every request.
  describe("KV write-through (D20)", () => {
    it("writes the four-key entry after a 201", async () => {
      const link = await (
        await post({ body: { destination: "https://example.com/x" } })
      ).json<LinkBody>();

      expect(await testEnv.REDIRECTS.get(link.slug, "json")).toEqual({
        d: "https://example.com/x",
        t: 302,
        x: null,
        a: 1,
      });
    });

    it("carries expiry as epoch ms", async () => {
      const link = await (
        await post({
          body: { destination: "https://example.com/", expires_at: "2099-09-30T12:00:00Z" },
        })
      ).json<LinkBody>();

      const entry = await testEnv.REDIRECTS.get<{ x: number }>(link.slug, "json");
      expect(entry?.x).toBe(Date.parse("2099-09-30T12:00:00Z"));
    });
  });

  describe("tags (PRD §7.3 — created implicitly)", () => {
    it("creates a tags row per new name and links it", async () => {
      const link = await (
        await post({ body: { destination: "https://example.com/", tags: ["a", "b"] } })
      ).json<LinkBody>();

      const { results } = await testEnv.DB.prepare(
        `SELECT t.name FROM tags t
         JOIN link_tags lt ON lt.tag_id = t.id
         JOIN links l ON l.id = lt.link_id
         WHERE l.slug = ?1 ORDER BY t.name`,
      )
        .bind(link.slug)
        .all<{ name: string }>();

      expect(results.map((r) => r.name)).toEqual(["a", "b"]);
    });

    // Resolved as PROGRESS question 23: PATCH reads the stored set back, and
    // create echoed the request, so the two disagreed about the same link.
    it("returns the set as stored, not the array it was handed", async () => {
      // link_tags is keyed (link_id, tag_id), so a repeated tag stores one row.
      const link = await (
        await post({ body: { destination: "https://example.com/", tags: ["x", "x"] } })
      ).json<LinkBody>();

      expect(link.tags).toEqual(["x"]);
    });

    it("agrees with what a subsequent GET reports", async () => {
      const created = await (
        await post({ body: { destination: "https://example.com/", tags: ["b", "b", "a"] } })
      ).json<LinkBody>();

      const read = await (
        await createApiApp().request(
          `https://api.r301.dev/v1/links/${created.slug}`,
          { headers: authHeaders(key.key) },
          bindings(),
        )
      ).json<LinkBody>();

      expect(created.tags).toEqual(read.tags);
    });

    it("reuses an existing tag row rather than duplicating it", async () => {
      await post({ body: { destination: "https://example.com/1", tags: ["shared"] } });
      await post({ body: { destination: "https://example.com/2", tags: ["shared"] } });

      const row = await testEnv.DB.prepare(
        "SELECT COUNT(*) AS n FROM tags WHERE name = 'shared'",
      ).first<{ n: number }>();

      expect(row?.n).toBe(1);
    });

    it("links both links to the one shared tag row", async () => {
      await post({ body: { destination: "https://example.com/1", tags: ["shared"] } });
      await post({ body: { destination: "https://example.com/2", tags: ["shared"] } });

      const row = await testEnv.DB.prepare(
        `SELECT COUNT(*) AS n FROM link_tags lt
         JOIN tags t ON t.id = lt.tag_id WHERE t.name = 'shared'`,
      ).first<{ n: number }>();

      expect(row?.n).toBe(2);
    });
  });

  // D12: attribution only — it records who created the link, nothing more.
  it("records the calling key as created_by_key_id", async () => {
    const link = await (
      await post({ body: { destination: "https://example.com/" } })
    ).json<LinkBody>();

    const row = await testEnv.DB.prepare("SELECT created_by_key_id AS k FROM links WHERE slug = ?1")
      .bind(link.slug)
      .first<{ k: number }>();

    expect(row?.k).toBe(key.id);
  });

  describe("error paths (api-contract §Error envelope)", () => {
    it("rejects an unsafe destination with 422 destination_invalid", async () => {
      const res = await post({ body: { destination: "http://10.0.0.1/" } });

      expect(res.status).toBe(422);
      expect((await res.json<ErrorBody>()).error.code).toBe("destination_invalid");
    });

    it("rejects a reserved slug with 422 slug_reserved", async () => {
      const res = await post({ body: { destination: "https://example.com/", slug: "Admin" } });

      expect(res.status).toBe(422);
      expect((await res.json<ErrorBody>()).error.code).toBe("slug_reserved");
    });

    it("rejects a slug taken by a live link with 409 slug_taken", async () => {
      await seedLink("launch");
      const res = await post({ body: { destination: "https://example.com/", slug: "launch" } });

      expect(res.status).toBe(409);
      expect((await res.json<ErrorBody>()).error.code).toBe("slug_taken");
    });

    // D15: UNIQUE(slug) spans tombstones, so a deleted link keeps its slug.
    it("rejects a slug taken by a tombstoned link with 409 slug_taken", async () => {
      await seedLink("launch", 1_700_000_000_000);
      const res = await post({ body: { destination: "https://example.com/", slug: "launch" } });

      expect(res.status).toBe(409);
      expect((await res.json<ErrorBody>()).error.code).toBe("slug_taken");
    });

    it("rejects an unknown field with 400, naming it (D22)", async () => {
      const res = await post({
        body: { destination: "https://example.com/", destinaton: "typo" },
      });

      expect(res.status).toBe(400);
      const body = await res.json<ErrorBody>();
      expect(body.error.code).toBe("invalid_request");
      expect(JSON.stringify(body.error)).toContain("destinaton");
    });

    it("rejects a malformed slug with 400 invalid_request", async () => {
      const res = await post({ body: { destination: "https://example.com/", slug: "ab" } });

      expect(res.status).toBe(400);
      expect((await res.json<ErrorBody>()).error.code).toBe("invalid_request");
    });

    it("rejects a missing destination with 400", async () => {
      const res = await post({ body: {} });

      expect(res.status).toBe(400);
      expect((await res.json<ErrorBody>()).error.code).toBe("invalid_request");
    });

    it("rejects an unauthenticated request with 401", async () => {
      const res = await post({ headers: { Authorization: "Bearer r301_live_nope" } });

      expect(res.status).toBe(401);
      expect((await res.json<ErrorBody>()).error.code).toBe("unauthorized");
    });

    it("writes nothing to D1 when validation fails", async () => {
      await post({ body: { destination: "http://10.0.0.1/" } });

      const row = await testEnv.DB.prepare("SELECT COUNT(*) AS n FROM links").first<{ n: number }>();
      expect(row?.n).toBe(0);
    });

    it("answers 405 on a wrong method, not 404", async () => {
      const res = await createApiApp().request(
        "https://api.r301.dev/v1/links",
        { method: "DELETE", headers: authHeaders(key.key) },
        bindings(),
      );

      expect(res.status).toBe(405);
      expect((await res.json<ErrorBody>()).error.code).toBe("method_not_allowed");
    });
  });

  // D20: the KV put is awaited, so its failure is the request's failure. The
  // D1 row is left behind on purpose — prompt 11's idempotent retry heals it.
  describe("KV failure (D20)", () => {
    function throwingKv(): Env {
      return bindings({
        REDIRECTS: {
          ...testEnv.REDIRECTS,
          put: () => Promise.reject(new Error("KV unavailable")),
        } as unknown as KVNamespace,
      });
    }

    it("returns 500 internal", async () => {
      const res = await post({
        body: { destination: "https://example.com/" },
        env: throwingKv(),
        reportError: () => undefined,
      });

      expect(res.status).toBe(500);
      expect((await res.json<ErrorBody>()).error.code).toBe("internal");
    });

    it("leaves the D1 row committed — documented state, healed by a retry", async () => {
      await post({
        body: { destination: "https://example.com/" },
        env: throwingKv(),
        reportError: () => undefined,
      });

      const row = await testEnv.DB.prepare("SELECT COUNT(*) AS n FROM links").first<{ n: number }>();
      expect(row?.n).toBe(1);
    });

    it("reports the failure to Sentry", async () => {
      const reportError = vi.fn();
      await post({ body: { destination: "https://example.com/" }, env: throwingKv(), reportError });

      expect(reportError).toHaveBeenCalledOnce();
    });
  });
});

/**
 * `resolveSlug` only SELECTs — it never reserves. Two requests can both find
 * the same slug free, so `UNIQUE(slug)` is the real arbiter (design §6) and
 * the loser must get the contract's 409, not a 500. Simulated by making just
 * the links INSERT raise what SQLite raises.
 */
describe("concurrent insert of the same slug (design §6)", () => {
  function dbRaisingUniqueViolation(): Env {
    const real = testEnv.DB;
    const db = {
      ...real,
      prepare(sql: string) {
        if (sql.includes("INSERT INTO links")) {
          return {
            bind: () => ({
              first: () => Promise.reject(new Error("D1_ERROR: UNIQUE constraint failed: links.slug")),
            }),
          };
        }

        return real.prepare(sql);
      },
    } as unknown as D1Database;

    return bindings({ DB: db });
  }

  it("maps the constraint violation to 409 slug_taken", async () => {
    const res = await post({
      body: { destination: "https://example.com/", slug: "launch" },
      env: dbRaisingUniqueViolation(),
      reportError: () => undefined,
    });

    expect(res.status).toBe(409);
    expect((await res.json<ErrorBody>()).error.code).toBe("slug_taken");
  });

  it("does not report it to Sentry — a lost race is a contracted outcome", async () => {
    const reportError = vi.fn();
    await post({
      body: { destination: "https://example.com/", slug: "launch" },
      env: dbRaisingUniqueViolation(),
      reportError,
    });

    expect(reportError).not.toHaveBeenCalled();
  });
});
