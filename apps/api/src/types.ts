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

/** The verified caller, attached by the auth middleware (D12: attribution only). */
export interface ApiKeyContext {
  id: number;
  environment: string;
  /** The 20-char lookup prefix — the only part of a key that may be logged. */
  prefix: string;
}

/** Hono generics shared by every app in this Worker. */
export interface AppEnv {
  Bindings: Env;
  Variables: {
    /** Set by the request-id middleware; echoed in headers and error envelopes. */
    requestId: string;
    /**
     * Set by the auth middleware once a key is verified. Absent on the exempt
     * routes (`/v1/health`, `/v1/openapi.json`), so read it as possibly unset.
     */
    key: ApiKeyContext | undefined;
  };
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
