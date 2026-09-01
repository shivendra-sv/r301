// The smoke sequence (docs/testing.md §5), kept free of `node:*` so the Worker
// test pool can import it. The Node entry point that reads env vars and sets an
// exit code is smoke.ts — everything testable lives here.
//
// Shape: pure asserters (status + body → failure lines) plus one orchestrator
// that owns the ordering and the cleanup. Nothing throws; a transport failure
// is a failed check, so CI gets the reason rather than a stack trace.

/** PRD §7.3: the tag every smoke link carries, so stray ones are findable. */
export const SMOKE_TAG = "smoke";

/** docs/testing.md §5 destination — a stable third party, never our own host. */
export const SMOKE_DESTINATION = "https://example.com";

/**
 * D25 quota discipline: the free tier's limits are shared with production, so
 * the sequence is budgeted. Seven steps, one request each.
 */
export const MAX_SMOKE_REQUESTS = 8;

export interface SmokeConfig {
  /** Origin of the API surface, e.g. https://api-staging.r301.dev */
  apiBase: string;
  /** Origin short links resolve on, e.g. https://staging.r301.dev */
  redirectBase: string;
  apiKey: string;
  fetchImpl?: typeof globalThis.fetch;
}

export interface SmokeResult {
  ok: boolean;
  /** One human-readable line per failed check; empty when everything passed. */
  failures: string[];
  /** Single line, safe to print on success or failure. */
  summary: string;
}

export type ConfigResult =
  | { ok: true; config: { apiBase: string; redirectBase: string; apiKey: string } }
  | { ok: false; message: string };

/**
 * Every variable is reported at once rather than one per run: a CI operator
 * fixing these is editing secrets, and three round trips to learn three names
 * is three deploys. The key gets the runbook pointer because it is the one a
 * human has to mint by hand — the bases are already in the workflow files.
 */
export function readSmokeConfig(env: Record<string, string | undefined>): ConfigResult {
  const apiBase = (env["SMOKE_API_BASE"] ?? "").replace(/\/$/, "");
  const redirectBase = (env["SMOKE_REDIRECT_BASE"] ?? "").replace(/\/$/, "");
  const apiKey = env["SMOKE_API_KEY"] ?? "";
  const missing: string[] = [];

  if (apiBase === "") missing.push("SMOKE_API_BASE (e.g. https://api-staging.r301.dev)");
  if (redirectBase === "") missing.push("SMOKE_REDIRECT_BASE (e.g. https://staging.r301.dev)");
  if (apiKey === "") {
    missing.push(
      "SMOKE_API_KEY — mint one with `pnpm mint-key --env <env> --name ci-smoke` and store it as " +
        "the SMOKE_API_KEY_STAGING / SMOKE_API_KEY_PRODUCTION Actions secret (docs/runbook.md Phase C)",
    );
  }

  if (missing.length > 0) {
    return { ok: false, message: `smoke cannot run — missing:\n  - ${missing.join("\n  - ")}` };
  }

  return { ok: true, config: { apiBase, redirectBase, apiKey } };
}

function fieldOf(body: unknown, name: string): unknown {
  return typeof body === "object" && body !== null
    ? (body as Record<string, unknown>)[name]
    : undefined;
}

function wrongStatus(step: string, actual: number, expected: number): string {
  return `${step}: returned ${actual}, expected ${expected}`;
}

export function assertHealth(status: number, body: unknown): string[] {
  if (status !== 200) return [wrongStatus("GET /v1/health", status, 200)];

  const reported = fieldOf(body, "status");

  return reported === "ok"
    ? []
    : [`GET /v1/health: reported status ${JSON.stringify(reported)}, expected "ok"`];
}

export function assertCreatedLink(status: number, body: unknown): string[] {
  if (status !== 201) return [wrongStatus("POST /v1/links", status, 201)];

  const failures: string[] = [];
  const slug = fieldOf(body, "slug");
  const destination = fieldOf(body, "destination");
  const tags = fieldOf(body, "tags");

  if (typeof slug !== "string" || slug === "") {
    failures.push("POST /v1/links: response carried no usable slug");
  }
  if (typeof destination !== "string" || destination === "") {
    failures.push("POST /v1/links: response carried no destination");
  }
  if (!Array.isArray(tags) || !tags.includes(SMOKE_TAG)) {
    failures.push(`POST /v1/links: response tags ${JSON.stringify(tags)} omit "${SMOKE_TAG}"`);
  }

  return failures;
}

export function assertLinkMatches(status: number, body: unknown, slug: string): string[] {
  if (status !== 200) return [wrongStatus(`GET /v1/links/${slug}`, status, 200)];

  const found = fieldOf(body, "slug");

  return found === slug
    ? []
    : [`GET /v1/links/${slug}: returned slug ${JSON.stringify(found)}, expected ${slug}`];
}

/**
 * The check that proves the whole write path landed: D1 committed, the KV
 * write-through happened, and the edge resolves it. `redirect: "manual"` is
 * what makes the 302 observable — following it would assert example.com's
 * health instead of ours.
 */
export function assertRedirect(
  status: number,
  location: string | null,
  destination: string,
): string[] {
  if (status !== 302) return [wrongStatus("GET {redirect}/{slug}", status, 302)];

  if (location === null) {
    return ["GET {redirect}/{slug}: 302 carried no Location header"];
  }

  return location === destination
    ? []
    : [`GET {redirect}/{slug}: Location was ${location}, expected ${destination}`];
}

/**
 * Shape only — no count assertion. Counting is asynchronous and best-effort
 * (PRD §7.4), so asserting "1 click" here would make the deploy gate flaky by
 * design rather than catching anything real.
 */
export function assertStats(status: number, body: unknown, slug: string): string[] {
  if (status !== 200) return [wrongStatus(`GET /v1/links/${slug}/stats`, status, 200)];

  const failures: string[] = [];

  if (fieldOf(body, "slug") !== slug) {
    failures.push(`GET /v1/links/${slug}/stats: reported a different slug`);
  }
  if (typeof fieldOf(body, "click_count") !== "number") {
    failures.push(`GET /v1/links/${slug}/stats: click_count missing or not a number`);
  }

  return failures;
}

export function assertNoContent(status: number): string[] {
  return status === 204 ? [] : [wrongStatus("DELETE /v1/links/{slug}", status, 204)];
}

export function assertNotFound(status: number): string[] {
  return status === 404
    ? []
    : [wrongStatus("GET {redirect}/{slug} after delete", status, 404)];
}

interface Fetched {
  status: number;
  body: unknown;
  location: string | null;
}

/**
 * One request, reduced to what the asserters need. A non-JSON body is left as
 * `undefined` rather than raised: the asserter that wanted a field will say
 * which field was missing, which reads better than a parse error.
 */
async function fetchStep(
  doFetch: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
): Promise<Fetched> {
  const res = await doFetch(url, init);
  let body: unknown;

  try {
    body = res.status === 204 ? undefined : await res.json();
  } catch {
    body = undefined;
  }

  return { status: res.status, body, location: res.headers.get("Location") };
}

export async function runSmoke(config: SmokeConfig): Promise<SmokeResult> {
  const doFetch = config.fetchImpl ?? globalThis.fetch;
  const apiBase = config.apiBase.replace(/\/$/, "");
  const redirectBase = config.redirectBase.replace(/\/$/, "");
  const authed: RequestInit = { headers: { Authorization: `Bearer ${config.apiKey}` } };
  const failures: string[] = [];

  /** Runs one step, turning a transport failure into that step's failure. */
  async function step(
    name: string,
    url: string,
    init: RequestInit,
    check: (res: Fetched) => string[],
  ): Promise<Fetched | null> {
    try {
      const res = await fetchStep(doFetch, url, init);
      failures.push(...check(res));

      return res;
    } catch (err) {
      failures.push(`${name}: request failed — ${String(err)}`);

      return null;
    }
  }

  // 1. Health. Unauthenticated on purpose: it is the one step that still works
  //    when the key is the thing that is broken.
  await step("health", `${apiBase}/v1/health`, {}, (res) => assertHealth(res.status, res.body));

  // 2. Create.
  const created = await step(
    "create",
    `${apiBase}/v1/links`,
    {
      ...authed,
      method: "POST",
      headers: { ...authed.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ destination: SMOKE_DESTINATION, tags: [SMOKE_TAG] }),
    },
    (res) => assertCreatedLink(res.status, res.body),
  );

  const slug = fieldOf(created?.body, "slug");
  // The destination is read back rather than assumed: the API may normalise
  // what it stored (a bare origin gains its trailing slash), and the redirect
  // must match what the API says the link points at, not what we typed.
  const destination = fieldOf(created?.body, "destination");

  if (typeof slug !== "string" || slug === "") {
    return {
      ok: false,
      failures,
      summary: `smoke FAILED — ${failures.length} check(s) failed before a link existed`,
    };
  }

  try {
    // 3. Fetch it back.
    await step("fetch", `${apiBase}/v1/links/${slug}`, authed, (res) =>
      assertLinkMatches(res.status, res.body, slug),
    );

    // 4. Redirect, unfollowed, on the redirect host — no API key goes here.
    await step("redirect", `${redirectBase}/${slug}`, { redirect: "manual" }, (res) =>
      assertRedirect(res.status, res.location, typeof destination === "string" ? destination : ""),
    );

    // 5. Stats.
    await step("stats", `${apiBase}/v1/links/${slug}/stats`, authed, (res) =>
      assertStats(res.status, res.body, slug),
    );
  } finally {
    // 6 + 7. Cleanup is also the last two assertions.
    //
    // `finally` is defence in depth, and honestly so: `step` already contains
    // every transport and parse failure, so nothing above can currently throw
    // past it — a mutation moving these two calls into the `try` passes the
    // suite. It stays because the guarantee we want is structural ("the link is
    // deleted however the block exits"), and the day someone adds a line to the
    // block that *can* throw, this is what stops staging filling with smoke
    // links. See PROGRESS.md prompt 20 notes.
    await step("delete", `${apiBase}/v1/links/${slug}`, { ...authed, method: "DELETE" }, (res) =>
      assertNoContent(res.status),
    );

    await step("redirect-after-delete", `${redirectBase}/${slug}`, { redirect: "manual" }, (res) =>
      assertNotFound(res.status),
    );
  }

  const ok = failures.length === 0;

  return {
    ok,
    failures,
    summary: ok
      ? `smoke ok — 7 steps against ${apiBase} and ${redirectBase} (link ${slug} created and deleted)`
      : `smoke FAILED — ${failures.length} of 7 steps failed (link ${slug})`,
  };
}
