// D23 pinned — never weaken or delete (CLAUDE.md hard rule).
// Enforced by test/telemetry/logger-allowlist.pinned.test.ts.

/**
 * Fields telemetry may never carry (PRD §12 D23). Typed as `never` so passing
 * one is a compile error; `logRequest` also strips them at runtime, since a
 * cast or a spread can defeat the type.
 */
type ForbiddenField =
  | "authorization"
  | "body"
  | "cookie"
  | "destination"
  | "headers"
  | "query"
  | "search"
  | "url";

/** The complete allowlist (PRD §15, design.md §9). Nothing else is ever logged. */
export type LogFields = {
  request_id: string;
  /** Route *template* (`/v1/links/:slug`) — never the raw path, which carries the slug. */
  route: string;
  method: string;
  status: number;
  latency_ms: number;
  key_prefix?: string;
  /** Redirect path only, during the pilot (D21). */
  ua?: string;
} & { [K in ForbiddenField]?: never };

/**
 * Emits one structured line per request. The output object is built field by
 * field from the allowlist — that construction *is* the runtime strip, so an
 * unknown key has no path through here even when the type is bypassed.
 */
export function logRequest(fields: LogFields): void {
  const line: Record<string, string | number> = {
    request_id: fields.request_id,
    route: fields.route,
    method: fields.method,
    status: fields.status,
    latency_ms: fields.latency_ms,
  };

  if (fields.key_prefix !== undefined) {
    line.key_prefix = fields.key_prefix;
  }
  if (fields.ua !== undefined) {
    line.ua = fields.ua;
  }

  console.log(JSON.stringify(line));
}
