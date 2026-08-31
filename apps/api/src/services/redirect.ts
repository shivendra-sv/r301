// Redirect evaluation (PRD §7.5, D17, design §2). Pure: it decides from an
// entry and a clock, so the whole matrix is testable without HTTP or storage.

import type { RedirectEntry } from "../kv/redirects-cache";

/** 301/308 are semantically permanent, so a bounded cache still lets counts mostly work. */
const PERMANENT_CACHE_CONTROL = "public, max-age=3600";

/**
 * Every other case, including all 4xx: reactivation via PATCH must not be
 * fought by an intermediary cache (PRD §7.5).
 */
const NO_STORE = "no-store";

export type RedirectDecision =
  | { kind: "redirect"; status: number; location: string; cacheControl: string }
  | { kind: "gone"; cacheControl: string }
  | { kind: "notFound"; cacheControl: string };

export function cacheControlFor(redirectType: number): string {
  return redirectType === 301 || redirectType === 308 ? PERMANENT_CACHE_CONTROL : NO_STORE;
}

export function evaluateRedirect(entry: RedirectEntry, now: number): RedirectDecision {
  // D17 ordering: deactivation outranks expiry, so an owner takedown looks
  // never-existed even when the link had also expired.
  if (entry.a !== 1) {
    return { kind: "notFound", cacheControl: NO_STORE };
  }
  if (entry.x !== null && entry.x < now) {
    return { kind: "gone", cacheControl: NO_STORE };
  }

  return {
    kind: "redirect",
    status: entry.t,
    // Verbatim (D17): an appended param must never corrupt a signed URL.
    location: entry.d,
    cacheControl: cacheControlFor(entry.t),
  };
}

export const NOT_FOUND_CACHE_CONTROL = NO_STORE;
