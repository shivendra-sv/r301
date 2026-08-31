import { env as testEnv } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { BOT_DENYLIST } from "../../src/bot-denylist";
import { recordClick, shouldCount } from "../../src/services/counting";
import { seedApiKey } from "../helpers/auth";

const BROWSER_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

/** The probe hits the canary slug every 60 s; its counts are the drift meter. */
const UPTIME_ROBOT_UA = "Mozilla/5.0+(compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)";

describe("shouldCount (PRD §7.4, D21)", () => {
  it("counts a GET from a normal browser", () => {
    expect(shouldCount("GET", BROWSER_UA)).toBe(true);
  });

  // PRD §7.4: HEAD serves the redirect but never counts.
  it.each([BROWSER_UA, null, "curl/8.7.1"])("never counts a HEAD (ua: %s)", (ua) => {
    expect(shouldCount("HEAD", ua)).toBe(false);
  });

  // Pilot channels are SMS + WhatsApp + email — every one of them prefetches.
  it.each([
    ["a WhatsApp preview", "WhatsApp/2.24.10.75 A"],
    [
      "the Facebook scraper",
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    ],
    ["Googlebot", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"],
    ["curl", "curl/8.7.1"],
    ["Outlook SafeLinks", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SafeLinks"],
  ])("does not count a GET from %s", (_name, ua) => {
    expect(shouldCount("GET", ua)).toBe(false);
  });

  it("matches the denylist case-insensitively", () => {
    expect(shouldCount("GET", "CURL/8.7.1")).toBe(false);
    expect(shouldCount("GET", "FacebookExternalHit/1.1")).toBe(false);
  });

  // Absence is not proof of a bot, and a real click must not be dropped for it.
  it("counts a GET with no User-Agent header", () => {
    expect(shouldCount("GET", null)).toBe(true);
  });

  // D21: the probe is the ruler the drift is measured against, so it must count.
  it("counts the uptime probe, deliberately absent from the denylist", () => {
    expect(shouldCount("GET", UPTIME_ROBOT_UA)).toBe(true);
  });

  // Matching lowercases the UA, so a capitalised entry could never fire.
  it("keeps every denylist entry lowercase", () => {
    expect(BOT_DENYLIST.filter((entry) => entry !== entry.toLowerCase())).toEqual([]);
  });
});

describe("recordClick (PRD §7.4)", () => {
  const NOW = 1_735_000_000_000;

  async function seedLink(overrides: { clickCount?: number; deletedAt?: number | null } = {}) {
    const { id } = await seedApiKey();
    await testEnv.DB.prepare(
      `INSERT INTO links (slug, destination, redirect_type, click_count, deleted_at,
         created_by_key_id, created_at, updated_at)
       VALUES ('abc123', 'https://clinic.example.com/a', 302, ?1, ?2, ?3, 0, 0)`,
    )
      .bind(overrides.clickCount ?? 0, overrides.deletedAt ?? null, id)
      .run();
  }

  function stored(): Promise<{ click_count: number; last_clicked_at: number | null } | null> {
    return testEnv.DB.prepare(
      "SELECT click_count, last_clicked_at FROM links WHERE slug = 'abc123'",
    ).first<{ click_count: number; last_clicked_at: number | null }>();
  }

  it("increments the count and stamps last_clicked_at", async () => {
    await seedLink();

    await recordClick(testEnv.DB, "abc123", NOW);

    expect(await stored()).toEqual({ click_count: 1, last_clicked_at: NOW });
  });

  // An increment, not an assignment: it must build on whatever is stored.
  it("adds to the count already stored", async () => {
    await seedLink({ clickCount: 41 });

    await recordClick(testEnv.DB, "abc123", NOW);

    expect((await stored())?.click_count).toBe(42);
  });

  // Defensive: a DELETE racing an in-flight redirect must not revive the count.
  it("leaves a tombstoned link untouched (D15)", async () => {
    await seedLink({ clickCount: 7, deletedAt: NOW - 1 });

    await recordClick(testEnv.DB, "abc123", NOW);

    expect(await stored()).toEqual({ click_count: 7, last_clicked_at: null });
  });
});
