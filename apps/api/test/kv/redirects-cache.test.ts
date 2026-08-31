import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { LinkRow } from "../../src/db/types";
import { putRedirect, redirectEntryFor, removeRedirect } from "../../src/kv/redirects-cache";

function row(overrides: Partial<LinkRow> = {}): LinkRow {
  return {
    id: 1,
    slug: "launch",
    destination: "https://example.com/",
    redirect_type: 302,
    is_active: 1,
    expires_at: null,
    deleted_at: null,
    external_id: null,
    click_count: 0,
    last_clicked_at: null,
    created_by_key_id: 1,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}

async function stored(slug: string): Promise<unknown> {
  return env.REDIRECTS.get(slug, "json");
}

// design §3 / PRD §9: the value is exactly {d,t,x,a} — the hot path parses it
// on every redirect, so extra keys are pure per-request cost.
describe("REDIRECTS cache contract (D20, design §3)", () => {
  it("builds the four-key entry from a row", () => {
    expect(redirectEntryFor(row())).toEqual({ d: "https://example.com/", t: 302, x: null, a: 1 });
  });

  it("carries expiry as epoch ms", () => {
    expect(redirectEntryFor(row({ expires_at: 1_788_177_600_000 })).x).toBe(1_788_177_600_000);
  });

  it("carries is_active as 1 or 0, not a boolean", () => {
    expect(redirectEntryFor(row({ is_active: 1 })).a).toBe(1);
    expect(redirectEntryFor(row({ is_active: 0 })).a).toBe(0);
  });

  it("never carries anything beyond d, t, x and a", () => {
    const entry = redirectEntryFor(row({ external_id: "appt_1", click_count: 940 }));

    expect(Object.keys(entry).sort()).toEqual(["a", "d", "t", "x"]);
  });

  it("writes the entry under the slug", async () => {
    await putRedirect(env.REDIRECTS, "launch", redirectEntryFor(row()));

    expect(await stored("launch")).toEqual({ d: "https://example.com/", t: 302, x: null, a: 1 });
  });

  it("overwrites an existing entry", async () => {
    await putRedirect(env.REDIRECTS, "launch", redirectEntryFor(row()));
    await putRedirect(
      env.REDIRECTS,
      "launch",
      redirectEntryFor(row({ destination: "https://new.example.com/", is_active: 0 })),
    );

    expect(await stored("launch")).toEqual({
      d: "https://new.example.com/",
      t: 302,
      x: null,
      a: 0,
    });
  });

  it("removes an entry", async () => {
    await putRedirect(env.REDIRECTS, "launch", redirectEntryFor(row()));
    await removeRedirect(env.REDIRECTS, "launch");

    expect(await stored("launch")).toBeNull();
  });

  it("removing an absent entry is not an error", async () => {
    await expect(removeRedirect(env.REDIRECTS, "never-existed")).resolves.toBeUndefined();
  });
});
