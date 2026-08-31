// Smoke entry point (docs/testing.md §5). Runs under tsx in Node, not in the
// Worker: `pnpm --filter @r301/api smoke`, driven by env vars, exits non-zero
// on any failed check so CI fails the deploy.

import { runSmoke } from "./smoke-checks";

// `@cloudflare/workers-types` declares `process` as `any`, so without this the
// reads below would be untyped and a misspelled variable name would pass
// `tsc` silently. Narrowed once, here, rather than trusted everywhere.
// @types/node (ADR D28) replaces this — see PROGRESS.md open question 9.
const nodeProcess = process as {
  env: Record<string, string | undefined>;
  exit: (code: number) => never;
};

const apiBase = nodeProcess.env.SMOKE_API_BASE ?? "";

if (apiBase === "") {
  console.error("SMOKE_API_BASE is required (e.g. https://api-staging.r301.dev)");
  nodeProcess.exit(1);
}

const result = await runSmoke({ apiBase });

for (const failure of result.failures) {
  console.error(`FAIL ${failure}`);
}

if (result.ok) {
  console.log(`smoke ok — ${apiBase}/v1/health`);
}

nodeProcess.exit(result.ok ? 0 : 1);
