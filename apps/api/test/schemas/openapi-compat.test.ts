import { describe, expect, it } from "vitest";
import { z } from "@hono/zod-openapi";
import { batchCreateSchema } from "../../src/schemas/batch-create";
import { createLinkSchema } from "../../src/schemas/create-link";
import { listLinksQuerySchema } from "../../src/schemas/list-query";
import { tagStatsQuerySchema } from "../../src/schemas/stats-query";
import { patchLinkSchema } from "../../src/schemas/patch-link";

const SCHEMAS = {
  createLinkSchema,
  batchCreateSchema,
  patchLinkSchema,
  listLinksQuerySchema,
  tagStatsQuerySchema,
} as const;

/**
 * D22 / prompt 19: these schemas are the source of the generated OpenAPI
 * document. A schema that cannot be rendered to JSON Schema throws at
 * document-build time, not at parse time, so nothing else in this suite would
 * catch it — hence this guard.
 */
describe("OpenAPI convertibility (D22, prompt 19)", () => {
  // Requests are documented from the INPUT side: what a client sends.
  it.each(Object.keys(SCHEMAS))("renders %s to JSON Schema (input side)", (name) => {
    const schema = SCHEMAS[name as keyof typeof SCHEMAS];

    expect(() => z.toJSONSchema(schema, { io: "input" })).not.toThrow();
  });

  it("documents the create body's fields and default", () => {
    const json = z.toJSONSchema(createLinkSchema, { io: "input" }) as {
      properties: Record<string, { default?: number }>;
      required: string[];
      additionalProperties?: boolean;
    };

    expect(Object.keys(json.properties).sort()).toEqual([
      "destination",
      "expires_at",
      "external_id",
      "redirect_type",
      "slug",
      "tags",
    ]);
    expect(json.required).toEqual(["destination"]);
    expect(json.properties["redirect_type"]?.default).toBe(302);
    // .strict() must survive into the document, or the published contract
    // would advertise tolerance the API does not have (D22).
    expect(json.additionalProperties).toBe(false);
  });

  // Known limitation, pinned so prompt 19 meets it here rather than at build
  // time: `active` and `limit` are string→value transforms, and Zod cannot
  // render a transform's output side. Query parameters are documented from
  // their input side, so this costs nothing — but it is not free to change.
  it("cannot render the list query's output side, by construction", () => {
    expect(() => z.toJSONSchema(listLinksQuerySchema, { io: "output" })).toThrow(/[Tt]ransform/);
  });

  // Batch items are `unknown` so one bad item can be one error rather than a
  // 400 for the whole request (§7.2) — the document must still describe them
  // as objects, or the published contract would advertise "anything goes".
  it("documents batch items as the create body, despite validating per item", () => {
    const json = z.toJSONSchema(batchCreateSchema, { io: "input" }) as {
      properties: Record<
        string,
        {
          type?: string;
          minItems?: number;
          maxItems?: number;
          items?: { type?: string; required?: string[]; properties?: Record<string, unknown> };
        }
      >;
    };
    const links = json.properties["links"];

    expect(links?.type).toBe("array");
    expect(links?.minItems).toBe(1);
    expect(links?.maxItems).toBe(100);
    // The item is the create body itself — not a bare `object`, and not the
    // permissive `unknown` the wrapper actually parses with.
    expect(links?.items?.type).toBe("object");
    expect(links?.items?.required).toEqual(["destination"]);
    expect(Object.keys(links?.items?.properties ?? {}).sort()).toEqual([
      "destination",
      "expires_at",
      "external_id",
      "redirect_type",
      "slug",
      "tags",
    ]);
  });
});
