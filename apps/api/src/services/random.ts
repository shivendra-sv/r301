// The one base62 rejection sampler. Shared by api-key material (PRD §7.6) and
// auto-slug generation (PRD §7.1) so a fix cannot land in one and miss the
// other — extracted per PROGRESS question 17, approved 31 Aug 2026.

export const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * 248 is the largest multiple of 62 that fits in a byte. Bytes at or above it
 * are discarded rather than folded in with `%`, which would over-represent the
 * first eight characters of the alphabet (62 ∤ 256).
 */
const REJECT_AT = 248;

/**
 * Fills the buffer in place — same shape as `crypto.getRandomValues`. The
 * buffer is pinned to a plain `ArrayBuffer` (never `SharedArrayBuffer`): this
 * module reaches `scripts/**` through `keys.ts`, where Node's own
 * `getRandomValues` types reject the wider `ArrayBufferLike`.
 */
export type RandomBytes = (bytes: Uint8Array<ArrayBuffer>) => void;

const cryptoRandomBytes: RandomBytes = (bytes) => {
  crypto.getRandomValues(bytes);
};

/** Injectable randomness is what makes the sampler testable deterministically. */
export function randomBase62(length: number, rng: RandomBytes = cryptoRandomBytes): string {
  let out = "";

  while (out.length < length) {
    const bytes = new Uint8Array(length);
    rng(bytes);

    for (const byte of bytes) {
      if (byte < REJECT_AT) {
        out += BASE62[byte % 62];
        if (out.length === length) break;
      }
    }
  }

  return out;
}
