// Smoke entry point (docs/testing.md §5). Runs under tsx in Node, not in the
// Worker: `pnpm --filter @r301/api smoke`, driven by env vars, exits non-zero
// on any failed check so CI fails the deploy.
//
// Deliberately thin — the sequence, the assertions and the cleanup all live in
// smoke-checks.ts, which the Worker test pool imports and covers. This file
// only translates the environment in and an exit code out.

import { readSmokeConfig, runSmoke } from "./smoke-checks";

// `@cloudflare/workers-types` declares `process` as `any`, so without this the
// reads below would be untyped and a misspelled variable name would pass
// `tsc` silently. Narrowed once, here, rather than trusted everywhere.
// @types/node (ADR D28) replaces this — see PROGRESS.md open question 9.
interface NodeProcess {
  env: Record<string, string | undefined>;
  exit: (code: number) => never;
}

// Annotated, not just asserted: TypeScript only narrows past a never-returning
// call when the callee's declaration carries an explicit type annotation, and
// the `parsed.ok` check below depends on that narrowing.
const nodeProcess: NodeProcess = process as NodeProcess;

const parsed = readSmokeConfig(nodeProcess.env);

if (!parsed.ok) {
  console.error(parsed.message);
  nodeProcess.exit(1);
}

const result = await runSmoke(parsed.config);

for (const failure of result.failures) {
  console.error(`FAIL ${failure}`);
}

console.log(result.summary);

nodeProcess.exit(result.ok ? 0 : 1);
