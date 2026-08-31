import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "../../src/services/cursor";

describe("cursor codec (api-contract §GET /v1/links — opaque base64url keyset)", () => {
  it("round-trips the keyset position", () => {
    const encoded = encodeCursor({ createdAt: 1_756_684_800_000, id: 42 });

    expect(decodeCursor(encoded)).toEqual({ createdAt: 1_756_684_800_000, id: 42 });
  });

  it("is opaque — the position is not readable in the cursor itself", () => {
    const encoded = encodeCursor({ createdAt: 1_756_684_800_000, id: 42 });

    expect(encoded).not.toContain("1756684800000");
    expect(encoded).not.toContain("42");
  });

  it("emits only base64url characters, so it survives URL encoding unchanged", () => {
    // 8-bit-boundary inputs are where standard base64 would emit `+`, `/` or `=`.
    for (const id of [1, 255, 65_535, 16_777_215]) {
      const encoded = encodeCursor({ createdAt: 1_756_684_800_123, id });

      expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(encodeURIComponent(encoded)).toBe(encoded);
    }
  });

  it("round-trips a zero created_at", () => {
    expect(decodeCursor(encodeCursor({ createdAt: 0, id: 7 }))).toEqual({ createdAt: 0, id: 7 });
  });

  describe("rejects a cursor it did not mint", () => {
    it("rejects characters outside the base64url alphabet", () => {
      expect(decodeCursor("not a cursor!")).toBeNull();
    });

    it("rejects base64url that decodes to the wrong shape", () => {
      expect(decodeCursor(btoa("nonsense").replace(/=+$/, ""))).toBeNull();
    });

    it("rejects a position with a non-numeric half", () => {
      expect(decodeCursor(btoa("1756684800000.abc").replace(/=+$/, ""))).toBeNull();
    });

    it("rejects a position with a missing half", () => {
      expect(decodeCursor(btoa("1756684800000").replace(/=+$/, ""))).toBeNull();
    });

    it("rejects an empty cursor", () => {
      expect(decodeCursor("")).toBeNull();
    });

    it("rejects a number too large to be exact", () => {
      expect(decodeCursor(btoa("99999999999999999999.1").replace(/=+$/, ""))).toBeNull();
    });
  });
});
