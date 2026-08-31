// SHA-256 hex, in its own module so idempotency's request hashing (D18) does
// not grow a private copy. `services/keys.ts` still carries its own identical
// implementation for api-key hashing (PRD §7.6); folding it in here is
// PROGRESS question 18 — out of prompt 11's scope, not an oversight.

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));

  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
