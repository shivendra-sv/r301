import { env as testEnv } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApiApp } from "../../src/routes/api";
import { generateKey } from "../../src/services/keys";
import type { Env } from "../../src/types";
import { buildInsertSql, buildRevokeSql } from "../../scripts/key-admin";

const NOW = 1_756_600_000_000;

/** Runs a statement the way `wrangler d1 execute --command` would. */
function execute(sql: string): Promise<D1Result> {
  return testEnv.DB.prepare(sql).run();
}

function callProtected(key: string): Promise<Response> {
  const app = createApiApp();
  app.get("/v1/_probe", (c) => c.json({ ok: true }));

  return Promise.resolve(
    app.request(
      "https://api.r301.dev/v1/_probe",
      { headers: { Authorization: `Bearer ${key}` } },
      { DB: testEnv.DB, ENVIRONMENT: "local" } as Env,
    ),
  );
}

// The scripts shell out to wrangler, so the SQL string is the real contract
// between them and the running Worker. This exercises that string against the
// real schema and the real auth middleware.
describe("minted keys work end to end", () => {
  it("authenticates with a key inserted by the mint SQL", async () => {
    const generated = await generateKey("live");

    await execute(
      buildInsertSql({
        prefix: generated.prefix,
        hash: generated.hash,
        name: "ci-smoke",
        createdAt: NOW,
      }),
    );

    expect((await callProtected(generated.key)).status).toBe(200);
  });

  it("stops authenticating once the revoke SQL has run", async () => {
    const generated = await generateKey("live");
    await execute(
      buildInsertSql({
        prefix: generated.prefix,
        hash: generated.hash,
        name: "ci-smoke",
        createdAt: NOW,
      }),
    );

    const revoked = await execute(buildRevokeSql(generated.prefix, NOW + 1000));

    expect(revoked.meta.changes).toBe(1);
    expect((await callProtected(generated.key)).status).toBe(401);
  });

  // 0 rows is how the script knows to report "not found / already revoked".
  it("reports zero rows when revoking an already-revoked key", async () => {
    const generated = await generateKey("live");
    await execute(
      buildInsertSql({
        prefix: generated.prefix,
        hash: generated.hash,
        name: "ci-smoke",
        createdAt: NOW,
      }),
    );
    await execute(buildRevokeSql(generated.prefix, NOW + 1000));

    const second = await execute(buildRevokeSql(generated.prefix, NOW + 2000));

    expect(second.meta.changes).toBe(0);
  });

  it("reports zero rows when revoking a prefix that does not exist", async () => {
    const missing = await execute(buildRevokeSql("r301_live_zzzzzzzzzz", NOW));

    expect(missing.meta.changes).toBe(0);
  });

  // Defence in depth: the label alphabet is restricted, but the escaping must
  // hold on its own too.
  it("neutralises a quote in a label rather than breaking the statement", async () => {
    const generated = await generateKey("live");

    await execute(
      buildInsertSql({
        prefix: generated.prefix,
        hash: generated.hash,
        name: "o''brien", // already-doubled input: must round-trip, not break
        createdAt: NOW,
      }),
    );

    const row = await testEnv.DB.prepare("SELECT name FROM api_keys WHERE prefix = ?1")
      .bind(generated.prefix)
      .first<{ name: string }>();

    expect(row?.name).toBe("o''brien");
    expect((await callProtected(generated.key)).status).toBe(200);
  });
});
