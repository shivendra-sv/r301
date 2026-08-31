import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Relative to this package's directory, which is the cwd for every `test`
// script in package.json. Kept free of `node:*` imports so the config
// typechecks without @types/node, which is not in the approved set (D27).
const MIGRATIONS_DIR = "migrations";

// Read at config time (Node side) and handed to the Worker as a binding; the
// setup file applies them inside workerd. Ordered by migration number.
const migrations = await readD1Migrations(MIGRATIONS_DIR);

// Bindings, compatibility date/flags and `main` all come from wrangler.toml's
// top-level (local) config — tests touch zero Cloudflare resources (PRD D25).
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
    }),
  ],
  test: {
    setupFiles: ["./test/setup.ts"],
  },
});
