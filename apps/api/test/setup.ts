import { applyD1Migrations, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach } from "vitest";

// Migrations run per-test, not once per file: reset() below clears the
// bookkeeping table along with everything else, so the chain is re-applied
// from zero for every test (docs/testing.md §2, PRD §14).
beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

// Per-test storage isolation (docs/testing.md §2). The pool's declarative
// `isolatedStorage` option no longer exists as of v0.22 — reset() is the
// current mechanism, and it clears every attached binding (D1 + KV).
afterEach(async () => {
  await reset();
});
