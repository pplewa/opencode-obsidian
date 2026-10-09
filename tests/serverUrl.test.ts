import { describe, test, expect } from "bun:test";
import {
  buildAuthHeader,
  buildSessionUrl,
  encodeServerKey,
  normalizeServerUrl,
  STORAGE_KEY_SERVER,
} from "../src/lib/serverUrl";

describe("serverUrl", () => {
  describe("normalizeServerUrl", () => {
    test("strips trailing slashes", () => {
      expect(normalizeServerUrl("http://127.0.0.1:14096/")).toBe("http://127.0.0.1:14096");
      expect(normalizeServerUrl("http://127.0.0.1:14096///")).toBe("http://127.0.0.1:14096");
    });

    test("keeps a URL without trailing slash unchanged", () => {
      expect(normalizeServerUrl("http://127.0.0.1:14096")).toBe("http://127.0.0.1:14096");
    });
  });

  describe("encodeServerKey", () => {
    test("matches the encoding the OpenCode web UI produces", () => {
      // Verified against the running v2 web UI.
      expect(encodeServerKey("http://127.0.0.1:14096")).toBe("aHR0cDovLzEyNy4wLjAuMToxNDA5Ng");
    });

    test("uses base64url characters and no padding", () => {
      const key = encodeServerKey("http://localhost:1234");
      expect(key).not.toContain("+");
      expect(key).not.toContain("/");
      expect(key).not.toContain("=");
    });

    test("decodes back to the original URL", () => {
      const url = "http://127.0.0.1:14096";
      const decoded = Buffer.from(encodeServerKey(url), "base64url").toString("utf8");
      expect(decoded).toBe(url);
    });

    test("ignores a trailing slash", () => {
      expect(encodeServerKey("http://127.0.0.1:14096/")).toBe(
        encodeServerKey("http://127.0.0.1:14096")
      );
    });
  });

  describe("buildSessionUrl", () => {
    test("builds the v2 session route", () => {
      expect(buildSessionUrl("http://127.0.0.1:14096", "ses_abc123")).toBe(
        "http://127.0.0.1:14096/server/aHR0cDovLzEyNy4wLjAuMToxNDA5Ng/session/ses_abc123"
      );
    });
  });

  describe("buildAuthHeader", () => {
    test("uses the opencode username and the server password", () => {
      const header = buildAuthHeader("secret");
      expect(header).toBe(`Basic ${Buffer.from("opencode:secret").toString("base64")}`);
    });
  });

  describe("STORAGE_KEY_SERVER", () => {
    test("is the key the OpenCode web UI reads", () => {
      expect(STORAGE_KEY_SERVER).toBe("opencode.global.dat:server");
    });
  });
});
