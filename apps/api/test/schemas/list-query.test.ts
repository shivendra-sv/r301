import { describe, expect, it } from "vitest";
import { z } from "@hono/zod-openapi";
import { apiCodeOf } from "../../src/schemas/fields";
import { listLinksQuerySchema } from "../../src/schemas/list-query";

function codes(schema: z.ZodType, input: unknown): string[] {
  return (schema.safeParse(input).error?.issues ?? []).map(apiCodeOf);
}

// Query values always arrive as strings from the URL, so every case below
// feeds strings — never the parsed types.
describe("list-links query schema (api-contract §GET /v1/links)", () => {
  it("defaults limit to 25 when the query is empty", () => {
    expect(listLinksQuerySchema.parse({})).toEqual({ limit: 25 });
  });

  it("parses every filter together", () => {
    expect(
      listLinksQuerySchema.parse({
        tag: "tenant:42",
        active: "true",
        created_after: "2026-08-01T00:00:00Z",
        external_id: "appt_9182",
        cursor: "b3BhcXVl",
        limit: "50",
      }),
    ).toEqual({
      tag: "tenant:42",
      active: true,
      created_after: "2026-08-01T00:00:00Z",
      external_id: "appt_9182",
      cursor: "b3BhcXVl",
      limit: 50,
    });
  });

  describe("limit", () => {
    it.each([
      ["1", 1],
      ["25", 25],
      ["100", 100],
    ])("accepts %s at the range boundary", (limit, expected) => {
      expect(listLinksQuerySchema.parse({ limit }).limit).toBe(expected);
    });

    // The api-contract calls a bad query param an invalid_request, so an
    // out-of-range limit is an error rather than a silent clamp — a silently
    // clamped 1000 would look like a short page and hide a client bug.
    it.each(["0", "101", "-1", "1000"])("rejects out-of-range %s", (limit) => {
      expect(listLinksQuerySchema.safeParse({ limit }).success).toBe(false);
      expect(codes(listLinksQuerySchema, { limit })).toEqual(["invalid_request"]);
    });

    it.each(["abc", "", "1.5", "1e2", " "])("rejects non-integer %p", (limit) => {
      expect(listLinksQuerySchema.safeParse({ limit }).success).toBe(false);
    });
  });

  describe("active", () => {
    it.each([
      ["true", true],
      ["false", false],
    ])("parses %s", (active, expected) => {
      expect(listLinksQuerySchema.parse({ active }).active).toBe(expected);
    });

    it.each(["TRUE", "True", "1", "0", "yes", "no", ""])(
      "rejects %p — only the exact lowercase literals parse",
      (active) => {
        expect(listLinksQuerySchema.safeParse({ active }).success).toBe(false);
      },
    );

    it("is absent, not false, when the filter is omitted", () => {
      expect(listLinksQuerySchema.parse({})).not.toHaveProperty("active");
    });
  });

  describe("created_after", () => {
    it.each(["2026-08-01T00:00:00Z", "2026-08-01T00:00:00+05:30", "2020-01-01T00:00:00Z"])(
      "accepts ISO 8601 instant %s",
      (created_after) => {
        expect(listLinksQuerySchema.safeParse({ created_after }).success).toBe(true);
      },
    );

    it.each(["2026-08-01", "yesterday", "2026-08-01T00:00:00", "1754006400"])(
      "rejects %p",
      (created_after) => {
        expect(listLinksQuerySchema.safeParse({ created_after }).success).toBe(false);
      },
    );
  });

  describe("tag, external_id and cursor", () => {
    it("accepts ordinary values", () => {
      expect(
        listLinksQuerySchema.safeParse({ tag: "kind:appointment", external_id: "x", cursor: "y" })
          .success,
      ).toBe(true);
    });

    it.each([
      ["tag", { tag: "" }],
      ["external_id", { external_id: "" }],
      ["cursor", { cursor: "" }],
    ])("rejects an empty %s — an omitted filter is not an empty one", (_name, query) => {
      expect(listLinksQuerySchema.safeParse(query).success).toBe(false);
    });

    it("caps external_id at the field's 128 characters", () => {
      expect(listLinksQuerySchema.safeParse({ external_id: "a".repeat(128) }).success).toBe(true);
      expect(listLinksQuerySchema.safeParse({ external_id: "a".repeat(129) }).success).toBe(false);
    });
  });

  // D22 strictness applies to query params too: a misspelled filter must not
  // silently widen the result set.
  it("rejects an unknown query param and names it", () => {
    const result = listLinksQuerySchema.safeParse({ tags: "oops" });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("tags");
    expect(codes(listLinksQuerySchema, { tags: "oops" })).toEqual(["invalid_request"]);
  });
});
