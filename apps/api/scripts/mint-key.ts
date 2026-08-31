// Mint an API key (PRD §7.6, D14). The secret is generated on this machine,
// only its prefix and hash are stored, and it is printed exactly once.
// Runbook Phase C: pnpm mint-key --env staging --name ci-smoke

import { spawnSync } from "node:child_process";
import { generateKey } from "../src/services/keys";
import { buildInsertSql, mintOutput, parseMintArgs, wranglerArgs } from "./key-admin";

const parsed = parseMintArgs(process.argv.slice(2));

if (!parsed.ok) {
  console.error(parsed.message);
  process.exit(1);
}

const { target, name } = parsed.value;
const generated = await generateKey("live");

// Args are passed as an array with no shell, so the SQL string is never
// re-parsed by a shell on its way to wrangler.
const result = spawnSync(
  "wrangler",
  wranglerArgs(
    target,
    buildInsertSql({
      prefix: generated.prefix,
      hash: generated.hash,
      name,
      createdAt: Date.now(),
    }),
  ),
  { encoding: "utf8" },
);

// The key is printed only after the row is safely stored — otherwise the
// operator would be holding a secret that authenticates nothing.
if (result.error !== undefined || result.status !== 0) {
  console.error(`wrangler failed to store the key (exit ${String(result.status)})`);
  console.error(result.stderr ?? result.error?.message ?? "");
  process.exit(1);
}

console.log(mintOutput(generated.key, generated.prefix));
