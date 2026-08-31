// The only module that writes the REDIRECTS namespace (design.md §3, D20).
// KV holds zero unique state — it is a pure, rebuildable cache of D1.

import type { LinkRow } from "../db/types";

/**
 * PRD §9: `slug → {d, t, x, a}`. Single-letter keys because the redirect path
 * parses this on every request; anything more is per-request cost for nothing.
 */
export interface RedirectEntry {
  /** destination */
  d: string;
  /** redirect_type */
  t: number;
  /** expires_at, epoch ms — null means never */
  x: number | null;
  /** is_active, as stored: 1 or 0 */
  a: number;
}

export function redirectEntryFor(row: LinkRow): RedirectEntry {
  return { d: row.destination, t: row.redirect_type, x: row.expires_at, a: row.is_active };
}

/**
 * Callers must await this **after** D1 commits (D20's ordering invariant). A
 * fire-and-forget put that silently failed would leave a stale entry, and
 * backfill can never heal stale — only missing.
 */
export async function putRedirect(
  kv: KVNamespace,
  slug: string,
  entry: RedirectEntry,
): Promise<void> {
  await kv.put(slug, JSON.stringify(entry));
}

export async function removeRedirect(kv: KVNamespace, slug: string): Promise<void> {
  await kv.delete(slug);
}

/**
 * The hot-path read. No `cacheTtl` override — it would widen D20's ≤60 s
 * convergence window, and this is the read that decides what a click does.
 */
export function getRedirect(kv: KVNamespace, slug: string): Promise<RedirectEntry | null> {
  return kv.get<RedirectEntry>(slug, "json");
}
