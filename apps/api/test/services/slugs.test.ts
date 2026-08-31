import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { isReservedSlug } from "../../src/reserved-slugs";
import {
  generateSlug,
  resolveSlug,
  SLUG_LENGTH,
  type RandomBytes,
} from "../../src/services/slugs";
import { seedApiKey } from "../helpers/auth";

/**
 * Serves a fixed byte stream, one slice per call, and throws when exhausted —
 * so an implementation that over-draws fails loudly instead of silently
 * padding with zeros.
 */
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

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

describe("auto-slug generation (PRD §7.1)", () => {
  it("is exactly 7 characters", () => {
    expect(SLUG_LENGTH).toBe(7);
    expect(generateSlug()).toHaveLength(7);
  });

  it("draws only from the base62 alphabet", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateSlug()).toMatch(/^[0-9A-Za-z]{7}$/);
    }
  });

  it("uses the full alphabet, not a truncated one", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i += 1) {
      for (const char of generateSlug()) seen.add(char);
    }

    expect(seen.size).toBe(62);
  });

  it("does not repeat across many draws", () => {
    const slugs = new Set(Array.from({ length: 500 }, () => generateSlug()));

    expect(slugs.size).toBe(500);
  });

  it("maps each accepted byte to its alphabet position", () => {
    const { rng } = scriptedRng([0, 1, 9, 10, 35, 36, 61]);

    // 0→"0", 1→"1", 9→"9", 10→"A", 35→"Z", 36→"a", 61→"z" — the digits, then
    // the uppercase block, then the lowercase block.
    expect(generateSlug(rng)).toBe("019AZaz");
  });

  describe("rejection sampling (62 ∤ 256)", () => {
    // 248 is the largest multiple of 62 that fits in a byte, so 248–255 are
    // the biased values. Folding them in with % 62 would over-represent the
    // first eight characters of the alphabet.
    it("accepts 247, the largest in-range byte", () => {
      const { rng } = scriptedRng(Array(SLUG_LENGTH).fill(247));

      expect(generateSlug(rng)).toBe("zzzzzzz");
    });

    it("rejects 248 and every byte above it, drawing again instead", () => {
      const rejected = [248, 249, 250, 251, 252, 253, 254];
      const { rng, draws } = scriptedRng([...rejected, 255, 0, 1, 2, 3, 4, 5, 6, 0, 0, 0, 0, 0, 0]);

      // Not one of the eight rejected bytes contributed a character: the
      // result is exactly the accepted bytes 0–6, in order.
      expect(generateSlug(rng)).toBe("0123456");
      expect(draws()).toBe(3);
    });

    it("never maps an out-of-range byte to a character", () => {
      for (let byte = 248; byte <= 255; byte += 1) {
        const { rng } = scriptedRng([
          ...(Array(SLUG_LENGTH).fill(byte) as number[]),
          ...(Array(SLUG_LENGTH).fill(0) as number[]),
        ]);

        // Had the byte been folded in, %62 would have produced one of "0"–"7"
        // in the first position from a *rejected* draw; instead the whole
        // draw is discarded and the next one supplies all seven characters.
        expect(generateSlug(rng)).toBe("0000000");
        expect(ALPHABET[byte % 62]).not.toBe(undefined);
      }
    });
  });
});

// ---------------------------------------------------------------------------

/** Bytes that make `generateSlug` spell exactly this slug, one byte per char. */
function bytesFor(slug: string): number[] {
  return [...slug].map((char) => {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error(`${char} is not in the base62 alphabet`);

    return index;
  });
}

async function seedLink(slug: string, deletedAt: number | null = null): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO links (slug, destination, created_by_key_id, deleted_at, created_at, updated_at)
     VALUES (?1, 'https://example.com/', ?2, ?3, 0, 0)`,
  )
    .bind(slug, seededKeyId, deletedAt)
    .run();
}

let seededKeyId: number;

beforeEach(async () => {
  seededKeyId = (await seedApiKey()).id;
});

describe("slug resolution (PRD §7.1, D15–D16, design §6)", () => {
  describe("custom slug", () => {
    it("accepts a free, well-formed slug verbatim", async () => {
      const result = await resolveSlug({ db: env.DB, custom: "launch" });

      expect(result).toEqual({ ok: true, slug: "launch" });
    });

    // D16: match is case-sensitive, so the stored casing is the user's.
    it("preserves case", async () => {
      const result = await resolveSlug({ db: env.DB, custom: "LaUnCh" });

      expect(result).toEqual({ ok: true, slug: "LaUnCh" });
    });

    it("treats a differently-cased slug as a different slug (D16)", async () => {
      await seedLink("launch");

      expect(await resolveSlug({ db: env.DB, custom: "Launch" })).toMatchObject({ ok: true });
    });

    it.each(["api", "API", "Admin", "AbUsE"])(
      "rejects reserved slug %s case-insensitively (D16)",
      async (custom) => {
        expect(await resolveSlug({ db: env.DB, custom })).toMatchObject({
          ok: false,
          code: "slug_reserved",
        });
      },
    );

    it.each(["ab", "a".repeat(65), "has space", "dot.slug"])(
      "rejects malformed slug %p as invalid_request",
      async (custom) => {
        expect(await resolveSlug({ db: env.DB, custom })).toMatchObject({
          ok: false,
          code: "invalid_request",
        });
      },
    );

    it("reports a slug taken by a live link", async () => {
      await seedLink("launch");

      expect(await resolveSlug({ db: env.DB, custom: "launch" })).toMatchObject({
        ok: false,
        code: "slug_taken",
      });
    });

    // D15: UNIQUE(slug) spans tombstones — a deleted link keeps its slug until
    // the P1 purge cron, and this path must never special-case that.
    it("reports a slug taken by a tombstoned link (D15)", async () => {
      await seedLink("launch", 1_700_000_000_000);

      expect(await resolveSlug({ db: env.DB, custom: "launch" })).toMatchObject({
        ok: false,
        code: "slug_taken",
      });
    });

    it("explains a taken slug by name, as the api-contract example does", async () => {
      await seedLink("launch");
      const result = await resolveSlug({ db: env.DB, custom: "launch" });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.message).toContain("launch");
    });
  });

  describe("auto slug", () => {
    it("generates one when no custom slug is given", async () => {
      const result = await resolveSlug({ db: env.DB });

      expect(result).toMatchObject({ ok: true });
      if (!result.ok) throw new Error("unreachable");
      expect(result.slug).toMatch(/^[0-9A-Za-z]{7}$/);
    });

    // D16: the reserved check runs on generated slugs too. `youtube` is a
    // 7-char entry on the list, so the absurd-odds hit is reproducible here.
    it("regenerates transparently when it spells a reserved word (D16)", async () => {
      const { rng } = scriptedRng([...bytesFor("youtube"), ...bytesFor("free123")]);

      expect(await resolveSlug({ db: env.DB, rng })).toEqual({ ok: true, slug: "free123" });
    });

    it("retries when the generated slug is already taken", async () => {
      await seedLink("taken01");
      const { rng } = scriptedRng([...bytesFor("taken01"), ...bytesFor("free123")]);

      expect(await resolveSlug({ db: env.DB, rng })).toEqual({ ok: true, slug: "free123" });
    });

    it("retries a slug taken by a tombstoned link too (D15)", async () => {
      await seedLink("taken01", 1_700_000_000_000);
      const { rng } = scriptedRng([...bytesFor("taken01"), ...bytesFor("free123")]);

      expect(await resolveSlug({ db: env.DB, rng })).toEqual({ ok: true, slug: "free123" });
    });

    it("gives up with a typed internal error after 3 consecutive collisions", async () => {
      for (const slug of ["taken01", "taken02", "taken03"]) await seedLink(slug);
      const { rng, draws } = scriptedRng([
        ...bytesFor("taken01"),
        ...bytesFor("taken02"),
        ...bytesFor("taken03"),
        ...bytesFor("free123"),
      ]);

      expect(await resolveSlug({ db: env.DB, rng })).toMatchObject({
        ok: false,
        code: "internal",
      });
      // It stopped at the cap rather than drawing a fourth time.
      expect(draws()).toBe(3);
    });

    it("succeeds on the third attempt, the last one allowed", async () => {
      for (const slug of ["taken01", "taken02"]) await seedLink(slug);
      const { rng } = scriptedRng([
        ...bytesFor("taken01"),
        ...bytesFor("taken02"),
        ...bytesFor("free123"),
      ]);

      expect(await resolveSlug({ db: env.DB, rng })).toEqual({ ok: true, slug: "free123" });
    });

    it("never returns a reserved slug", async () => {
      for (let i = 0; i < 50; i += 1) {
        const result = await resolveSlug({ db: env.DB });

        expect(result).toMatchObject({ ok: true });
        if (!result.ok) throw new Error("unreachable");
        expect(isReservedSlug(result.slug)).toBe(false);
      }
    });
  });
});
