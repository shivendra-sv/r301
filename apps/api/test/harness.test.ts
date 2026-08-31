import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("test environment", () => {
  it("exposes a working D1 binding", async () => {
    const row = await env.DB.prepare("SELECT 1 AS one").first<{ one: number }>();

    expect(row?.one).toBe(1);
  });

  it("exposes a working KV binding", async () => {
    await env.REDIRECTS.put("harness-probe", "written by the KV binding test");

    expect(await env.REDIRECTS.get("harness-probe")).toBe("written by the KV binding test");
  });

  // Runs after the test above and must not see its write.
  it("isolates storage between tests", async () => {
    expect(await env.REDIRECTS.get("harness-probe")).toBeNull();
  });

  // Pins that the chain is applied from zero on every run
  // (docs/testing.md §2, PRD §14). Schema itself: test/schema.test.ts.
  it("applies the migrations chain to the test database", async () => {
    const row = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'",
    ).first<{ name: string }>();

    expect(row?.name).toBe("d1_migrations");
  });
});
