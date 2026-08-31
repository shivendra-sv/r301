// Key material (PRD §7.6). Shared by the auth middleware and, from prompt 07,
// the mint/revoke scripts — so it stays free of Hono, D1 and `node:*`.

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** 32 base62 chars ≈ 190 bits (PRD §7.6). */
const SECRET_LENGTH = 32;

/**
 * Stored lookup prefix: the first 20 characters, i.e. the 10-char marker plus
 * 10 random ones (D11). Twelve would have left only two random characters,
 * colliding at roughly 73 keys against §19's 100-key goal.
 */
export const KEY_PREFIX_LENGTH = 20;

/** `r301_test_` is reserved for P1 (D13); v1 mints `live` only. */
export type KeyEnvironment = "live" | "test";

export const KEY_PATTERN = /^r301_(live|test)_[0-9A-Za-z]{32}$/;

export interface GeneratedKey {
  /** The full secret. Shown once at creation and never stored (PRD §7.6). */
  key: string;
  prefix: string;
  hash: string;
}

/**
 * Uniform base62 by rejection sampling. 248 is the largest multiple of 62 that
 * fits in a byte, so bytes at or above it are discarded rather than folded in
 * with `%`, which would bias the first eight characters of the alphabet.
 */
function randomBase62(length: number): string {
  let out = "";

  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length));

    for (const byte of bytes) {
      if (byte < 248) {
        out += BASE62[byte % 62];
        if (out.length === length) {
          break;
        }
      }
    }
  }

  return out;
}

/** SHA-256 hex of the full key. Unsalted is sound at this entropy (PRD §7.6). */
export async function hashKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));

  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function generateKey(environment: KeyEnvironment): Promise<GeneratedKey> {
  const key = `r301_${environment}_${randomBase62(SECRET_LENGTH)}`;

  return {
    key,
    prefix: key.slice(0, KEY_PREFIX_LENGTH),
    hash: await hashKey(key),
  };
}
