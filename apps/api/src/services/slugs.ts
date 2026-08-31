// Slug service (PRD §7.1, D15–D16, design.md §6). Generation is pure and takes
// its randomness by injection; resolution is the only part that touches D1.

import { findLinkIdBySlug } from "../db/queries";
import { isReservedSlug } from "../reserved-slugs";
import { apiCodeOf, slugSchema } from "../schemas/fields";
import { randomBase62, type RandomBytes } from "./random";

/** PRD §7.1: 7 chars of base62 ≈ 3.5 × 10¹² slugs. */
export const SLUG_LENGTH = 7;

export type { RandomBytes };

export function generateSlug(rng?: RandomBytes): string {
  return randomBase62(SLUG_LENGTH, rng);
}

/**
 * Attempts allowed before giving up. At 62⁷ ≈ 3.5 × 10¹² slugs against §19's
 * pilot volumes, three consecutive collisions is not a scale limit — it is the
 * signal that something else is wrong.
 */
export const MAX_AUTO_SLUG_ATTEMPTS = 3;

export type SlugErrorCode = "invalid_request" | "slug_reserved" | "slug_taken" | "internal";

export type SlugResolution =
  | { ok: true; slug: string }
  | { ok: false; code: SlugErrorCode; message: string };

export interface ResolveSlugOptions {
  db: D1Database;
  /** Omitted means "generate one"; present means the caller chose it. */
  custom?: string | undefined;
  rng?: RandomBytes | undefined;
}

function taken(slug: string): SlugResolution {
  return { ok: false, code: "slug_taken", message: `Slug '${slug}' is already in use.` };
}

async function isTaken(db: D1Database, slug: string): Promise<boolean> {
  return (await findLinkIdBySlug(db, slug)) !== null;
}

/**
 * Custom slugs are validated by the 08 schema — this composes it rather than
 * restating the rules. Auto slugs are generated, checked against the reserved
 * list (D16) and against D1, and redrawn on either hit.
 *
 * The existence check races an INSERT by another request; that is intentional
 * and not a hole. `UNIQUE(slug)` is the real arbiter, so the caller's insert
 * must still handle a constraint violation (design §6).
 */
export async function resolveSlug({ db, custom, rng }: ResolveSlugOptions): Promise<SlugResolution> {
  if (custom !== undefined) {
    const parsed = slugSchema.safeParse(custom);

    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      // The slug schema can only ever raise these two.
      const code = issue !== undefined && apiCodeOf(issue) === "slug_reserved"
        ? "slug_reserved"
        : "invalid_request";

      return { ok: false, code, message: issue?.message ?? "Slug is invalid." };
    }

    return (await isTaken(db, custom)) ? taken(custom) : { ok: true, slug: custom };
  }

  for (let attempt = 0; attempt < MAX_AUTO_SLUG_ATTEMPTS; attempt += 1) {
    const slug = generateSlug(rng);

    // D16 applies the reserved check to generated slugs too; at these odds it
    // costs nothing and closes the case where a draw spells `youtube`.
    if (isReservedSlug(slug) || (await isTaken(db, slug))) continue;

    return { ok: true, slug };
  }

  return {
    ok: false,
    code: "internal",
    message: "Could not allocate a unique slug; retry the request.",
  };
}
