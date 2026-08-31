// D23 pinned — never weaken or delete (CLAUDE.md hard rule).
//
// PRD §12 D23 / §15: telemetry is allowlist-only. Destinations, request bodies,
// query strings and auth headers must never reach a log line. These tests are
// the enforcement — if one fails, the leak is real, not the test's fault.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logRequest, type LogFields } from "../../src/telemetry/logger";

let lines: string[];

beforeEach(() => {
  lines = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const ALLOWED: LogFields = {
  request_id: "3f6a1e0c-0000-4000-8000-000000000000",
  route: "/v1/links/:slug",
  method: "GET",
  status: 200,
  latency_ms: 12,
};

describe("allowlist logger (PRD §15)", () => {
  it("emits exactly the allowlist fields as one JSON line", () => {
    logRequest(ALLOWED);

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toEqual(ALLOWED);
  });

  it("carries the optional key_prefix and ua when supplied", () => {
    logRequest({ ...ALLOWED, key_prefix: "r301_live_abcdefghij", ua: "Mozilla/5.0" });

    expect(JSON.parse(lines[0] as string)).toEqual({
      ...ALLOWED,
      key_prefix: "r301_live_abcdefghij",
      ua: "Mozilla/5.0",
    });
  });

  // The runtime strip. A future session passing forbidden fields — through a
  // cast, a spread, or `any` — must not be able to leak them.
  it("drops every forbidden field handed to it at runtime", () => {
    const leaky = {
      ...ALLOWED,
      destination: "https://clinic.example.com/appt/9182?t=SECRET_TOKEN",
      body: { destination: "https://clinic.example.com/appt/9182" },
      query: "?t=SECRET_TOKEN",
      authorization: "Bearer r301_live_SECRETKEY",
      cookie: "session=SECRET_SESSION",
      url: "https://api.r301.dev/v1/links?cursor=SECRET_CURSOR",
    } as unknown as LogFields;

    logRequest(leaky);

    const line = lines[0] as string;
    for (const forbidden of ["destination", "body", "query", "authorization", "cookie", "url"]) {
      expect(line).not.toContain(forbidden);
    }
    for (const secret of ["SECRET_TOKEN", "SECRETKEY", "SECRET_SESSION", "SECRET_CURSOR"]) {
      expect(line).not.toContain(secret);
    }
    expect(JSON.parse(line)).toEqual(ALLOWED);
  });
});
