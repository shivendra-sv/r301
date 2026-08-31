// SHA-256 hex — the one implementation. Both callers hash secrets: api-key
// material (PRD §7.6) and idempotency request bodies (D18). Consolidated per
// PROGRESS question 18, on the same reasoning as question 17's sampler.

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));

  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
