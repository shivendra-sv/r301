import { describe, expect, it } from "vitest";
import { BASE62, randomBase62, type RandomBytes } from "../../src/services/random";

/** Serves a fixed byte stream, throwing when exhausted so over-draws are loud. */
function scriptedRng(stream: readonly number[]): { rng: RandomBytes; draws: () => number } {
  let offset = 0;
  let draws = 0;

  return {
    rng: (bytes) => {
      draws += 1;
      for (let i = 0; i < bytes.length; i += 1) {
        const next = stream[offset];
        offset += 1;
        if (next === undefined) throw new Error("scripted RNG exhausted");
        bytes[i] = next;
      }
    },
    draws: () => draws,
  };
}

// The one sampler behind both api keys (32 chars, PRD §7.6) and auto-slugs
// (7 chars, PRD §7.1) — extracted per PROGRESS question 17 so a fix cannot
// land in one copy and miss the other.
describe("base62 rejection sampler", () => {
  it("has a 62-character alphabet: digits, then upper, then lower", () => {
    expect(BASE62).toHaveLength(62);
    expect(new Set(BASE62).size).toBe(62);
    expect(BASE62).toBe("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz");
  });

  it.each([1, 7, 32, 100])("returns exactly %i characters", (length) => {
    expect(randomBase62(length)).toHaveLength(length);
  });

  it("draws only from the alphabet", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(randomBase62(32)).toMatch(/^[0-9A-Za-z]{32}$/);
    }
  });

  it("uses the whole alphabet, not a truncated one", () => {
    const seen = new Set(randomBase62(20_000));

    expect(seen.size).toBe(62);
  });

  it("maps each accepted byte to its alphabet position", () => {
    const { rng } = scriptedRng([0, 1, 9, 10, 35, 36, 61]);

    expect(randomBase62(7, rng)).toBe("019AZaz");
  });

  describe("rejection sampling (62 ∤ 256)", () => {
    it("accepts 247, the largest in-range byte", () => {
      const { rng } = scriptedRng(Array(4).fill(247));

      expect(randomBase62(4, rng)).toBe("zzzz");
    });

    // Proven at length 4 rather than 7, so this pins the sampler itself and
    // not something incidental to the slug length.
    it.each([248, 249, 250, 251, 252, 253, 254, 255])(
      "discards the whole draw containing out-of-range byte %i",
      (byte) => {
        const { rng, draws } = scriptedRng([
          ...(Array(4).fill(byte) as number[]),
          ...(Array(4).fill(0) as number[]),
        ]);

        expect(randomBase62(4, rng)).toBe("0000");
        expect(draws()).toBe(2);
      },
    );

    it("consumes further bytes rather than folding a rejected one in", () => {
      const { rng, draws } = scriptedRng([248, 249, 250, 251, 0, 1, 2, 3]);

      expect(randomBase62(4, rng)).toBe("0123");
      expect(draws()).toBe(2);
    });
  });

  it("defaults to crypto randomness when no rng is injected", () => {
    const drawn = new Set(Array.from({ length: 200 }, () => randomBase62(16)));

    expect(drawn.size).toBe(200);
  });
});
