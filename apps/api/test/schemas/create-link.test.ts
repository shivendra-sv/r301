import { describe, expect, it } from "vitest";
import { z } from "@hono/zod-openapi";
import { apiCodeOf, slugSchema } from "../../src/schemas/fields";
import { createLinkSchema } from "../../src/schemas/create-link";

/** The api-contract error code each issue maps to, in issue order. */
function codes(schema: z.ZodType, input: unknown): string[] {
  return (schema.safeParse(input).error?.issues ?? []).map(apiCodeOf);
}

function fields(schema: z.ZodType, input: unknown): string[] {
  return (schema.safeParse(input).error?.issues ?? []).map((i) => i.path.join("."));
}

describe("slug schema (PRD §7.1, D16)", () => {
  it.each(["abc", "a".repeat(64), "aB3xY9k", "appt-9182", "under_score", "123"])(
    "accepts %s",
    (slug) => {
      expect(slugSchema.safeParse(slug).success).toBe(true);
    },
  );

  it.each([
    ["ab", "two characters is below the 3-char floor"],
    ["a".repeat(65), "65 characters is above the 64-char ceiling"],
    ["has space", "space is outside the alphabet"],
    ["dot.slug", "dot is outside the alphabet"],
    ["slash/slug", "slash is outside the alphabet"],
    ["emoji🎉", "non-ascii is outside the alphabet"],
  ])("rejects %s — %s", (slug) => {
    expect(slugSchema.safeParse(slug).success).toBe(false);
  });

  it("rejects a bad slug as invalid_request, not slug_reserved", () => {
    expect(codes(slugSchema, "ab")).toEqual(["invalid_request"]);
  });

  it.each(["api", "API", "Admin", "AbUsE"])(
    "rejects reserved slug %s as slug_reserved",
    (slug) => {
      expect(codes(slugSchema, slug)).toEqual(["slug_reserved"]);
    },
  );

  it("lets a non-reserved slug through", () => {
    expect(slugSchema.safeParse("launch").success).toBe(true);
  });
});

describe("create-link schema (api-contract §Field constraints)", () => {
  it("requires destination", () => {
    expect(fields(createLinkSchema, {})).toEqual(["destination"]);
    expect(codes(createLinkSchema, {})).toEqual(["invalid_request"]);
  });

  it("accepts a minimal body and defaults redirect_type to 302 (D5)", () => {
    const parsed = createLinkSchema.parse({ destination: "https://example.com/" });

    expect(parsed).toEqual({
      destination: "https://example.com/",
      redirect_type: 302,
    });
  });

  it("accepts a full body unchanged", () => {
    const body = {
      destination: "https://clinic.example.com/appt/9182?t=abc",
      slug: "launch",
      redirect_type: 301,
      expires_at: "2099-09-30T12:00:00Z",
      tags: ["tenant:42", "kind:appointment"],
      external_id: "appt_9182",
    };

    expect(createLinkSchema.parse(body)).toEqual(body);
  });

  it.each([301, 302, 307, 308])("accepts redirect_type %i", (redirect_type) => {
    expect(
      createLinkSchema.safeParse({ destination: "https://example.com/", redirect_type }).success,
    ).toBe(true);
  });

  it.each([200, 303, 404, 0, "302"])("rejects redirect_type %p", (redirect_type) => {
    expect(
      createLinkSchema.safeParse({ destination: "https://example.com/", redirect_type }).success,
    ).toBe(false);
  });

  // The battery itself is covered in services/destination.test.ts — this pins
  // that the schema runs it and reports it as 422 destination_invalid, not 400.
  it("runs the destination battery and reports it as destination_invalid", () => {
    const body = { destination: "http://10.0.0.1/" };

    expect(codes(createLinkSchema, body)).toEqual(["destination_invalid"]);
    expect(fields(createLinkSchema, body)).toEqual(["destination"]);
  });

  it("rejects a non-string destination as invalid_request", () => {
    expect(codes(createLinkSchema, { destination: 42 })).toEqual(["invalid_request"]);
  });

  describe("expires_at (D26 — strictly future)", () => {
    it("accepts a future ISO 8601 instant", () => {
      const parsed = createLinkSchema.parse({
        destination: "https://example.com/",
        expires_at: "2099-09-30T12:00:00Z",
      });

      expect(parsed.expires_at).toBe("2099-09-30T12:00:00Z");
    });

    it("accepts a non-UTC offset", () => {
      expect(
        createLinkSchema.safeParse({
          destination: "https://example.com/",
          expires_at: "2099-09-30T12:00:00+05:30",
        }).success,
      ).toBe(true);
    });

    it.each([
      ["2020-01-01T00:00:00Z", "the past"],
      ["1999-12-31T23:59:59Z", "the distant past"],
    ])("rejects %s — %s", (expires_at) => {
      expect(
        createLinkSchema.safeParse({ destination: "https://example.com/", expires_at }).success,
      ).toBe(false);
    });

    it("rejects now — the bound is strict, is_active is the kill switch", () => {
      const now = new Date().toISOString();

      expect(
        createLinkSchema.safeParse({ destination: "https://example.com/", expires_at: now })
          .success,
      ).toBe(false);
    });

    it.each(["2099-09-30", "not-a-date", "2099-09-30T12:00:00"])(
      "rejects non-ISO-8601-instant %s",
      (expires_at) => {
        expect(
          createLinkSchema.safeParse({ destination: "https://example.com/", expires_at }).success,
        ).toBe(false);
      },
    );
  });

  describe("tags", () => {
    it("accepts up to 10", () => {
      const tags = Array.from({ length: 10 }, (_, i) => `t${i}`);

      expect(
        createLinkSchema.safeParse({ destination: "https://example.com/", tags }).success,
      ).toBe(true);
    });

    it("rejects 11", () => {
      const tags = Array.from({ length: 11 }, (_, i) => `t${i}`);

      expect(
        createLinkSchema.safeParse({ destination: "https://example.com/", tags }).success,
      ).toBe(false);
    });

    it("trims each tag", () => {
      const parsed = createLinkSchema.parse({
        destination: "https://example.com/",
        tags: ["  tenant:42  "],
      });

      expect(parsed.tags).toEqual(["tenant:42"]);
    });

    it.each([[""], ["   "]])("rejects a tag that is empty after trimming: %p", (tag) => {
      expect(
        createLinkSchema.safeParse({ destination: "https://example.com/", tags: [tag] }).success,
      ).toBe(false);
    });

    it("accepts a 64-char tag and rejects 65", () => {
      const base = { destination: "https://example.com/" };

      expect(createLinkSchema.safeParse({ ...base, tags: ["a".repeat(64)] }).success).toBe(true);
      expect(createLinkSchema.safeParse({ ...base, tags: ["a".repeat(65)] }).success).toBe(false);
    });

    it("measures length after trimming", () => {
      expect(
        createLinkSchema.safeParse({
          destination: "https://example.com/",
          tags: [` ${"a".repeat(64)} `],
        }).success,
      ).toBe(true);
    });
  });

  describe("external_id (D19)", () => {
    it("accepts 128 characters", () => {
      expect(
        createLinkSchema.safeParse({
          destination: "https://example.com/",
          external_id: "a".repeat(128),
        }).success,
      ).toBe(true);
    });

    it("rejects 129", () => {
      expect(
        createLinkSchema.safeParse({
          destination: "https://example.com/",
          external_id: "a".repeat(129),
        }).success,
      ).toBe(false);
    });
  });

  // D22: strict requests — the error must name the offending field so a
  // misspelling is self-diagnosing rather than silently ignored.
  describe("strictness (D22)", () => {
    it("rejects an unknown field and names it", () => {
      const result = createLinkSchema.safeParse({
        destination: "https://example.com/",
        destinaton: "https://typo.example.com/",
      });

      expect(result.success).toBe(false);
      expect(JSON.stringify(result.error?.issues)).toContain("destinaton");
      expect(codes(createLinkSchema, {
        destination: "https://example.com/",
        destinaton: "x",
      })).toEqual(["invalid_request"]);
    });

    it("rejects a body that is not an object", () => {
      expect(createLinkSchema.safeParse("nope").success).toBe(false);
      expect(createLinkSchema.safeParse([]).success).toBe(false);
      expect(createLinkSchema.safeParse(null).success).toBe(false);
    });
  });
});
