import { createApiApp } from "./routes/api";
import { createRedirectApp } from "./routes/redirect";
import type { Env } from "./types";

const apiApp = createApiApp();
const redirectApp = createRedirectApp();

/** Hostnames that serve `/v1/*` only (design.md §1). */
const API_HOSTS = new Set(["api.r301.dev", "api-staging.r301.dev"]);

/** Hostnames that serve slugs and housekeeping routes only (design.md §1). */
const REDIRECT_HOSTS = new Set(["r301.dev", "staging.r301.dev"]);

/**
 * Surface routing is by hostname (design.md §1). Anywhere else — local dev,
 * tests — both surfaces are reachable: `/v1` is reserved and slugs are
 * single-segment, so the two can never collide.
 */
function isApiRequest(hostname: string, pathname: string): boolean {
  if (API_HOSTS.has(hostname)) {
    return true;
  }
  if (REDIRECT_HOSTS.has(hostname)) {
    return false;
  }

  return pathname === "/v1" || pathname.startsWith("/v1/");
}

export default {
  fetch(request, env, ctx) {
    const url = new URL(request.url);
    const app = isApiRequest(url.hostname, url.pathname) ? apiApp : redirectApp;

    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
