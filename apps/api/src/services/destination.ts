// Destination safety (PRD §7.1). Pure and endpoint-independent: no Hono, no
// D1, no fetch. Scope note from the PRD — hostnames that privately *resolve*
// to internal IPs are outside v1's threat model, since we never fetch a
// destination; this battery only inspects what the URL literally names.

export type DestinationRejection =
  | "too_long"
  | "unparseable"
  | "scheme"
  | "credentials"
  | "self_domain"
  | "private_host";

export type DestinationResult =
  | { ok: true; url: URL }
  | { ok: false; reason: DestinationRejection; message: string };

/** PRD §7.1. Measured on the input, before any normalization. */
export const MAX_DESTINATION_LENGTH = 2048;

/** Redirecting to ourselves builds loops; subdomains included (PRD §7.1). */
const SELF_DOMAIN = "r301.dev";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Rejection messages never quote the destination: they travel into the error
 * envelope and, if an unexpected error ever wraps one, into Sentry — where
 * D23 says destination URLs must never appear.
 */
const MESSAGES: Record<DestinationRejection, string> = {
  too_long: `Destination must be at most ${MAX_DESTINATION_LENGTH} characters.`,
  unparseable: "Destination is not a valid URL.",
  scheme: "Destination must use the http or https scheme.",
  credentials: "Destination must not embed credentials.",
  self_domain: `Destination must not point at ${SELF_DOMAIN}.`,
  private_host: "Destination must not point at a private, loopback or link-local host.",
};

function fail(reason: DestinationRejection): DestinationResult {
  return { ok: false, reason, message: MESSAGES[reason] };
}

/** The parser only ever emits canonical dotted-quad for an IPv4 host. */
function parseIPv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;

  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }

  return octets;
}

function isPrivateIPv4([a, b]: number[]): boolean {
  if (a === undefined || b === undefined) return false;

  return (
    a === 0 || // 0.0.0.0/8 — "this network"
    a === 10 || // 10/8 private
    a === 127 || // 127/8 loopback
    (a === 169 && b === 254) || // 169.254/16 link-local
    (a === 172 && b >= 16 && b <= 31) || // 172.16/12 private
    (a === 192 && b === 168) // 192.168/16 private
  );
}

/** Expands the compressed lowercase-hex form the parser produces. */
function parseIPv6(host: string): number[] | null {
  const halves = host.split("::");
  if (halves.length > 2) return null;

  const groups = (text: string): number[] | null => {
    if (text === "") return [];

    const out: number[] = [];
    for (const part of text.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      out.push(Number.parseInt(part, 16));
    }

    return out;
  };

  const head = groups(halves[0] ?? "");
  if (head === null) return null;

  if (halves.length === 1) return head.length === 8 ? head : null;

  const tail = groups(halves[1] ?? "");
  if (tail === null) return null;

  const filled = 8 - head.length - tail.length;
  if (filled < 1) return null;

  return [...head, ...(Array<number>(filled).fill(0) as number[]), ...tail];
}

function isPrivateIPv6(groups: number[]): boolean {
  const first = groups[0] ?? 0;

  // ::ffff:a.b.c.d — the parser rewrites a mapped literal to hex, so the
  // embedded v4 address has to be pulled back out and range-checked.
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const high = groups[6] ?? 0;
    const low = groups[7] ?? 0;

    return isPrivateIPv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
  }

  return (
    groups.every((g) => g === 0) || // :: unspecified
    (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) || // ::1 loopback
    (first & 0xfe00) === 0xfc00 || // fc00::/7 unique-local
    (first & 0xffc0) === 0xfe80 // fe80::/10 link-local
  );
}

export function validateDestination(input: string): DestinationResult {
  if (input.length > MAX_DESTINATION_LENGTH) return fail("too_long");

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return fail("unparseable");
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return fail("scheme");

  if (url.username !== "" || url.password !== "") return fail("credentials");

  // `hostname` is already lowercased and IDN-normalized to punycode by the
  // parser, so every check below runs on the resolved ASCII host.
  const host = url.hostname;
  if (host === "") return fail("unparseable");

  if (host === SELF_DOMAIN || host.endsWith(`.${SELF_DOMAIN}`)) return fail("self_domain");

  if (host === "localhost" || host.endsWith(".localhost")) return fail("private_host");

  if (host.startsWith("[") && host.endsWith("]")) {
    const groups = parseIPv6(host.slice(1, -1));

    return groups !== null && isPrivateIPv6(groups) ? fail("private_host") : { ok: true, url };
  }

  const octets = parseIPv4(host);
  if (octets !== null && isPrivateIPv4(octets)) return fail("private_host");

  return { ok: true, url };
}
