import { describe, expect, it } from "vitest";
import { z } from "@hono/zod-openapi";
import { apiCodeOf } from "../../src/schemas/fields";
import { patchLinkSchema } from "../../src/schemas/patch-link";

function codes(schema: z.ZodType, input: unknown): string[] {
  return (schema.safeParse(input).error?.issues ?? []).map(apiCodeOf);
}

describe("patch-link schema (api-contract §PATCH /v1/links/{slug}, D26)", () => {
  it.each([
    ["destination", { destination: "https://new.example.com/" }],
    ["redirect_type", { redirect_type: 301 }],
    ["expires_at", { expires_at: "2099-01-01T00:00:00Z" }],
    ["is_active", { is_active: false }],
    ["tags", { tags: ["a", "b"] }],
    ["external_id", { external_id: "appt_1" }],
  ])("accepts a lone %s", (_name, body) => {
    expect(patchLinkSchema.safeParse(body)).toMatchObject({ success: true });
  });

  it("accepts every mutable field at once and echoes them", () => {
    const body = {
      destination: "https://new.example.com/",
      redirect_type: 308,
      expires_at: "2099-01-01T00:00:00Z",
      is_active: false,
      tags: ["tenant:42"],
      external_id: "appt_1",
    };

    expect(patchLinkSchema.parse(body)).toEqual(body);
  });

  // D26: an empty PATCH is a no-op request, not a successful update.
  it("rejects an empty object", () => {
    expect(patchLinkSchema.safeParse({}).success).toBe(false);
    expect(codes(patchLinkSchema, {})).toEqual(["invalid_request"]);
  });

  // The slug is immutable (PRD §7.1) — delete and recreate instead. Its
  // presence is therefore an unknown field, not a "read-only field" error.
  it("rejects slug as an unknown field and names it", () => {
    const result = patchLinkSchema.safeParse({ slug: "renamed" });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("slug");
    expect(codes(patchLinkSchema, { slug: "renamed" })).toEqual(["invalid_request"]);
  });

  it("rejects an unknown field alongside a legal one and names it", () => {
    const result = patchLinkSchema.safeParse({ is_active: false, destinaton: "x" });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("destinaton");
  });

  describe("null clears the nullable fields (D26)", () => {
    it.each([
      ["expires_at", { expires_at: null }],
      ["external_id", { external_id: null }],
    ])("accepts null for %s", (_name, body) => {
      expect(patchLinkSchema.parse(body)).toEqual(body);
    });

    it.each([
      ["destination", { destination: null }],
      ["redirect_type", { redirect_type: null }],
      ["is_active", { is_active: null }],
      ["tags", { tags: null }],
    ])("rejects null for non-nullable %s", (_name, body) => {
      expect(patchLinkSchema.safeParse(body).success).toBe(false);
    });
  });

  // The field rules are shared with create — these pin that PATCH reuses them
  // rather than quietly relaxing on the update path.
  describe("reuses the create-time field rules", () => {
    it("runs the destination battery", () => {
      expect(codes(patchLinkSchema, { destination: "http://127.0.0.1/" })).toEqual([
        "destination_invalid",
      ]);
    });

    it("still requires expires_at to be in the future", () => {
      expect(patchLinkSchema.safeParse({ expires_at: "2020-01-01T00:00:00Z" }).success).toBe(
        false,
      );
    });

    it("still caps tags at 10", () => {
      const tags = Array.from({ length: 11 }, (_, i) => `t${i}`);

      expect(patchLinkSchema.safeParse({ tags }).success).toBe(false);
    });

    it("still caps external_id at 128", () => {
      expect(patchLinkSchema.safeParse({ external_id: "a".repeat(129) }).success).toBe(false);
    });

    it("still restricts redirect_type", () => {
      expect(patchLinkSchema.safeParse({ redirect_type: 303 }).success).toBe(false);
    });
  });

  it("rejects a body that is not an object", () => {
    expect(patchLinkSchema.safeParse("nope").success).toBe(false);
    expect(patchLinkSchema.safeParse(null).success).toBe(false);
  });
});
