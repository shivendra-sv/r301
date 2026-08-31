/// <reference types="@cloudflare/vitest-pool-workers/types" />

import type { D1Migration } from "@cloudflare/vitest-pool-workers";

declare global {
  namespace Cloudflare {
    interface Env {
      /** Test-only binding, injected by vitest.config.ts (not a Worker binding). */
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
