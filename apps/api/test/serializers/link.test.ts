import { describe, expect, it } from "vitest";
import type { LinkRow } from "../../src/db/types";
import { redirectBaseUrl, serializeLink } from "../../src/serializers/link";

function row(overrides: Partial<LinkRow> = {}): LinkRow {
  return {
    id: 1,
    slug: "aB3xY9k",
    destination: "https://clinic.example.com/appt/9182",
    redirect_type: 302,
    is_active: 1,
    expires_at: null,
    deleted_at: null,
    external_id: null,
    click_count: 0,
    last_clicked_at: null,
    created_by_key_id: 1,
    created_at: 1_788_177_600_000,
    updated_at: 1_788_177_600_000,
    ...overrides,
  };
}

describe("link serialization (api-contract §The Link resource, D26)", () => {
  it("renders every contract field and nothing else", () => {
    expect(serializeLink(row(), [], "production")).toEqual({
      slug: "aB3xY9k",
      short_url: "https://r301.dev/aB3xY9k",
      destination: "https://clinic.example.com/appt/9182",
      redirect_type: 302,
      is_active: true,
      expires_at: null,
      tags: [],
      external_id: null,
      created_at: "2026-08-31T12:00:00.000Z",
      updated_at: "2026-08-31T12:00:00.000Z",
    });
  });

  // D26: counts live on the stats endpoints, so the Link resource must not
  // carry them even though the row does.
  it("omits counts even when the row carries them", () => {
    const serialized = serializeLink(row({ click_count: 940, last_clicked_at: 1 }), [], "local");

    expect(serialized).not.toHaveProperty("click_count");
    expect(serialized).not.toHaveProperty("last_clicked_at");
  });

  it("omits internal columns", () => {
    const serialized = serializeLink(row(), [], "local");

    for (const internal of ["id", "deleted_at", "created_by_key_id"]) {
      expect(serialized).not.toHaveProperty(internal);
    }
  });

  it("renders epoch-ms timestamps as ISO 8601 UTC", () => {
    const serialized = serializeLink(row({ created_at: 0, updated_at: 1_000 }), [], "local");

    expect(serialized.created_at).toBe("1970-01-01T00:00:00.000Z");
    expect(serialized.updated_at).toBe("1970-01-01T00:00:01.000Z");
  });

  it("renders a set expiry as ISO 8601 and an unset one as null", () => {
    expect(serializeLink(row({ expires_at: 1_788_177_600_000 }), [], "local").expires_at).toBe(
      "2026-08-31T12:00:00.000Z",
    );
    expect(serializeLink(row({ expires_at: null }), [], "local").expires_at).toBeNull();
  });

  it("renders is_active as a boolean, not the stored integer", () => {
    expect(serializeLink(row({ is_active: 1 }), [], "local").is_active).toBe(true);
    expect(serializeLink(row({ is_active: 0 }), [], "local").is_active).toBe(false);
  });

  it("passes tags through in the order given", () => {
    expect(serializeLink(row(), ["tenant:42", "kind:appointment"], "local").tags).toEqual([
      "tenant:42",
      "kind:appointment",
    ]);
  });

  it("renders external_id when set", () => {
    expect(serializeLink(row({ external_id: "appt_9182" }), [], "local").external_id).toBe(
      "appt_9182",
    );
  });

  describe("short_url host map", () => {
    it.each([
      ["production", "https://r301.dev"],
      ["staging", "https://staging.r301.dev"],
      ["local", "http://127.0.0.1:8787"],
    ])("%s redirects from %s", (environment, base) => {
      expect(redirectBaseUrl(environment)).toBe(base);
      expect(serializeLink(row({ slug: "launch" }), [], environment).short_url).toBe(
        `${base}/launch`,
      );
    });

    // Silently falling back to a default would ship localhost URLs to a real
    // customer the first time an environment is added without a map entry.
    it("throws on an environment it does not know", () => {
      expect(() => redirectBaseUrl("preview")).toThrow(/preview/);
    });
  });
});
