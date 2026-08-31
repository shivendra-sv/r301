import { describe, expect, it } from "vitest";
import {
  buildInsertSql,
  buildRevokeSql,
  mintOutput,
  parseMintArgs,
  parseRevokeArgs,
  countReturnedRows,
  wranglerArgs,
} from "../../scripts/key-admin";

const CREATED_AT = 1_756_600_000_000;

describe("mint argument parsing", () => {
  it("accepts the invocation docs/runbook.md Phase C promises", () => {
    expect(parseMintArgs(["--env", "staging", "--name", "ci-smoke"])).toEqual({
      ok: true,
      value: { target: "staging", name: "ci-smoke" },
    });
  });

  it.each(["local", "staging", "production"])("accepts --env %s", (target) => {
    const parsed = parseMintArgs(["--env", target, "--name", "k"]);

    expect(parsed.ok).toBe(true);
  });

  it.each([
    ["no arguments at all", []],
    ["a missing --name", ["--env", "staging"]],
    ["a missing --env", ["--name", "ci-smoke"]],
    ["an unknown environment", ["--env", "dev", "--name", "ci-smoke"]],
    ["an unknown flag", ["--env", "staging", "--name", "ci-smoke", "--force"]],
    ["a flag with no value", ["--env", "staging", "--name"]],
    ["an empty name", ["--env", "staging", "--name", ""]],
  ])("rejects %s with a usage message", (_case, argv) => {
    const parsed = parseMintArgs(argv);

    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.message).toContain("--env");
  });

  // The name reaches SQL as a literal, so anything exotic is refused outright
  // rather than relied on to escape correctly.
  it.each(["ci smoke", "drop';--", "naughty\"quote", "tab\there"])(
    "rejects the unsafe name %j",
    (name) => {
      expect(parseMintArgs(["--env", "staging", "--name", name]).ok).toBe(false);
    },
  );
});

describe("revoke argument parsing", () => {
  it("accepts an env and a prefix", () => {
    expect(parseRevokeArgs(["--env", "local", "--prefix", "r301_live_abcdefghij"])).toEqual({
      ok: true,
      value: { target: "local", prefix: "r301_live_abcdefghij" },
    });
  });

  it.each([
    ["a missing prefix", ["--env", "local"]],
    ["a prefix of the wrong length", ["--env", "local", "--prefix", "r301_live_abc"]],
    ["a prefix with the wrong marker", ["--env", "local", "--prefix", "r301_prod_abcdefghij"]],
    ["a prefix with unsafe characters", ["--env", "local", "--prefix", "r301_live_';--aaaaa"]],
  ])("rejects %s", (_case, argv) => {
    expect(parseRevokeArgs(argv).ok).toBe(false);
  });
});

describe("INSERT construction (PRD §7.6, D14)", () => {
  const row = {
    prefix: "r301_live_abcdefghij",
    hash: "a".repeat(64),
    name: "ci-smoke",
    createdAt: CREATED_AT,
  };

  it("carries exactly the columns the schema needs", () => {
    const sql = buildInsertSql(row);

    expect(sql).toContain("INSERT INTO api_keys");
    for (const column of ["prefix", "key_hash", "name", "environment", "created_at"]) {
      expect(sql).toContain(column);
    }
    expect(sql).toContain("'r301_live_abcdefghij'");
    expect(sql).toContain(`'${"a".repeat(64)}'`);
    expect(sql).toContain("'ci-smoke'");
    expect(sql).toContain(String(CREATED_AT));
  });

  // The whole point of D14: the secret never leaves the machine unhashed.
  it("never contains the raw key", () => {
    const sql = buildInsertSql(row);

    expect(sql).not.toContain("r301_live_abcdefghijklmnopqrstuvwxyz012345");
    expect(sql.match(/r301_live_[0-9A-Za-z]+/g)).toEqual(["r301_live_abcdefghij"]);
  });

  // v1 mints live keys only — test keys are deferred to P1 (D13).
  it("marks the key as a live key", () => {
    expect(buildInsertSql(row)).toContain("'live'");
  });
});

describe("revoke SQL", () => {
  it("revokes by prefix and only when not already revoked", () => {
    const sql = buildRevokeSql("r301_live_abcdefghij", CREATED_AT);

    expect(sql).toContain("UPDATE api_keys");
    expect(sql).toContain(`revoked_at = ${CREATED_AT}`);
    expect(sql).toContain("WHERE prefix = 'r301_live_abcdefghij'");
    expect(sql).toContain("revoked_at IS NULL");
  });

  // `wrangler d1 execute --json` reports only a duration in `meta` against a
  // local database — no `changes` — so RETURNING is how both local and remote
  // report what was actually revoked.
  it("returns the revoked prefix so rows affected can be counted", () => {
    expect(buildRevokeSql("r301_live_abcdefghij", CREATED_AT)).toContain("RETURNING prefix");
  });
});

describe("counting rows from wrangler --json output", () => {
  function output(results: unknown[]): string {
    return JSON.stringify([{ results, success: true, meta: { duration: 0 } }]);
  }

  it("counts a revoked row", () => {
    expect(countReturnedRows(output([{ prefix: "r301_live_abcdefghij" }]))).toBe(1);
  });

  it("counts nothing when no row matched", () => {
    expect(countReturnedRows(output([]))).toBe(0);
  });

  // wrangler prints human-readable banners before the JSON on some paths.
  it("finds the JSON even when preceded by other output", () => {
    const noisy = `⛅️ wrangler 4.127.1\n---\n${output([{ prefix: "x" }])}`;

    expect(countReturnedRows(noisy)).toBe(1);
  });

  it("returns null when the output cannot be parsed", () => {
    expect(countReturnedRows("something went wrong")).toBeNull();
  });
});

describe("wrangler invocation", () => {
  it("asks for machine-readable output", () => {
    expect(wranglerArgs("local", "SELECT 1")).toContain("--json");
  });

  it("targets the remote database for a deployed environment", () => {
    const args = wranglerArgs("staging", "SELECT 1");

    expect(args).toContain("--env");
    expect(args).toContain("staging");
    expect(args).toContain("--remote");
    expect(args).not.toContain("--local");
  });

  // `local` maps to the top-level binding, not a deployed env.
  it("targets the local database without an --env flag", () => {
    const args = wranglerArgs("local", "SELECT 1");

    expect(args).toContain("--local");
    expect(args).not.toContain("--remote");
    expect(args).not.toContain("--env");
  });
});

describe("mint output (PRD §7.6 — shown once)", () => {
  const key = `r301_live_${"z".repeat(32)}`;
  const output = mintOutput(key, "r301_live_zzzzzzzzzz");

  it("prints the secret exactly once", () => {
    expect(output.split(key)).toHaveLength(2);
  });

  it("warns that the secret is shown only this once", () => {
    expect(output.toLowerCase()).toContain("once");
  });

  it("echoes the prefix so the key can be revoked later", () => {
    expect(output).toContain("r301_live_zzzzzzzzzz");
  });
});
