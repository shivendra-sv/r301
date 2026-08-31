import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

// The schema under test is apps/api/migrations/0001_init.sql, applied from
// zero before every test by test/setup.ts (PRD §14, docs/testing.md §2).

/** Table names D1 creates for its own bookkeeping — not part of PRD §9. */
const D1_INTERNAL = "name NOT LIKE 'sqlite_%' AND name NOT LIKE 'd1_%' AND name NOT LIKE '_cf_%'";

async function names(type: "table" | "index", extra = ""): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type = ?1 AND ${D1_INTERNAL} ${extra} ORDER BY name`,
  )
    .bind(type)
    .all<{ name: string }>();

  return results.map((r) => r.name);
}

/** Attribution key every link needs (D12); seeded as id 1 before each test. */
const SEEDED_KEY_ID = 1;

async function insertKey(id: number, prefix: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO api_keys (id, prefix, key_hash, name, created_at) VALUES (?1, ?2, 'sha256hex', 'test key', 0)",
  )
    .bind(id, prefix)
    .run();
}

async function insertLink(row: {
  slug: string;
  redirectType?: number;
  isActive?: number;
  deletedAt?: number | null;
  keyId?: number;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO links (slug, destination, redirect_type, is_active, deleted_at, created_by_key_id, created_at, updated_at)
     VALUES (?1, 'https://example.com/', ?2, ?3, ?4, ?5, 0, 0)`,
  )
    .bind(
      row.slug,
      row.redirectType ?? 302,
      row.isActive ?? 1,
      row.deletedAt ?? null,
      row.keyId ?? SEEDED_KEY_ID,
    )
    .run();
}

beforeEach(async () => {
  await insertKey(SEEDED_KEY_ID, "r301_live_seededkey0");
});

describe("migration 0001 — PRD §9 schema", () => {
  it("creates exactly the five PRD §9 tables", async () => {
    expect(await names("table")).toEqual([
      "api_keys",
      "idempotency_keys",
      "link_tags",
      "links",
      "tags",
    ]);
  });

  // `sql IS NOT NULL` excludes SQLite's implicit UNIQUE auto-indexes.
  it("creates exactly the four PRD §9 named indexes", async () => {
    expect(await names("index", "AND sql IS NOT NULL")).toEqual([
      "idx_link_tags_tag",
      "idx_links_created",
      "idx_links_external",
      "idx_links_key_created",
    ]);
  });
});

describe("links.slug UNIQUE (D15)", () => {
  it("rejects a second link claiming a live slug", async () => {
    await insertLink({ slug: "taken" });

    await expect(insertLink({ slug: "taken" })).rejects.toThrow(
      /UNIQUE constraint failed: links.slug/,
    );
  });

  // D15: the UNIQUE spans tombstones, so a deleted slug is never reusable.
  it("rejects a second link claiming a tombstoned slug", async () => {
    await insertLink({ slug: "gone", deletedAt: 1_700_000_000_000 });

    await expect(insertLink({ slug: "gone" })).rejects.toThrow(
      /UNIQUE constraint failed: links.slug/,
    );
  });
});

describe("links CHECK constraints", () => {
  it("rejects a redirect_type outside 301/302/307/308", async () => {
    await expect(insertLink({ slug: "see-other", redirectType: 303 })).rejects.toThrow(
      /CHECK constraint failed/,
    );
  });

  it("accepts every allowed redirect_type", async () => {
    for (const redirectType of [301, 302, 307, 308]) {
      await insertLink({ slug: `r${redirectType}`, redirectType });
    }

    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM links").first<{ n: number }>();
    expect(row?.n).toBe(4);
  });

  it("rejects an is_active outside 0/1", async () => {
    await expect(insertLink({ slug: "tri-state", isActive: 2 })).rejects.toThrow(
      /CHECK constraint failed/,
    );
  });
});

describe("foreign keys", () => {
  it("rejects a link attributed to a nonexistent api key", async () => {
    await expect(insertLink({ slug: "orphan", keyId: 999 })).rejects.toThrow(
      /FOREIGN KEY constraint failed/,
    );
  });

  it("cascades a link delete to its link_tags rows", async () => {
    await insertLink({ slug: "tagged" });
    await env.DB.prepare("INSERT INTO tags (id, name) VALUES (1, 'smoke')").run();
    await env.DB.prepare(
      "INSERT INTO link_tags (link_id, tag_id) SELECT id, 1 FROM links WHERE slug = 'tagged'",
    ).run();

    await env.DB.prepare("DELETE FROM links WHERE slug = 'tagged'").run();

    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM link_tags").first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});

describe("idempotency_keys composite primary key (D18)", () => {
  async function reserve(key: string, apiKeyId: number): Promise<void> {
    await env.DB.prepare(
      "INSERT INTO idempotency_keys (key, api_key_id, request_hash, created_at) VALUES (?1, ?2, 'abc123', 0)",
    )
      .bind(key, apiKeyId)
      .run();
  }

  it("rejects the same key reused by the same api key", async () => {
    await reserve("idem-1", 1);

    await expect(reserve("idem-1", 1)).rejects.toThrow(/UNIQUE constraint failed/);
  });

  // Keys are scoped per api key, so two tenants may pick the same string.
  it("accepts the same key under a different api key", async () => {
    await insertKey(2, "r301_live_secondkey0");
    await reserve("idem-1", 1);

    await reserve("idem-1", 2);

    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM idempotency_keys WHERE key = 'idem-1'",
    ).first<{ n: number }>();
    expect(row?.n).toBe(2);
  });
});

describe("lookup uniqueness", () => {
  it("rejects a duplicate tag name", async () => {
    await env.DB.prepare("INSERT INTO tags (name) VALUES ('smoke')").run();

    await expect(env.DB.prepare("INSERT INTO tags (name) VALUES ('smoke')").run()).rejects.toThrow(
      /UNIQUE constraint failed: tags.name/,
    );
  });

  // The 20-char prefix is the auth lookup key (D11) — collisions must be impossible.
  it("rejects a duplicate api key prefix", async () => {
    await expect(insertKey(2, "r301_live_seededkey0")).rejects.toThrow(
      /UNIQUE constraint failed: api_keys.prefix/,
    );
  });
});
