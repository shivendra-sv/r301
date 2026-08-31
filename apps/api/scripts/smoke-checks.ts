// Smoke checks, kept free of `node:*` so the Worker test pool can import them.
// The Node entry point that reads env vars and sets an exit code is smoke.ts.

export interface SmokeOptions {
  /** Origin of the API surface, e.g. https://api-staging.r301.dev */
  apiBase: string;
  fetchImpl?: typeof globalThis.fetch;
}

export interface SmokeResult {
  ok: boolean;
  /** One human-readable line per failed check; empty when everything passed. */
  failures: string[];
}

interface HealthBody {
  status?: unknown;
}

/**
 * Smoke v1 (docs/testing.md §5, step 1): health only. Deliberately requires no
 * API key — it must be runnable before runbook Phase C mints one. Prompt 20
 * adds the authenticated create → redirect → stats → delete sequence.
 *
 * Never throws: a transport failure is a failed check, not a crash, so CI gets
 * the reason instead of a stack trace.
 */
export async function runSmoke(options: SmokeOptions): Promise<SmokeResult> {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const url = `${options.apiBase.replace(/\/$/, "")}/v1/health`;
  const failures: string[] = [];

  try {
    const res = await doFetch(url);

    if (res.status !== 200) {
      failures.push(`GET /v1/health returned ${res.status}, expected 200 (${url})`);
    } else {
      const body = (await res.json()) as HealthBody;

      if (body.status !== "ok") {
        failures.push(
          `GET /v1/health reported status ${JSON.stringify(body.status)}, expected "ok" (${url})`,
        );
      }
    }
  } catch (err) {
    failures.push(`GET /v1/health could not be checked: ${String(err)} (${url})`);
  }

  return { ok: failures.length === 0, failures };
}
