import { describe, expect, it } from "vitest";
import {
  isReservedSlug,
  RESERVED_SLUGS,
  RESERVED_SLUGS_VERSION,
} from "../src/reserved-slugs";

// D16: the list is versioned in-repo and checked case-insensitively.
describe("reserved slugs (PRD §7.1, D16)", () => {
  // The words the PRD names explicitly — these are the contract, not curation.
  it.each(["api", "v1", "docs", "admin", "status", "www", "abuse"])(
    "reserves the PRD-named word %s",
    (word) => {
      expect(isReservedSlug(word)).toBe(true);
    },
  );

  it.each(["API", "Admin", "AbUsE", "WWW"])(
    "matches case-insensitively: %s",
    (word) => {
      expect(isReservedSlug(word)).toBe(true);
    },
  );

  // The last three are near-misses: the check is exact membership, never a
  // prefix or substring match, so `admins` is free even though `admin` is not.
  it.each(["aB3xY9k", "launch", "appt-9182", "admins", "apiv1", "statuses"])(
    "leaves ordinary slug %s alone",
    (slug) => {
      expect(isReservedSlug(slug)).toBe(false);
    },
  );

  it("reserves the project's own names", () => {
    expect(isReservedSlug("r301")).toBe(true);
    expect(isReservedSlug("curastax")).toBe(true);
  });

  it("carries roughly the ~200 words D16 asks for", () => {
    expect(RESERVED_SLUGS.length).toBeGreaterThanOrEqual(200);
  });

  it("is stored lowercase, deduplicated and sorted so diffs stay readable", () => {
    expect(RESERVED_SLUGS.map((w) => w.toLowerCase())).toEqual([...RESERVED_SLUGS]);
    expect(new Set(RESERVED_SLUGS).size).toBe(RESERVED_SLUGS.length);
    expect([...RESERVED_SLUGS].sort()).toEqual([...RESERVED_SLUGS]);
  });

  // Entries use the slug alphabet so a stray space or dot can't hide in the
  // list. Length is deliberately NOT floored at the slug minimum of 3: the PRD
  // names `v1`, which the 3–64 regex already makes unreachable — keeping it
  // costs nothing and survives any future loosening of that regex.
  it("contains only entries drawn from the slug alphabet", () => {
    for (const word of RESERVED_SLUGS) {
      expect(word).toMatch(/^[a-z0-9_-]{1,64}$/);
    }
  });

  it("is versioned so a change to the list is a visible change", () => {
    expect(RESERVED_SLUGS_VERSION).toBeGreaterThanOrEqual(1);
  });
});
