import { describe, expect, it } from "vitest";
import { generateKey, hashKey, KEY_PATTERN, KEY_PREFIX_LENGTH } from "../../src/services/keys";

describe("key material (PRD §7.6)", () => {
  it("generates a live key in the documented format", async () => {
    const { key } = await generateKey("live");

    expect(key).toMatch(/^r301_live_[0-9A-Za-z]{32}$/);
  });

  // D11: 20 chars, of which 10 are random — 12 would have left only 2 random
  // beyond the fixed marker and collided by roughly 73 keys.
  it("uses the first 20 characters as the lookup prefix", async () => {
    const { key, prefix } = await generateKey("live");

    expect(prefix).toBe(key.slice(0, KEY_PREFIX_LENGTH));
    expect(prefix).toHaveLength(20);
    expect(prefix.slice(10)).toMatch(/^[0-9A-Za-z]{10}$/);
  });

  it("stores the sha256 hex of the full key", async () => {
    const { key, hash } = await generateKey("live");

    expect(hash).toBe(await hashKey(key));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  // Known vector — pins that this really is SHA-256 hex, not some other digest.
  it("hashes with SHA-256", async () => {
    expect(await hashKey("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("never repeats a key across many mints", async () => {
    const minted = await Promise.all(
      Array.from({ length: 100 }, async () => (await generateKey("live")).key),
    );

    expect(new Set(minted).size).toBe(100);
  });

  // The format section names both markers; only `live` is used in v1 (D13).
  it("supports the P1-reserved test marker", async () => {
    const { key } = await generateKey("test");

    expect(key).toMatch(/^r301_test_[0-9A-Za-z]{32}$/);
  });

  describe("KEY_PATTERN", () => {
    it("accepts a freshly generated key", async () => {
      const { key } = await generateKey("live");

      expect(KEY_PATTERN.test(key)).toBe(true);
    });

    it.each([
      ["empty", ""],
      ["wrong marker", `r301_prod_${"a".repeat(32)}`],
      ["too short", `r301_live_${"a".repeat(31)}`],
      ["too long", `r301_live_${"a".repeat(33)}`],
      ["non-base62 character", `r301_live_${"a".repeat(31)}-`],
      ["leading whitespace", ` r301_live_${"a".repeat(32)}`],
    ])("rejects a key with a %s", (_name, candidate) => {
      expect(KEY_PATTERN.test(candidate)).toBe(false);
    });
  });
});
