// Pure control-plane logic for the mint/revoke scripts (PRD §7.6 D14).
// Kept free of `node:*` so the Worker test pool can import it; the Node
// entry points are mint-key.ts and revoke-key.ts.

import { KEY_PREFIX_LENGTH } from "../src/services/keys";

/** Which database to act on. `local` is the top-level Miniflare binding. */
export type Target = "local" | "staging" | "production";

const TARGETS = new Set<string>(["local", "staging", "production"]);

/**
 * Labels are inlined into SQL as literals, because `wrangler d1 execute` takes
 * a command string and offers no bind parameters. Rather than trusting escaping
 * alone, the label alphabet is restricted first — escaping is the second line.
 */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** A stored lookup prefix: the marker plus 10 base62 characters (D11). */
const PREFIX_PATTERN = /^r301_(live|test)_[0-9A-Za-z]{10}$/;

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

export const MINT_USAGE =
  "usage: mint-key --env local|staging|production --name <label>\n" +
  "  <label>: letters, digits, dash and underscore only (e.g. ci-smoke)";

export const REVOKE_USAGE =
  "usage: revoke-key --env local|staging|production --prefix <20-char key prefix>";

/** Minimal `--flag value` parser. Unknown flags are an error, never ignored. */
function parseFlags(argv: string[], allowed: string[]): Parsed<Record<string, string>> {
  const flags: Record<string, string> = {};

  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];

    if (flag === undefined || !flag.startsWith("--") || !allowed.includes(flag.slice(2))) {
      return { ok: false, message: `unknown or malformed argument: ${String(flag)}` };
    }
    if (value === undefined) {
      return { ok: false, message: `${flag} needs a value` };
    }

    flags[flag.slice(2)] = value;
  }

  return { ok: true, value: flags };
}

function readTarget(flags: Record<string, string>): Target | null {
  const target = flags.env;

  return target !== undefined && TARGETS.has(target) ? (target as Target) : null;
}

export function parseMintArgs(argv: string[]): Parsed<{ target: Target; name: string }> {
  const flags = parseFlags(argv, ["env", "name"]);
  if (!flags.ok) {
    return { ok: false, message: `${flags.message}\n${MINT_USAGE}` };
  }

  const target = readTarget(flags.value);
  const name = flags.value.name;

  if (target === null || name === undefined || !NAME_PATTERN.test(name)) {
    return { ok: false, message: MINT_USAGE };
  }

  return { ok: true, value: { target, name } };
}

export function parseRevokeArgs(argv: string[]): Parsed<{ target: Target; prefix: string }> {
  const flags = parseFlags(argv, ["env", "prefix"]);
  if (!flags.ok) {
    return { ok: false, message: `${flags.message}\n${REVOKE_USAGE}` };
  }

  const target = readTarget(flags.value);
  const prefix = flags.value.prefix;

  if (target === null || prefix === undefined || !PREFIX_PATTERN.test(prefix)) {
    return { ok: false, message: REVOKE_USAGE };
  }

  return { ok: true, value: { target, prefix } };
}

/** SQL string literal quoting: double any embedded single quote. */
function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Stores prefix + hash only — the secret never reaches the database, and
 * never reaches this string (PRD §7.6, D14). `environment` is always `live`:
 * test keys are deferred to P1 (D13).
 */
export function buildInsertSql(row: {
  prefix: string;
  hash: string;
  name: string;
  createdAt: number;
}): string {
  return (
    "INSERT INTO api_keys (prefix, key_hash, name, environment, created_at) VALUES (" +
    `${quote(row.prefix)}, ${quote(row.hash)}, ${quote(row.name)}, 'live', ${row.createdAt})`
  );
}

/**
 * `revoked_at IS NULL` makes this idempotent-by-omission: re-revoking reports
 * zero rows rather than silently moving the revocation timestamp.
 *
 * `RETURNING` is how rows-affected is reported: `wrangler d1 execute --json`
 * gives a `meta` carrying only `duration` against a local database, with no
 * `changes` field, so counting returned rows is the one method that works the
 * same locally and remotely.
 */
export function buildRevokeSql(prefix: string, at: number): string {
  return (
    `UPDATE api_keys SET revoked_at = ${at} ` +
    `WHERE prefix = ${quote(prefix)} AND revoked_at IS NULL RETURNING prefix`
  );
}

/**
 * Rows returned by the first statement of a `wrangler d1 execute --json` run,
 * or null if the output could not be understood — which the caller must treat
 * as a failure rather than as "zero rows".
 */
export function countReturnedRows(stdout: string): number | null {
  const start = stdout.indexOf("[");
  if (start === -1) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(stdout.slice(start));
    const first = Array.isArray(parsed) ? parsed[0] : undefined;
    const results = (first as { results?: unknown } | undefined)?.results;

    return Array.isArray(results) ? results.length : null;
  } catch {
    return null;
  }
}

export function wranglerArgs(target: Target, sql: string): string[] {
  const location = target === "local" ? ["--local"] : ["--env", target, "--remote"];

  return ["d1", "execute", "DB", ...location, "--json", "--command", sql];
}

export function mintOutput(key: string, prefix: string): string {
  return [
    "",
    "  API key minted. The secret is shown ONCE and is not recoverable —",
    "  store it now, then hand it over out-of-band.",
    "",
    `    key:    ${key}`,
    `    prefix: ${prefix}   (use this to revoke)`,
    "",
  ].join("\n");
}

export { KEY_PREFIX_LENGTH };
