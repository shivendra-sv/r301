/** Worker bindings. Kept hand-written; `wrangler types` is not in the toolchain (D27). */
export interface Env {
  DB: D1Database;
  REDIRECTS: KVNamespace;
  ENVIRONMENT: string;
  /** Worker secret, set per environment (runbook A5). Absent locally. */
  SENTRY_DSN?: string;
  /** Injected by CI at deploy time (PRD §14). Absent locally. */
  GIT_SHA?: string;
}

type WorkerEnv = Env;

declare global {
  namespace Cloudflare {
    // Types `env` / `exports` from the `cloudflare:workers` module.
    interface Env extends WorkerEnv {}
    interface GlobalProps {
      mainModule: typeof import("./index");
    }
  }
}
