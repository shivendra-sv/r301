import { describe, expect, it } from "vitest";
import {
  assertCreatedLink,
  assertLinkMatches,
  assertNoContent,
  assertNotFound,
  assertRedirect,
  assertStats,
  assertHealth,
  MAX_SMOKE_REQUESTS,
  readSmokeConfig,
  runSmoke,
  SMOKE_TAG,
} from "../../scripts/smoke-checks";

const API = "https://api-staging.r301.dev";
const REDIRECT = "https://staging.r301.dev";
const KEY = "r301_live_0123456789abcdefghijklmnop";
const SLUG = "aB3xY7z";
const DESTINATION = "https://example.com/";

interface Call {
  url: string;
  method: string;
  init: RequestInit | undefined;
}

/** A fetch stub that records every call and answers from a routing table. */
function stubFetch(route: (call: Call, nth: number) => Response | Promise<Response>): {
  fetchImpl: typeof globalThis.fetch;
  calls: Call[];
} {
  const calls: Call[] = [];

  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const call: Call = { url, method: init?.method ?? "GET", init };
    calls.push(call);

    return route(call, calls.length - 1);
  }) as unknown as typeof globalThis.fetch;

  return { fetchImpl, calls };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const LINK = {
  slug: SLUG,
  short_url: `${REDIRECT}/${SLUG}`,
  destination: DESTINATION,
  redirect_type: 302,
  is_active: true,
  expires_at: null,
  tags: [SMOKE_TAG],
  external_id: null,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
};

/** The happy path every test starts from, then perturbs. */
function healthyRoute(call: Call): Response {
  const { url, method } = call;

  if (url === `${API}/v1/health`) return json({ status: "ok", version: "abc", env: "staging" });
  if (url === `${API}/v1/links` && method === "POST") return json(LINK, 201);
  if (url === `${API}/v1/links/${SLUG}` && method === "GET") return json(LINK);
  if (url === `${API}/v1/links/${SLUG}/stats`) {
    return json({ slug: SLUG, click_count: 0, last_clicked_at: null, created_at: LINK.created_at });
  }
  if (url === `${API}/v1/links/${SLUG}` && method === "DELETE") return new Response(null, { status: 204 });

  throw new Error(`unrouted ${method} ${url}`);
}

/** The redirect host answers 302 before the delete and 404 after it. */
function fullRoute(deleted: { yes: boolean }): (call: Call) => Response {
  return (call) => {
    if (call.url === `${REDIRECT}/${SLUG}`) {
      return deleted.yes
        ? new Response(null, { status: 404 })
        : new Response(null, { status: 302, headers: { Location: DESTINATION } });
    }

    const res = healthyRoute(call);
    if (call.method === "DELETE") deleted.yes = true;

    return res;
  };
}

function config(fetchImpl: typeof globalThis.fetch) {
  return { apiBase: API, redirectBase: REDIRECT, apiKey: KEY, fetchImpl };
}

describe("smoke config (runbook Phase C)", () => {
  const complete = {
    SMOKE_API_BASE: API,
    SMOKE_REDIRECT_BASE: REDIRECT,
    SMOKE_API_KEY: KEY,
  };

  it("accepts a complete environment", () => {
    const result = readSmokeConfig(complete);

    expect(result).toEqual({
      ok: true,
      config: { apiBase: API, redirectBase: REDIRECT, apiKey: KEY },
    });
  });

  it("trims a trailing slash off both bases, so URLs never double up", () => {
    const result = readSmokeConfig({
      ...complete,
      SMOKE_API_BASE: `${API}/`,
      SMOKE_REDIRECT_BASE: `${REDIRECT}/`,
    });

    expect(result.ok && result.config).toEqual({
      apiBase: API,
      redirectBase: REDIRECT,
      apiKey: KEY,
    });
  });

  // The key is the one variable a human has to mint by hand, so its absence
  // gets the runbook pointer rather than a bare "missing variable".
  it("points a missing key at runbook Phase C by name", () => {
    const result = readSmokeConfig({ ...complete, SMOKE_API_KEY: undefined });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("SMOKE_API_KEY");
    expect(result.ok === false && result.message).toContain("Phase C");
    expect(result.ok === false && result.message).toContain("mint-key");
  });

  it("treats an empty key as missing", () => {
    expect(readSmokeConfig({ ...complete, SMOKE_API_KEY: "" }).ok).toBe(false);
  });

  it.each(["SMOKE_API_BASE", "SMOKE_REDIRECT_BASE"])("requires %s", (name) => {
    const result = readSmokeConfig({ ...complete, [name]: undefined });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain(name);
  });

  it("names every missing variable at once, not just the first", () => {
    const result = readSmokeConfig({});

    expect(result.ok).toBe(false);
    for (const name of ["SMOKE_API_BASE", "SMOKE_REDIRECT_BASE", "SMOKE_API_KEY"]) {
      expect(result.ok === false && result.message).toContain(name);
    }
  });
});

describe("step asserters (docs/testing.md §5)", () => {
  it("passes a healthy health check and fails a degraded one", () => {
    expect(assertHealth(200, { status: "ok" })).toEqual([]);
    expect(assertHealth(200, { status: "degraded" })[0]).toContain("degraded");
    expect(assertHealth(503, undefined)[0]).toContain("503");
  });

  it("requires 201 and a usable link body from create", () => {
    expect(assertCreatedLink(201, LINK)).toEqual([]);
    expect(assertCreatedLink(200, LINK)[0]).toContain("200");
    expect(assertCreatedLink(201, { ...LINK, slug: undefined })[0]).toContain("slug");
    expect(assertCreatedLink(201, { ...LINK, destination: undefined })[0]).toContain("destination");
  });

  it("requires the created link to carry the smoke tag", () => {
    expect(assertCreatedLink(201, { ...LINK, tags: [] })[0]).toContain(SMOKE_TAG);
  });

  it("requires the fetched link to be the one just created", () => {
    expect(assertLinkMatches(200, LINK, SLUG)).toEqual([]);
    expect(assertLinkMatches(200, { ...LINK, slug: "other" }, SLUG)[0]).toContain("other");
    expect(assertLinkMatches(404, undefined, SLUG)[0]).toContain("404");
  });

  it("requires a 302 to the exact destination", () => {
    expect(assertRedirect(302, DESTINATION, DESTINATION)).toEqual([]);
    expect(assertRedirect(301, DESTINATION, DESTINATION)[0]).toContain("301");
    expect(assertRedirect(302, "https://evil.example/", DESTINATION)[0]).toContain("evil");
    expect(assertRedirect(302, null, DESTINATION)[0]).toContain("Location");
  });

  // PRD §7.4: counting is asynchronous and best-effort, so the count itself is
  // deliberately not asserted — only that the endpoint answers in shape.
  it("checks the stats shape without asserting a count", () => {
    expect(assertStats(200, { slug: SLUG, click_count: 0, last_clicked_at: null }, SLUG)).toEqual(
      [],
    );
    expect(assertStats(200, { slug: SLUG, click_count: 999, last_clicked_at: null }, SLUG)).toEqual(
      [],
    );
    expect(assertStats(200, { slug: SLUG }, SLUG)[0]).toContain("click_count");
    expect(assertStats(404, undefined, SLUG)[0]).toContain("404");
  });

  it("requires 204 from the delete and 404 from the redirect afterwards", () => {
    expect(assertNoContent(204)).toEqual([]);
    expect(assertNoContent(200)[0]).toContain("200");
    expect(assertNotFound(404)).toEqual([]);
    expect(assertNotFound(302)[0]).toContain("302");
  });
});

describe("the full sequence (docs/testing.md §5)", () => {
  it("passes end to end and summarizes in one line", async () => {
    const { fetchImpl } = stubFetch(fullRoute({ yes: false }));

    const result = await runSmoke(config(fetchImpl));

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.summary).not.toContain("\n");
    expect(result.summary).toContain(SLUG);
  });

  it("runs the seven steps in the order the spec fixes", async () => {
    const { fetchImpl, calls } = stubFetch(fullRoute({ yes: false }));

    await runSmoke(config(fetchImpl));

    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `GET ${API}/v1/health`,
      `POST ${API}/v1/links`,
      `GET ${API}/v1/links/${SLUG}`,
      `GET ${REDIRECT}/${SLUG}`,
      `GET ${API}/v1/links/${SLUG}/stats`,
      `DELETE ${API}/v1/links/${SLUG}`,
      `GET ${REDIRECT}/${SLUG}`,
    ]);
  });

  // D25: the free tier's quotas are shared with production, so the sequence has
  // a request budget and this is what holds it to it.
  it("stays inside the request budget", async () => {
    const { fetchImpl, calls } = stubFetch(fullRoute({ yes: false }));

    await runSmoke(config(fetchImpl));

    expect(calls.length).toBeLessThanOrEqual(MAX_SMOKE_REQUESTS);
  });

  it("sends the API key on the API calls and never to the redirect host", async () => {
    const { fetchImpl, calls } = stubFetch(fullRoute({ yes: false }));

    await runSmoke(config(fetchImpl));

    for (const call of calls) {
      const auth = new Headers(call.init?.headers).get("Authorization");

      if (call.url.startsWith(REDIRECT)) {
        expect(auth).toBeNull();
      } else if (call.url !== `${API}/v1/health`) {
        expect(auth).toBe(`Bearer ${KEY}`);
      }
    }
  });

  it("follows no redirects when checking the redirect", async () => {
    const { fetchImpl, calls } = stubFetch(fullRoute({ yes: false }));

    await runSmoke(config(fetchImpl));

    const redirectCalls = calls.filter((call) => call.url.startsWith(REDIRECT));

    expect(redirectCalls).toHaveLength(2);
    for (const call of redirectCalls) {
      expect(call.init?.redirect).toBe("manual");
    }
  });

  it("creates the link with the smoke tag and the spec's destination", async () => {
    const { fetchImpl, calls } = stubFetch(fullRoute({ yes: false }));

    await runSmoke(config(fetchImpl));

    const body = JSON.parse(String(calls[1]?.init?.body)) as {
      destination: string;
      tags: string[];
    };

    expect(body.tags).toEqual([SMOKE_TAG]);
    expect(body.destination).toBe("https://example.com");
  });

  it("names the failing step and exits unhappy when one step misbehaves", async () => {
    const { fetchImpl } = stubFetch((call) => {
      if (call.url === `${API}/v1/links/${SLUG}/stats`) return json({ nope: true }, 500);
      return fullRoute({ yes: false })(call);
    });

    const result = await runSmoke(config(fetchImpl));

    expect(result.ok).toBe(false);
    expect(result.failures.join("\n")).toContain("stats");
    expect(result.failures.join("\n")).toContain("500");
  });

  // Behaviour 4: the link must not survive a failed run — a staging database
  // slowly filling with smoke links is a leak CI would never report.
  it("still deletes the link when an earlier step fails", async () => {
    const { fetchImpl, calls } = stubFetch((call) => {
      if (call.url === `${REDIRECT}/${SLUG}` && call.method === "GET") {
        return new Response(null, { status: 500 });
      }
      return healthyRoute(call);
    });

    const result = await runSmoke(config(fetchImpl));

    expect(result.ok).toBe(false);
    expect(calls.some((call) => call.method === "DELETE")).toBe(true);
  });

  it("still deletes the link when a step's request rejects outright", async () => {
    const { fetchImpl, calls } = stubFetch((call) => {
      if (call.url === `${API}/v1/links/${SLUG}/stats`) {
        return Promise.reject(new Error("ECONNRESET"));
      }
      return healthyRoute(call);
    });

    const result = await runSmoke(config(fetchImpl));

    expect(result.ok).toBe(false);
    expect(result.failures.join("\n")).toContain("ECONNRESET");
    expect(calls.some((call) => call.method === "DELETE")).toBe(true);
  });

  it("skips the dependent steps when create fails, since there is no slug", async () => {
    const { fetchImpl, calls } = stubFetch((call) => {
      if (call.url === `${API}/v1/links` && call.method === "POST") {
        return json({ error: { code: "unauthorized" } }, 401);
      }
      return healthyRoute(call);
    });

    const result = await runSmoke(config(fetchImpl));

    expect(result.ok).toBe(false);
    expect(calls.map((call) => call.method)).toEqual(["GET", "POST"]);
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it("fails rather than throws when the API is unreachable", async () => {
    const { fetchImpl } = stubFetch(() => Promise.reject(new Error("ECONNREFUSED")));

    const result = await runSmoke(config(fetchImpl));

    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain("ECONNREFUSED");
  });

  it("fails rather than throws when a body is not JSON", async () => {
    const { fetchImpl } = stubFetch((call) =>
      call.url === `${API}/v1/health`
        ? new Response("<html>nope</html>", { status: 200 })
        : healthyRoute(call),
    );

    const result = await runSmoke(config(fetchImpl));

    expect(result.ok).toBe(false);
  });
});
