// The list cursor (api-contract §GET /v1/links): an opaque, indefinitely valid
// base64url token carrying the keyset position `(created_at, id)`.
//
// Opaque is a contract, not decoration — clients that parse it would pin the
// pagination key, and changing the sort would then be a breaking change.

/** A position in the `created_at DESC, id DESC` ordering. */
export interface CursorPosition {
  createdAt: number;
  id: number;
}

const SEPARATOR = ".";

/** Standard base64 minus the two URL-unsafe characters and the padding. */
function toBase64Url(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }

  try {
    return atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return null;
  }
}

export function encodeCursor(position: CursorPosition): string {
  return toBase64Url(`${position.createdAt}${SEPARATOR}${position.id}`);
}

/** `null` for anything this module did not mint — the caller renders the 400. */
export function decodeCursor(cursor: string): CursorPosition | null {
  const decoded = fromBase64Url(cursor);

  if (decoded === null) {
    return null;
  }

  const parts = decoded.split(SEPARATOR);

  if (parts.length !== 2) {
    return null;
  }

  const [rawCreatedAt, rawId] = parts as [string, string];

  if (!/^\d+$/.test(rawCreatedAt) || !/^\d+$/.test(rawId)) {
    return null;
  }

  const createdAt = Number(rawCreatedAt);
  const id = Number(rawId);

  // A value past 2^53 would compare wrong against the row it names.
  if (!Number.isSafeInteger(createdAt) || !Number.isSafeInteger(id)) {
    return null;
  }

  return { createdAt, id };
}
