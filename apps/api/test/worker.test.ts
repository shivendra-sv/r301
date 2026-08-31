import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("worker entry", () => {
  it("returns 404 for any path", async () => {
    const res = await exports.default.fetch(new Request("https://r301.dev/anything"));

    expect(res.status).toBe(404);
  });
});
