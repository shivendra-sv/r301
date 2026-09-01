/**
 * Writes the generated OpenAPI document to `docs/openapi.json` (D22).
 *
 * The document is *generated*, never hand-edited: `docs/api-contract.md` makes
 * code canonical, so a spec file that could be edited independently would be a
 * second source of truth. This script exists so the contract is also a file you
 * can read, diff and hand to a client without running the Worker.
 *
 *   pnpm --filter @r301/api openapi          write docs/openapi.json
 *   pnpm --filter @r301/api openapi:check    fail if it is out of date (CI)
 *
 * `info.version` is the one field that differs from the served document: there
 * it is the deploy's git SHA (so a document and a `/v1/health` probe from one
 * deploy cannot disagree), which would churn this file on every commit. The
 * artifact normalises it to the API's URL version instead.
 */

import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createApiApp } from "../src/routes/api";
import type { Env } from "../src/types";

/** The stable stand-in for the deploy SHA the served document carries. */
export const ARTIFACT_VERSION = "v1";

const HERE = dirname(fileURLToPath(import.meta.url));
const ARTIFACT_PATH = resolve(HERE, "../../../docs/openapi.json");

/**
 * `/v1/openapi.json` is one of the two unauthenticated paths, so generating the
 * document touches neither D1 nor KV — the bindings are present only because
 * the type demands them.
 */
function documentEnv(): Env {
  return {
    DB: undefined,
    REDIRECTS: undefined,
    ENVIRONMENT: "production",
  } as unknown as Env;
}

export async function generateDocument(): Promise<string> {
  const res = await createApiApp().request(
    "https://api.r301.dev/v1/openapi.json",
    {},
    documentEnv(),
  );

  if (res.status !== 200) {
    throw new Error(`Expected 200 from /v1/openapi.json, got ${res.status}.`);
  }

  const doc = (await res.json()) as { info: { version: string } };
  doc.info.version = ARTIFACT_VERSION;

  // Trailing newline so the file is POSIX-clean and diffs stay one-line.
  return `${JSON.stringify(doc, null, 2)}\n`;
}

async function main(): Promise<void> {
  const document = await generateDocument();
  const check = process.argv.includes("--check");

  if (!check) {
    await writeFile(ARTIFACT_PATH, document, "utf8");
    console.log(`Wrote ${ARTIFACT_PATH} (${document.length} bytes).`);
    return;
  }

  const committed = await readFile(ARTIFACT_PATH, "utf8").catch(() => null);

  if (committed === null) {
    console.error("docs/openapi.json is missing. Run: pnpm --filter @r301/api openapi");
    process.exit(1);
  }

  if (committed !== document) {
    console.error(
      "docs/openapi.json is out of date with the Zod schemas.\n"
        + "Run: pnpm --filter @r301/api openapi",
    );
    process.exit(1);
  }

  console.log("docs/openapi.json matches the generated document.");
}

await main();
