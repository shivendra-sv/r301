// Revoke an API key by its prefix (PRD §7.6, D14). Key rows are never
// hard-deleted — the links FK depends on them (D12), so this is a soft revoke.
// Runbook rotation: mint new → switch client → revoke old.

import { spawnSync } from "node:child_process";
import { buildRevokeSql, countReturnedRows, parseRevokeArgs, wranglerArgs } from "./key-admin";

const parsed = parseRevokeArgs(process.argv.slice(2));

if (!parsed.ok) {
  console.error(parsed.message);
  process.exit(1);
}

const { target, prefix } = parsed.value;
const result = spawnSync(
  "wrangler",
  wranglerArgs(target, buildRevokeSql(prefix, Date.now())),
  { encoding: "utf8" },
);

if (result.error !== undefined || result.status !== 0) {
  console.error(`wrangler failed to run the revoke (exit ${String(result.status)})`);
  console.error(result.stderr ?? result.error?.message ?? "");
  process.exit(1);
}

const revoked = countReturnedRows(result.stdout);

if (revoked === null) {
  console.error("could not read the result of the revoke — check the key state manually");
  console.error(result.stdout);
  process.exit(1);
}

if (revoked === 0) {
  console.error(`no live key with prefix ${prefix} — not found, or already revoked`);
  process.exit(1);
}

console.log(`revoked ${String(revoked)} key with prefix ${prefix}`);
