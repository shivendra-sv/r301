/**
 * The document has to be *usable*, not merely correct: a client reading it
 * should never have to open `docs/api-contract.md` to find out what a field
 * means or what a real request looks like.
 *
 * `openapi.test.ts` pins the document's structure — which paths, methods and
 * statuses exist. This file pins its prose: descriptions, examples, operation
 * ids, tags and the headers the API actually sends. Both derive their subject
 * from the document itself rather than a hand-written list, so a route added
 * later cannot escape either sweep by being forgotten here.
 */

import { env as testEnv } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ERROR_STATUS } from "../../src/errors";
import { IDEMPOTENT_PATHS } from "../../src/middleware/idempotency";
import { redirectTypeSchema } from "../../src/schemas/fields";
import { createApiApp } from "../../src/routes/api";
import type { Env } from "../../src/types";

interface SchemaObject {
  $ref?: string;
  title?: string;
  default?: unknown;
  allOf?: SchemaObject[];
  discriminator?: { propertyName: string; mapping?: Record<string, string> };
  type?: string | string[];
  description?: string;
  example?: unknown;
  examples?: unknown[];
  properties?: Record<string, SchemaObject>;
  items?: SchemaObject;
  anyOf?: SchemaObject[];
  oneOf?: SchemaObject[];
  enum?: unknown[];
}

interface MediaTypeObject {
  schema?: SchemaObject;
  example?: unknown;
  examples?: Record<string, { value?: unknown; summary?: string }>;
}

interface ResponseObject {
  description?: string;
  headers?: Record<string, { description?: string; required?: boolean; schema?: SchemaObject }>;
  content?: Record<string, MediaTypeObject>;
}

interface ParameterObject {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  example?: unknown;
  schema?: SchemaObject;
}

interface OperationObject {
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  security?: unknown[];
  parameters?: ParameterObject[];
  requestBody?: { required?: boolean; description?: string; content?: Record<string, MediaTypeObject> };
  responses: Record<string, ResponseObject>;
}

interface OpenApiDocument {
  info: {
    title: string;
    version: string;
    description?: string;
    contact?: { name?: string; url?: string };
    license?: { name: string; identifier?: string; url?: string };
  };
  servers?: { url: string; description?: string }[];
  tags?: { name: string; description?: string }[];
  externalDocs?: { url: string; description?: string };
  paths: Record<string, Record<string, OperationObject>>;
  components?: { schemas?: Record<string, SchemaObject> };
}

function bindings(): Env {
  return {
    DB: testEnv.DB,
    REDIRECTS: testEnv.REDIRECTS,
    ENVIRONMENT: "local",
  } as Env;
}

let cached: OpenApiDocument | undefined;

async function doc(): Promise<OpenApiDocument> {
  cached ??= await (
    await createApiApp().request("https://api.r301.dev/v1/openapi.json", {}, bindings())
  ).json<OpenApiDocument>();

  return cached;
}

/** Every (path, method, operation) triple in the document. */
async function operations(): Promise<[string, string, OperationObject][]> {
  const out: [string, string, OperationObject][] = [];

  for (const [path, methods] of Object.entries((await doc()).paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      out.push([path, method, operation]);
    }
  }

  return out;
}

/** Resolves `$ref` against the document's components so sweeps see real schemas. */
function deref(schema: SchemaObject, document: OpenApiDocument): SchemaObject {
  if (schema.$ref === undefined) return schema;

  const name = schema.$ref.replace("#/components/schemas/", "");

  return document.components?.schemas?.[name] ?? schema;
}

/**
 * Walks a schema and returns every `path -> schema` leaf that a client would
 * have to understand. Composite wrappers (`anyOf`, arrays) are traversed, not
 * reported — a description on `redirect_type` is what matters, not one on each
 * of its four literal branches.
 */
function describableProperties(
  schema: SchemaObject,
  document: OpenApiDocument,
  prefix = "",
  seen = new Set<string>(),
): [string, SchemaObject][] {
  const resolved = deref(schema, document);

  if (schema.$ref !== undefined) {
    if (seen.has(schema.$ref)) return [];
    seen.add(schema.$ref);
  }

  const out: [string, SchemaObject][] = [];

  for (const [name, property] of Object.entries(resolved.properties ?? {})) {
    const path = prefix === "" ? name : `${prefix}.${name}`;
    out.push([path, property]);

    const nested = deref(property, document);
    const target = nested.items ?? nested;

    if (deref(target, document).properties !== undefined) {
      out.push(...describableProperties(target, document, path, seen));
    }
  }

  for (const branch of resolved.anyOf ?? resolved.oneOf ?? []) {
    if (deref(branch, document).properties !== undefined) {
      out.push(...describableProperties(branch, document, prefix, seen));
    }
  }

  return out;
}

/**
 * OpenAPI 3.1 admits four places an example may legitimately sit — the media
 * type's `example`, its named `examples`, or the schema's own `example` /
 * `examples` (the JSON Schema form, which is what `z.meta({ examples: [...] })`
 * emits). Any one of them is a worked example a client can copy.
 */
/**
 * The prose a reader actually sees for a property. A description may sit on the
 * node itself, on an `allOf` member beside a `$ref` (which is how a described
 * reference to a shared component is composed), or on the component the `$ref`
 * points at — a reference to a documented schema is documented, and demanding a
 * duplicate sentence on the reference would only add text to maintain.
 */
function descriptionOf(schema: SchemaObject, document: OpenApiDocument): string {
  if (typeof schema.description === "string") return schema.description;

  for (const member of schema.allOf ?? []) {
    const nested = descriptionOf(member, document);
    if (nested !== "") return nested;
  }

  if (schema.$ref !== undefined) {
    const target = deref(schema, document);
    if (target !== schema && typeof target.description === "string") return target.description;
  }

  return "";
}

function hasExample(media: MediaTypeObject | undefined): boolean {
  if (media === undefined) return false;

  return (
    media.example !== undefined
    || Object.keys(media.examples ?? {}).length > 0
    || media.schema?.example !== undefined
    || (media.schema?.examples?.length ?? 0) > 0
  );
}

describe("document root", () => {
  it("describes the API itself, not just its routes", async () => {
    const { info } = await doc();

    expect(info.description).toBeDefined();
    expect(info.description?.length ?? 0).toBeGreaterThan(200);
  });

  it("names a contact and a licence", async () => {
    const { info } = await doc();

    expect(info.contact?.url).toMatch(/^https:\/\//);
    expect(info.license?.name).toBeTruthy();
  });

  it("lists both deployed environments as servers, each described", async () => {
    const servers = (await doc()).servers ?? [];

    expect(servers.map((s) => s.url).sort()).toEqual([
      "https://api-staging.r301.dev",
      "https://api.r301.dev",
    ]);

    for (const server of servers) {
      expect(server.description?.length ?? 0).toBeGreaterThan(10);
    }
  });

  it("points at the human documentation", async () => {
    expect((await doc()).externalDocs?.url).toMatch(/^https:\/\//);
  });

  it("declares every tag it uses, with a description", async () => {
    const document = await doc();
    const declared = new Map((document.tags ?? []).map((t) => [t.name, t]));

    expect(declared.size).toBeGreaterThan(0);

    for (const tag of declared.values()) {
      expect(tag.description?.length ?? 0).toBeGreaterThan(20);
    }

    for (const [path, method, operation] of await operations()) {
      for (const name of operation.tags ?? []) {
        expect({ path, method, tag: name, declared: declared.has(name) }).toEqual({
          path,
          method,
          tag: name,
          declared: true,
        });
      }
    }
  });
});

describe("every operation", () => {
  it("carries a summary and a fuller description", async () => {
    const thin: string[] = [];

    for (const [path, method, operation] of await operations()) {
      if ((operation.summary?.length ?? 0) < 5 || (operation.description?.length ?? 0) < 60) {
        thin.push(`${method.toUpperCase()} ${path}`);
      }
    }

    expect(thin).toEqual([]);
  });

  it("carries a unique operationId", async () => {
    const ids = (await operations()).map(([path, method, operation]) => {
      expect({ path, method, id: operation.operationId }).toEqual({
        path,
        method,
        id: expect.stringMatching(/^[a-z][A-Za-z0-9]+$/),
      });

      return operation.operationId;
    });

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is filed under at least one tag", async () => {
    for (const [path, method, operation] of await operations()) {
      expect({ path, method, tags: operation.tags?.length ?? 0 }).toEqual({
        path,
        method,
        tags: expect.any(Number),
      });
      expect(operation.tags?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe("parameters", () => {
  it("describes every path and query parameter", async () => {
    const undescribed: string[] = [];

    for (const [path, method, operation] of await operations()) {
      for (const parameter of operation.parameters ?? []) {
        const description = parameter.description ?? parameter.schema?.description;

        if ((description?.length ?? 0) < 20) {
          undescribed.push(`${method.toUpperCase()} ${path} ?${parameter.name}`);
        }
      }
    }

    expect(undescribed).toEqual([]);
  });

  it("gives every parameter an example", async () => {
    const missing: string[] = [];

    for (const [path, method, operation] of await operations()) {
      for (const parameter of operation.parameters ?? []) {
        if (parameter.example === undefined && parameter.schema?.example === undefined) {
          missing.push(`${method.toUpperCase()} ${path} ?${parameter.name}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });
});

describe("request bodies", () => {
  it("describes every field a client can send", async () => {
    const document = await doc();
    const undescribed: string[] = [];

    for (const [path, method, operation] of await operations()) {
      const schema = operation.requestBody?.content?.["application/json"]?.schema;
      if (schema === undefined) continue;

      for (const [name, property] of describableProperties(schema, document)) {
        if (descriptionOf(property, document).length < 15) {
          undescribed.push(`${method.toUpperCase()} ${path} → ${name}`);
        }
      }
    }

    expect(undescribed).toEqual([]);
  });

  it("shows a worked example of every body", async () => {
    const missing: string[] = [];

    for (const [path, method, operation] of await operations()) {
      const media = operation.requestBody?.content?.["application/json"];
      if (media === undefined) continue;

      if (!hasExample(media)) missing.push(`${method.toUpperCase()} ${path}`);
    }

    expect(missing).toEqual([]);
  });
});

describe("responses", () => {
  it("gives every response body an example", async () => {
    const missing: string[] = [];

    for (const [path, method, operation] of await operations()) {
      for (const [status, response] of Object.entries(operation.responses)) {
        const media = response.content?.["application/json"];
        if (media === undefined) continue;

        if (!hasExample(media)) missing.push(`${method.toUpperCase()} ${path} → ${status}`);
      }
    }

    expect(missing).toEqual([]);
  });

  it("describes every field a client will receive", async () => {
    const document = await doc();
    const undescribed: string[] = [];

    for (const [name, schema] of Object.entries(document.components?.schemas ?? {})) {
      for (const [property, value] of describableProperties(schema, document)) {
        if (descriptionOf(value, document).length < 15) undescribed.push(`${name}.${property}`);
      }
    }

    expect(undescribed).toEqual([]);
  });

  it("documents X-Request-Id on every response, since every response carries it", async () => {
    const missing: string[] = [];

    for (const [path, method, operation] of await operations()) {
      for (const [status, response] of Object.entries(operation.responses)) {
        if (response.headers?.["X-Request-Id"] === undefined) {
          missing.push(`${method.toUpperCase()} ${path} → ${status}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });
});

describe("idempotency is documented as a header contract (D18)", () => {
  it.each([...IDEMPOTENT_PATHS])("documents the Idempotency-Key request header on POST %s", async (path) => {
    const post = (await doc()).paths[path]?.["post"];
    const header = post?.parameters?.find((p) => p.in === "header" && p.name === "Idempotency-Key");

    expect(header).toBeDefined();
    expect(header?.required).toBe(false);
    expect((header?.description ?? "").length).toBeGreaterThan(40);
    expect(header?.example ?? header?.schema?.example).toBeDefined();
  });

  it.each([...IDEMPOTENT_PATHS])("documents Idempotency-Replayed on the success of POST %s", async (path) => {
    const post = (await doc()).paths[path]?.["post"];
    const success = Object.entries(post?.responses ?? {}).find(
      ([status]) => Number(status) >= 200 && Number(status) < 300,
    );

    expect(success?.[1].headers?.["Idempotency-Replayed"]).toBeDefined();
    // Absent on a first request, "true" on a replay — so never required.
    expect(success?.[1].headers?.["Idempotency-Replayed"]?.required).toBe(false);
  });
});

describe("the error envelope explains itself", () => {
  it("documents every code the API can return, with its meaning", async () => {
    const envelope = (await doc()).components?.schemas?.["ErrorEnvelope"];
    const code = envelope?.properties?.error?.properties?.["code"];
    const description = code?.description ?? "";

    // Driven from the code→status table, so a code added there without a
    // sentence explaining it fails here rather than shipping undocumented.
    for (const name of Object.keys(ERROR_STATUS)) {
      expect({ name, documented: description.includes(name) }).toEqual({ name, documented: true });
    }
  });

  it("gives each error response an example carrying a plausible code", async () => {
    const wrong: string[] = [];

    for (const [path, method, operation] of await operations()) {
      for (const [status, response] of Object.entries(operation.responses)) {
        if (Number(status) < 400) continue;

        const media = response.content?.["application/json"];
        const example = (media?.example ?? Object.values(media?.examples ?? {})[0]?.value) as
          | { error?: { code?: string } }
          | undefined;

        if (example?.error?.code === undefined) {
          wrong.push(`${method.toUpperCase()} ${path} → ${status} (no example)`);
          continue;
        }

        const code = example.error.code as keyof typeof ERROR_STATUS;
        const expected = ERROR_STATUS[code];
        // 415 is the one status the table cannot derive: it carries
        // `invalid_request`, which normally means 400 (errors.ts).
        const ok = String(expected) === status || (status === "415" && code === "invalid_request");

        if (!ok) wrong.push(`${method.toUpperCase()} ${path} → ${status} shows ${code}`);
      }
    }

    expect(wrong).toEqual([]);
  });

  it("shows both 409 meanings where both can happen (slug_taken and idempotency_conflict)", async () => {
    const conflict = (await doc()).paths["/v1/links"]?.["post"]?.responses["409"];
    const codes = Object.values(conflict?.content?.["application/json"]?.examples ?? {}).map(
      (e) => (e.value as { error: { code: string } }).error.code,
    );

    expect(codes.sort()).toEqual(["idempotency_conflict", "slug_taken"]);
  });
});

/**
 * Renderer-hostile shapes. Every finding here is something that is *valid*
 * OpenAPI and still useless to read: the document is only worth having if a
 * client can understand it in the tool they actually open it in.
 */
describe("the document renders legibly", () => {
  /** Walks every schema node in the document, wherever it sits. */
  function schemaNodes(document: OpenApiDocument): [string, SchemaObject][] {
    const out: [string, SchemaObject][] = [];

    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) {
        node.forEach((child, i) => walk(child, `${path}[${i}]`));
        return;
      }

      if (typeof node !== "object" || node === null) return;

      const record = node as Record<string, unknown>;

      if ("type" in record || "anyOf" in record || "oneOf" in record || "$ref" in record) {
        out.push([path, record as SchemaObject]);
      }

      for (const [key, value] of Object.entries(record)) walk(value, `${path}.${key}`);
    };

    walk(document.paths, "paths");
    walk(document.components?.schemas ?? {}, "components");

    return out;
  }

  it("never offers a choice between branches a reader cannot tell apart", async () => {
    const document = await doc();
    const indistinguishable: string[] = [];

    for (const [path, schema] of schemaNodes(document)) {
      const branches = schema.anyOf ?? schema.oneOf;
      if (branches === undefined || branches.length < 2) continue;

      // What a renderer prints for each branch: its ref, its title, or — the
      // failure case — nothing but a bare type.
      const labels = branches.map((b) => b.$ref ?? b.title ?? String(b.type));

      if (new Set(labels).size === 1) {
        indistinguishable.push(`${path} → ${branches.length} × "${labels[0]}"`);
      }
    }

    expect(indistinguishable).toEqual([]);
  });

  it("never states a default that contradicts its own declared type", async () => {
    const document = await doc();
    const contradictory: string[] = [];
    const matches: Record<string, (v: unknown) => boolean> = {
      string: (v) => typeof v === "string",
      integer: (v) => Number.isInteger(v),
      number: (v) => typeof v === "number",
      boolean: (v) => typeof v === "boolean",
      array: (v) => Array.isArray(v),
      object: (v) => typeof v === "object" && v !== null && !Array.isArray(v),
      null: (v) => v === null,
    };

    for (const [path, schema] of schemaNodes(document)) {
      if (schema.default === undefined || schema.type === undefined) continue;

      const types = Array.isArray(schema.type) ? schema.type : [schema.type];

      if (!types.some((t) => matches[t]?.(schema.default) ?? true)) {
        contradictory.push(`${path}: type=${JSON.stringify(schema.type)} default=${JSON.stringify(schema.default)}`);
      }
    }

    expect(contradictory).toEqual([]);
  });

  it("gives the batch item union a discriminator, so its two outcomes are labelled", async () => {
    const items = (await doc()).components?.schemas?.["BatchResult"]?.properties?.["items"]?.items;

    expect(items?.discriminator?.propertyName).toBe("status");
    expect(Object.keys(items?.discriminator?.mapping ?? {}).sort()).toEqual(["created", "error"]);
  });
});

/**
 * A generic sweep cannot catch a schema that is *narrower* than the code —
 * it looks perfectly well-formed. This is the specific guard: the published
 * set of redirect statuses is compared against the set the schema actually
 * parses, in both directions.
 *
 * It exists because `z.literal([301, 302, 307, 308])` — the obvious way to
 * write this — is converted by @hono/zod-openapi 1.6.1 into `enum: [301]`,
 * silently denying three statuses the API accepts.
 */
describe("published values match the values the code accepts", () => {
  /** Every HTTP status in range, so neither direction is a restatement. */
  const CANDIDATES = Array.from({ length: 500 }, (_, i) => i + 100);

  it("documents exactly the redirect statuses redirect_type parses", async () => {
    const accepted = CANDIDATES.filter((v) => redirectTypeSchema.safeParse(v).success);
    const document = await doc();

    expect(accepted).toEqual([301, 302, 307, 308]);

    const published = document.components?.schemas?.["Link"]?.properties?.["redirect_type"]?.enum;

    expect(published).toBeDefined();
    expect([...(published ?? [])].sort()).toEqual([...accepted].sort());
  });

  it("documents the same set on the request bodies that accept it", async () => {
    const document = await doc();

    for (const [path, method] of [
      ["/v1/links", "post"],
      ["/v1/links/{slug}", "patch"],
    ] as const) {
      const schema = document.paths[path]?.[method]?.requestBody?.content?.["application/json"]
        ?.schema?.properties?.["redirect_type"];

      expect({ path, values: [...(schema?.enum ?? [])].sort() }).toEqual({
        path,
        values: [301, 302, 307, 308],
      });
    }
  });
});
