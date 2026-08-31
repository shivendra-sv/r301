import { describe, expect, it } from "vitest";
import { validateDestination } from "../../src/services/destination";

/** Narrows to the accepted branch, failing loudly with the reason if not. */
function accept(input: string): URL {
  const result = validateDestination(input);

  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error("unreachable");

  return result.url;
}

function reject(input: string): string {
  const result = validateDestination(input);

  expect(result).toMatchObject({ ok: false });
  if (result.ok) throw new Error(`expected ${input} to be rejected`);

  return result.reason;
}

describe("destination validation (PRD §7.1)", () => {
  describe("accepts", () => {
    it.each([
      "https://clinic.example.com/appt/9182?t=abc123",
      "http://example.com/",
      "https://example.com:8443/deep/path#frag",
      "https://sub.domain.example.co.uk/",
      // 172.16–31 is the private block; 172.15 and 172.32 are public.
      "http://172.15.0.1/",
      "http://172.32.0.1/",
      // 11.x sits just outside 10/8, 192.167/169.x outside 192.168/16.
      "http://11.0.0.1/",
      "http://192.169.0.1/",
      "https://[2606:4700:4700::1111]/",
    ])("%s", (input) => {
      expect(validateDestination(input).ok).toBe(true);
    });

    it("normalizes an IDN host to punycode", () => {
      expect(accept("https://exämple.com/path").hostname).toBe("xn--exmple-cua.com");
    });

    it("allows a host that merely contains the self-domain as a substring", () => {
      expect(accept("https://notr301.dev/x").hostname).toBe("notr301.dev");
    });

    it("allows exactly 2048 characters", () => {
      const url = `https://example.com/${"a".repeat(2028)}`;

      expect(url).toHaveLength(2048);
      expect(validateDestination(url).ok).toBe(true);
    });
  });

  describe("rejects", () => {
    it.each([
      ["javascript:alert(1)", "scheme"],
      ["data:text/html,<script>1</script>", "scheme"],
      ["file:///etc/passwd", "scheme"],
      ["ftp://files.example.com/x", "scheme"],
    ])("%s → %s", (input, reason) => {
      expect(reject(input)).toBe(reason);
    });

    it.each(["not a url", "https://", "http://[not-an-ip]/", ""])(
      "unparseable: %s",
      (input) => {
        expect(reject(input)).toBe("unparseable");
      },
    );

    it("longer than 2048 characters", () => {
      const url = `https://example.com/${"a".repeat(2029)}`;

      expect(url).toHaveLength(2049);
      expect(reject(url)).toBe("too_long");
    });

    it.each([
      "https://user:pass@example.com/",
      "https://user@example.com/",
      "https://:pass@example.com/",
    ])("credentials in URL: %s", (input) => {
      expect(reject(input)).toBe("credentials");
    });

    it.each([
      "https://r301.dev/abc",
      "https://staging.r301.dev/abc",
      "https://api.r301.dev/v1/links",
      "https://R301.DEV/abc",
    ])("self-domain: %s", (input) => {
      expect(reject(input)).toBe("self_domain");
    });

    it.each(["http://localhost/", "http://localhost:8787/x", "http://foo.localhost/"])(
      "localhost: %s",
      (input) => {
        expect(reject(input)).toBe("private_host");
      },
    );

    it.each([
      "http://127.0.0.1/",
      "http://127.1.2.3/",
      "http://10.0.0.1/",
      "http://10.255.255.254/",
      "http://172.16.0.1/",
      "http://172.31.255.254/",
      "http://192.168.1.1/",
      "http://169.254.169.254/",
      "http://0.0.0.0/",
    ])("private/loopback/link-local IPv4: %s", (input) => {
      expect(reject(input)).toBe("private_host");
    });

    it.each([
      "http://[::1]/",
      "http://[::]/",
      "http://[fc00::1]/",
      "http://[fd12:3456::1]/",
      "http://[fe80::1]/",
      // IPv4-mapped: the parser rewrites this to [::ffff:7f00:1], so the check
      // has to see through the mapping rather than string-match "127.0.0.1".
      "http://[::ffff:127.0.0.1]/",
    ])("private/loopback/link-local IPv6: %s", (input) => {
      expect(reject(input)).toBe("private_host");
    });

    // The WHATWG parser normalizes these to 127.0.0.1 before we ever see them —
    // this pins that the range check runs on the PARSED host, not the input.
    it.each([
      ["http://2130706433/", "127.0.0.1"],
      ["http://0x7f.0.0.1/", "127.0.0.1"],
      ["http://017700000001/", "127.0.0.1"],
      ["http://0xc0a80101/", "192.168.1.1"],
    ])("obfuscated IPv4 %s parses to %s and is rejected", (input, host) => {
      expect(new URL(input).hostname).toBe(host);
      expect(reject(input)).toBe("private_host");
    });

    // IDNA maps these circled letters to ASCII "localhost" during parsing.
    it("homoglyph host that punycode-normalizes to localhost", () => {
      expect(reject("https://Ⓛⓞⓒⓐⓛⓗⓞⓢⓣ/")).toBe("private_host");
    });
  });

  it("explains the rejection without echoing the destination", () => {
    const result = validateDestination("http://10.0.0.1/secret-token-path");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.message).not.toContain("secret-token-path");
    expect(result.message.length).toBeGreaterThan(0);
  });
});
