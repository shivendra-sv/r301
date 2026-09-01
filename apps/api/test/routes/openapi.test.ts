import { env as testEnv } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { UNAUTHENTICATED_PATHS } from "../../src/middleware/auth";
import { IDEMPOTENT_PATHS } from "../../src/middleware/idempotency";
import { createApiApp } from "../../src/routes/api";
import { BEARER_SCHEME_NAME } from "../../src/routes/openapi";
import type { Env } from "../../src/types";
import { authHeaders, seedApiKey } from "../helpers/auth";

function bindings(overrides: Partial<Env> = {}): Env {
  return {
    DB: testEnv.DB,
    REDIRECTS: testEnv.REDIRECTS,
    ENVIRONMENT: "local",
    ...overrides,
  } as Env;
}

interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, unknown>>;
  security?: unknown[];
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, { type?: string; scheme?: string }>;
  };
}

function fetchDoc(env: Env = bindings()): Promise<Response> {
  return Promise.resolve(
    createApiApp().request("https://api.r301.dev/v1/openapi.json", {}, env),
  );
}

describe("GET /v1/openapi.json (PRD §8, D22)", () => {
  it("serves the document without an API key", async () => {
    const res = await fetchDoc();

    expect(res.status).toBe(200);
  });

  it("declares OpenAPI 3.1", async () => {
    const doc = await (await fetchDoc()).json<OpenApiDocument>();

    expect(doc.openapi).toMatch(/^3\.1/);
  });

  // The same string `GET /v1/health` reports, so a document and a probe pulled
  // from the same deploy cannot disagree about which deploy they are.
  it("carries the deployed version as info.version", async () => {
    const doc = await (await fetchDoc(bindings({ GIT_SHA: "abc123" }))).json<OpenApiDocument>();

    expect(doc.info.version).toBe("abc123");
  });

  it("falls back to 'dev' when no SHA is injected", async () => {
    const doc = await (await fetchDoc()).json<OpenApiDocument>();

    expect(doc.info.version).toBe("dev");
  });
});

describe("the document's paths and methods (api-contract)", () => {
  async function doc(): Promise<OpenApiDocument> {
    return (await fetchDoc()).json<OpenApiDocument>();
  }

  it("documents every /v1 endpoint", async () => {
    // `/v1/openapi.json` may describe itself or not; everything else must be
    // there. Sorted so the failure message names the missing path.
    const paths = Object.keys((await doc()).paths)
      .filter((path) => path !== "/v1/openapi.json")
      .sort();

    expect(paths).toEqual([
      "/v1/health",
      "/v1/links",
      "/v1/links/batch",
      "/v1/links/{slug}",
      "/v1/links/{slug}/stats",
      "/v1/stats",
      "/v1/tags",
    ]);
  });

  it("publishes the error envelope as a shared component", async () => {
    const envelope = (await doc()).components?.schemas?.["ErrorEnvelope"] as
      | { properties?: { error?: { properties?: Record<string, unknown>; required?: string[] } } }
      | undefined;

    expect(envelope).toBeDefined();
    expect(Object.keys(envelope?.properties?.error?.properties ?? {}).sort()).toEqual([
      "code",
      "field",
      "message",
      "request_id",
    ]);
    // `field` is present only when one field is at fault (api-contract).
    expect(envelope?.properties?.error?.required?.sort()).toEqual([
      "code",
      "message",
      "request_id",
    ]);
  });

  it("enumerates the contract's error codes in the envelope", async () => {
    const code = (await doc()).components?.schemas?.["ErrorEnvelope"] as {
      properties?: { error?: { properties?: { code?: { enum?: string[] } } } };
    };

    expect(code.properties?.error?.properties?.code?.enum).toEqual(
      expect.arrayContaining(["invalid_request", "slug_taken", "slug_reserved", "internal"]),
    );
  });

  it("references the envelope from every error response of POST /v1/links", async () => {
    const post = (await doc()).paths["/v1/links"]?.["post"] as {
      responses: Record<string, { content?: { "application/json"?: { schema?: { $ref?: string } } } }>;
    };
    const errorStatuses = Object.keys(post.responses).filter((status) => Number(status) >= 400);

    expect(errorStatuses.length).toBeGreaterThan(0);

    for (const status of errorStatuses) {
      expect(post.responses[status]?.content?.["application/json"]?.schema?.$ref).toBe(
        "#/components/schemas/ErrorEnvelope",
      );
    }
  });

  it("declares the bearer scheme", async () => {
    const scheme = (await doc()).components?.securitySchemes?.[BEARER_SCHEME_NAME];

    expect(scheme).toMatchObject({ type: "http", scheme: "bearer" });
  });

  it("requires that scheme by default, so a new route is authenticated unless it opts out", async () => {
    expect((await doc()).security).toEqual([{ [BEARER_SCHEME_NAME]: [] }]);
  });

  /**
   * The document's claim about who needs a key is checked against the thing
   * that actually enforces it (`UNAUTHENTICATED_PATHS` in the auth middleware),
   * not against a second hand-written list that could drift from it.
   */
  it("marks exactly the middleware's exempt paths as unauthenticated", async () => {
    const paths = (await doc()).paths;
    const exempt: string[] = [];

    for (const [path, operations] of Object.entries(paths)) {
      for (const operation of Object.values(operations)) {
        if (Array.isArray((operation as { security?: unknown[] }).security)) {
          expect((operation as { security: unknown[] }).security).toEqual([]);
          exempt.push(path);
        }
      }
    }

    expect(exempt.sort()).toEqual([...UNAUTHENTICATED_PATHS].sort());
  });

  it.each([
    ["/v1/links", ["get", "post"]],
    ["/v1/links/batch", ["post"]],
    ["/v1/links/{slug}", ["delete", "get", "patch"]],
    ["/v1/links/{slug}/stats", ["get"]],
    ["/v1/stats", ["get"]],
    ["/v1/tags", ["get"]],
    ["/v1/health", ["get"]],
  ])("documents %s with exactly the methods the contract allows", async (path, methods) => {
    const operations = (await doc()).paths[path];

    expect(operations).toBeDefined();
    expect(Object.keys(operations ?? {}).sort()).toEqual(methods);
  });
});

/**
 * The two structural guards (prompt 19 behaviours 6 and 7). Both derive their
 * subject from the router itself rather than a hand-written list, so a route
 * added in a later prompt cannot escape either check by being forgotten here.
 */
describe("router ↔ document cross-check", () => {
  /** Hono's `:slug` is OpenAPI's `{slug}`; everything else is already identical. */
  function toDocumentPath(honoPath: string): string {
    return honoPath.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
  }

  function registeredV1Paths(): string[] {
    const paths = createApiApp()
      .routes.map((route) => route.path)
      .filter((path) => path.startsWith("/v1/"))
      .map(toDocumentPath);

    return [...new Set(paths)].sort();
  }

  it("documents every /v1 route the router serves, and serves every one it documents", async () => {
    const doc = await (await fetchDoc()).json<OpenApiDocument>();

    expect(Object.keys(doc.paths).sort()).toEqual(registeredV1Paths());
  });

  // PROGRESS question 5, resolved 31 Aug 2026. Hono has no built-in 405: it is
  // `methodNotAllowed(app, path)` per path, called after that path's handlers,
  // so a route prompt that forgets one fails silently as a 404. This sweep is
  // what makes that failure loud.
  describe("405 sweep — every registered /v1 path", () => {
    it("covers every path the document knows about", async () => {
      const doc = await (await fetchDoc()).json<OpenApiDocument>();

      // Guards the sweep itself: if this drifted to an empty list the
      // per-path assertions below would vacuously pass.
      expect(registeredV1Paths()).toEqual(Object.keys(doc.paths).sort());
      expect(registeredV1Paths().length).toBeGreaterThanOrEqual(8);
    });

    it.each(
      createApiApp()
        .routes.map((route) => route.path)
        .filter((path) => path.startsWith("/v1/"))
        .filter((path, index, all) => all.indexOf(path) === index)
        .sort(),
    )("answers 405 rather than 404 on %s", async (honoPath) => {
      const key = await seedApiKey();
      const url = `https://api.r301.dev${honoPath.replace(/:([A-Za-z0-9_]+)/g, "probe-$1")}`;

      const res = await createApiApp().request(
        url,
        { method: "PROPFIND", headers: authHeaders(key.key) },
        bindings(),
      );

      expect(res.status).toBe(405);
      expect((await res.json<{ error: { code: string } }>()).error.code).toBe("method_not_allowed");
    });
  });
});

describe("response schemas", () => {
  /**
   * The objective's other half: the document describes what comes back, not
   * just what goes in. 204 is excluded because it has no body by definition.
   */
  it("gives every success response a JSON schema", async () => {
    const doc = await (await fetchDoc()).json<OpenApiDocument>();
    const missing: string[] = [];

    for (const [path, operations] of Object.entries(doc.paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        const responses = (operation as { responses: Record<string, { content?: unknown }> })
          .responses;

        for (const [status, response] of Object.entries(responses)) {
          const code = Number(status);
          if (code < 200 || code >= 300 || code === 204) continue;

          if (response.content === undefined) {
            missing.push(`${method.toUpperCase()} ${path} → ${status}`);
          }
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it("names the reusable resources as components", async () => {
    const schemas = (await fetchDoc().then((r) => r.json<OpenApiDocument>())).components?.schemas;

    expect(Object.keys(schemas ?? {}).sort()).toEqual(
      expect.arrayContaining(["BatchResult", "ErrorEnvelope", "Link", "LinkList", "LinkStats", "TagList", "TagStats"]),
    );
  });

  it("describes the created link as the shared Link component", async () => {
    const doc = await (await fetchDoc()).json<OpenApiDocument>();
    const created = (doc.paths["/v1/links"]?.["post"] as {
      responses: Record<string, { content?: { "application/json"?: { schema?: { $ref?: string } } } }>;
    }).responses["201"];

    expect(created?.content?.["application/json"]?.schema?.$ref).toBe("#/components/schemas/Link");
  });
});

/**
 * The document has to agree with `docs/api-contract.md`, which defines three
 * statuses beyond each route's happy path. 405 and 415 are deterministic and
 * already tested behaviours, so silence about them would be the document
 * under-describing the API it publishes.
 */
describe("contract cross-check: statuses every operation can actually return", () => {
  it("documents 405 on every path, since every path registers a guard", async () => {
    const doc = await (await fetchDoc()).json<OpenApiDocument>();
    const missing: string[] = [];

    for (const [path, operations] of Object.entries(doc.paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        const responses = (operation as { responses: Record<string, unknown> }).responses;
        if (responses["405"] === undefined) missing.push(`${method.toUpperCase()} ${path}`);
      }
    }

    expect(missing).toEqual([]);
  });

  it.each([
    ["/v1/links", "post"],
    ["/v1/links/batch", "post"],
    ["/v1/links/{slug}", "patch"],
  ])("documents 415 on %s %s, which carries a body", async (path, method) => {
    const doc = await (await fetchDoc()).json<OpenApiDocument>();
    const responses = (doc.paths[path]?.[method] as { responses: Record<string, unknown> })
      .responses;

    expect(responses["415"]).toBeDefined();
  });

  it("documents 401 on every authenticated operation and none of the public ones", async () => {
    const doc = await (await fetchDoc()).json<OpenApiDocument>();

    for (const [path, operations] of Object.entries(doc.paths)) {
      for (const operation of Object.values(operations)) {
        const op = operation as { security?: unknown[]; responses: Record<string, unknown> };
        const isPublic = Array.isArray(op.security) && op.security.length === 0;

        expect({ path, has401: op.responses["401"] !== undefined }).toEqual({
          path,
          has401: !isPublic,
        });
      }
    }
  });
});

/**
 * D18 / api-contract §Global conventions: `Idempotency-Key` is honoured on the
 * bodied creates, and a reused key with a different payload — or one whose
 * original is still in flight — is 409 `idempotency_conflict`. Driven from the
 * middleware's own path list, so a future idempotent route that forgets to
 * document 409 fails here rather than surprising a client.
 */
describe("idempotency is documented wherever it is enforced", () => {
  it.each([...IDEMPOTENT_PATHS])("documents 409 on POST %s", async (path) => {
    const doc = await (await fetchDoc()).json<OpenApiDocument>();
    const post = doc.paths[path]?.["post"] as { responses: Record<string, unknown> } | undefined;

    expect(post).toBeDefined();
    expect(post?.responses["409"]).toBeDefined();
  });
});

/**
 * Question 28, resolved 1 Sep 2026: `500` is defined in the api-contract and
 * reachable on every operation (D20 returns it when the awaited KV write
 * fails), so the document declares it everywhere rather than on writes only.
 */
describe("500 is declared on every operation (question 28)", () => {
  it("leaves no operation silent about internal failure", async () => {
    const doc = await (await fetchDoc()).json<OpenApiDocument>();
    const missing: string[] = [];

    for (const [path, operations] of Object.entries(doc.paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        const responses = (operation as { responses: Record<string, unknown> }).responses;
        if (responses["500"] === undefined) missing.push(`${method.toUpperCase()} ${path}`);
      }
    }

    expect(missing).toEqual([]);
  });

  it("references the shared envelope for it", async () => {
    const doc = await (await fetchDoc()).json<OpenApiDocument>();
    const internal = (doc.paths["/v1/tags"]?.["get"] as {
      responses: Record<string, { content?: { "application/json"?: { schema?: { $ref?: string } } } }>;
    }).responses["500"];

    expect(internal?.content?.["application/json"]?.schema?.$ref).toBe(
      "#/components/schemas/ErrorEnvelope",
    );
  });
});
