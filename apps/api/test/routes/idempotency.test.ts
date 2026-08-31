import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env as testEnv } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createApiApp } from "../../src/routes/api";
import { hashBody, IDEMPOTENCY_WINDOW_MS, IN_FLIGHT_TIMEOUT_MS } from "../../src/services/idempotency";
import type { Env } from "../../src/types";
import { authHeaders, seedApiKey, type SeededApiKey } from "../helpers/auth";

/** Fixed clock; every staged row is positioned relative to it. */
const NOW = 1_788_177_600_000;

let key: SeededApiKey;

beforeEach(async () => {
  key = await seedApiKey();
});

function bindings(overrides: Partial<Env> = {}): Env {
  return { DB: testEnv.DB, REDIRECTS: testEnv.REDIRECTS, ENVIRONMENT: "local", ...overrides } as Env;
}

interface PostOptions {
  body?: unknown;
  idempotencyKey?: string;
  env?: Env;
  reportError?: (err: unknown) => void;
  ctx?: ExecutionContext;
}

const DEFAULT_BODY = { destination: "https://example.com/appt/1" };

function post(options: PostOptions = {}): Promise<Response> {
  const app = createApiApp({
    now: () => NOW,
    ...(options.reportError === undefined ? {} : { reportError: options.reportError }),
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...authHeaders(key.key),
  };
  if (options.idempotencyKey !== undefined) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }

  return Promise.resolve(
    app.request(
      "https://api.r301.dev/v1/links",
      { method: "POST", headers, body: JSON.stringify(options.body ?? DEFAULT_BODY) },
      options.env ?? bindings(),
      options.ctx as ExecutionContext,
    ),
  );
}

interface KeyRow {
  key: string;
  request_hash: string;
  response_status: number | null;
  response_body: string | null;
  created_at: number;
}

function rows(): Promise<KeyRow[]> {
  return testEnv.DB.prepare("SELECT * FROM idempotency_keys ORDER BY key")
    .all<KeyRow>()
    .then((r) => r.results);
}

/** Stages a row in whatever state the machine is meant to meet (design §5). */
async function stageRow(opts: {
  key: string;
  body?: unknown;
  hash?: string;
  status?: number | null;
  responseBody?: string | null;
  createdAt: number;
  apiKeyId?: number;
}): Promise<void> {
  const hash = opts.hash ?? (await hashBody(JSON.stringify(opts.body ?? DEFAULT_BODY)));

  await testEnv.DB.prepare(
    `INSERT INTO idempotency_keys
       (key, api_key_id, request_hash, response_status, response_body, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(
      opts.key,
      opts.apiKeyId ?? key.id,
      hash,
      opts.status ?? null,
      opts.responseBody ?? null,
      opts.createdAt,
    )
    .run();
}

function linkCount(): Promise<number> {
  return testEnv.DB.prepare("SELECT COUNT(*) AS n FROM links")
    .first<{ n: number }>()
    .then((r) => r?.n ?? 0);
}

describe("request hashing (D26 item 8 — raw body bytes)", () => {
  it("is the sha256 hex of the exact bytes", async () => {
    // Known vector: sha256("abc").
    expect(await hashBody("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("distinguishes byte-different but semantically equal bodies", async () => {
    const a = await hashBody('{"destination":"https://a.com"}');
    const b = await hashBody('{ "destination": "https://a.com" }');

    expect(a).not.toBe(b);
  });
});

describe("Idempotency-Key on POST /v1/links (D18, design §5)", () => {
  it("executes normally and touches nothing when the header is absent", async () => {
    const res = await post();

    expect(res.status).toBe(201);
    expect(await rows()).toHaveLength(0);
  });

  describe("fresh key", () => {
    it("executes and finalizes the row with the response status and body", async () => {
      const res = await post({ idempotencyKey: "demo-1" });
      const body = await res.text();

      expect(res.status).toBe(201);
      const [row] = await rows();
      expect(row?.key).toBe("demo-1");
      expect(row?.response_status).toBe(201);
      expect(row?.response_body).toBe(body);
      expect(row?.created_at).toBe(NOW);
    });

    it("does not mark a first execution as a replay", async () => {
      const res = await post({ idempotencyKey: "demo-1" });

      expect(res.headers.get("Idempotency-Replayed")).toBeNull();
    });
  });

  describe("byte-identical replay", () => {
    it("returns the stored response rather than re-executing", async () => {
      await post({ idempotencyKey: "demo-1" });
      // Mutating the store proves the second call reads it instead of
      // creating a second link and returning that.
      await testEnv.DB.prepare(
        "UPDATE idempotency_keys SET response_body = ?1 WHERE key = 'demo-1'",
      )
        .bind('{"slug":"STORED"}')
        .run();

      const res = await post({ idempotencyKey: "demo-1" });

      expect(res.status).toBe(201);
      expect(await res.text()).toBe('{"slug":"STORED"}');
      expect(await linkCount()).toBe(1);
    });

    it("carries Idempotency-Replayed: true", async () => {
      await post({ idempotencyKey: "demo-1" });
      const res = await post({ idempotencyKey: "demo-1" });

      expect(res.headers.get("Idempotency-Replayed")).toBe("true");
    });

    it("returns the same slug twice — the retry-after-timeout case", async () => {
      const first = await (await post({ idempotencyKey: "demo-1" })).json<{ slug: string }>();
      const second = await (await post({ idempotencyKey: "demo-1" })).json<{ slug: string }>();

      expect(second.slug).toBe(first.slug);
      expect(await linkCount()).toBe(1);
    });
  });

  describe("same key, different payload", () => {
    it("is a 409 naming the payload mismatch", async () => {
      await post({ idempotencyKey: "demo-1" });
      const res = await post({
        idempotencyKey: "demo-1",
        body: { destination: "https://different.example.com/" },
      });

      expect(res.status).toBe(409);
      const body = await res.json<{ error: { code: string; message: string } }>();
      expect(body.error.code).toBe("idempotency_conflict");
      expect(body.error.message.toLowerCase()).toContain("payload");
    });

    it("leaves the original row untouched", async () => {
      await post({ idempotencyKey: "demo-1" });
      const before = (await rows())[0];

      await post({ idempotencyKey: "demo-1", body: { destination: "https://other.example/" } });

      expect((await rows())[0]).toEqual(before);
      expect(await linkCount()).toBe(1);
    });
  });

  it("rejects a duplicate that is still in flight", async () => {
    await stageRow({ key: "demo-1", createdAt: NOW - 10_000 });

    const res = await post({ idempotencyKey: "demo-1" });

    expect(res.status).toBe(409);
    const body = await res.json<{ error: { code: string; message: string } }>();
    expect(body.error.code).toBe("idempotency_conflict");
    expect(body.error.message.toLowerCase()).toContain("in flight");
    expect(await linkCount()).toBe(0);
  });

  // design §5: the isolate died before it could clean up, so the retry owns it.
  it("takes over an abandoned reservation and re-executes", async () => {
    await stageRow({ key: "demo-1", createdAt: NOW - IN_FLIGHT_TIMEOUT_MS - 1_000 });

    const res = await post({ idempotencyKey: "demo-1" });

    expect(res.status).toBe(201);
    expect(await linkCount()).toBe(1);
    const [row] = await rows();
    expect(row?.response_status).toBe(201);
    expect(row?.created_at).toBe(NOW);
  });

  it("treats a row past the 24 h window as fresh", async () => {
    await stageRow({
      key: "demo-1",
      createdAt: NOW - IDEMPOTENCY_WINDOW_MS - 1_000,
      status: 201,
      responseBody: '{"slug":"OLD"}',
    });

    const res = await post({ idempotencyKey: "demo-1" });

    expect(res.status).toBe(201);
    expect(await res.text()).not.toContain("OLD");
    const [row] = await rows();
    expect(row?.created_at).toBe(NOW);
  });

  // The window is checked before the hash, so an expired row with a different
  // payload is replaced rather than reported as a mismatch (design §5 order).
  it("replaces an expired row even when the payload differs", async () => {
    await stageRow({
      key: "demo-1",
      hash: "0".repeat(64),
      createdAt: NOW - IDEMPOTENCY_WINDOW_MS - 1_000,
      status: 201,
      responseBody: '{"slug":"OLD"}',
    });

    expect((await post({ idempotencyKey: "demo-1" })).status).toBe(201);
  });

  it("scopes keys to the api key that issued them", async () => {
    const other = await seedApiKey();
    await stageRow({
      key: "demo-1",
      apiKeyId: other.id,
      createdAt: NOW,
      status: 201,
      responseBody: '{"slug":"THEIRS"}',
    });

    const res = await post({ idempotencyKey: "demo-1" });

    expect(res.status).toBe(201);
    expect(await res.text()).not.toContain("THEIRS");
  });

  describe("failed execution", () => {
    function throwingKv(): Env {
      return bindings({
        REDIRECTS: {
          ...testEnv.REDIRECTS,
          put: () => Promise.reject(new Error("KV unavailable")),
        } as unknown as KVNamespace,
      });
    }

    it("deletes the reservation, leaving no row (only successes finalize)", async () => {
      const res = await post({
        idempotencyKey: "demo-1",
        env: throwingKv(),
        reportError: () => undefined,
      });

      expect(res.status).toBe(500);
      expect(await rows()).toHaveLength(0);
    });

    it("lets an immediate retry succeed once KV behaves", async () => {
      await post({ idempotencyKey: "demo-1", env: throwingKv(), reportError: () => undefined });

      const res = await post({ idempotencyKey: "demo-1" });

      expect(res.status).toBe(201);
      expect(res.headers.get("Idempotency-Replayed")).toBeNull();
    });

    it("stores nothing for a validation failure either", async () => {
      const res = await post({ idempotencyKey: "demo-1", body: { destination: "http://10.0.0.1/" } });

      expect(res.status).toBe(422);
      expect(await rows()).toHaveLength(0);
    });
  });

  describe("key validation (api-contract — 1–255 chars)", () => {
    it("rejects an empty key", async () => {
      const res = await post({ idempotencyKey: "" });

      expect(res.status).toBe(400);
      expect((await res.json<{ error: { code: string } }>()).error.code).toBe("invalid_request");
    });

    it("accepts a 255-character key", async () => {
      expect((await post({ idempotencyKey: "k".repeat(255) })).status).toBe(201);
    });

    it("rejects a 256-character key", async () => {
      const res = await post({ idempotencyKey: "k".repeat(256) });

      expect(res.status).toBe(400);
      expect((await res.json<{ error: { code: string } }>()).error.code).toBe("invalid_request");
    });

    it("reserves nothing for an invalid key", async () => {
      await post({ idempotencyKey: "" });

      expect(await rows()).toHaveLength(0);
      expect(await linkCount()).toBe(0);
    });
  });

  // design §5 step 3: opportunistic, bounded, and off the response path.
  it("purges rows past the window on a new reservation", async () => {
    await stageRow({ key: "stale-1", createdAt: NOW - IDEMPOTENCY_WINDOW_MS - 1, status: 201, responseBody: "{}" });
    await stageRow({ key: "stale-2", createdAt: NOW - IDEMPOTENCY_WINDOW_MS - 5_000, status: 201, responseBody: "{}" });
    await stageRow({ key: "fresh-1", createdAt: NOW - 1_000, status: 201, responseBody: "{}" });

    const ctx = createExecutionContext();
    await post({ idempotencyKey: "demo-1", ctx });
    await waitOnExecutionContext(ctx);

    expect((await rows()).map((r) => r.key).sort()).toEqual(["demo-1", "fresh-1"]);
  });
});
