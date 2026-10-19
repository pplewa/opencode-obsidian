/**
 * URL and auth helpers for the OpenCode v2 server.
 *
 * v2 serves one web UI per server. A session lives at:
 *   <serverUrl>/server/<serverKey>/session/<sessionId>
 * where <serverKey> is the base64url encoding of the server URL.
 */

const AUTH_USERNAME = "opencode";

export const STORAGE_KEY_SERVER = "opencode.global.dat:server";

/** Strip trailing slashes so a server URL can be joined safely. */
export function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, "");
}

/** Encode a server URL the way the OpenCode web UI expects in a session route. */
export function encodeServerKey(serverUrl: string): string {
  return Buffer.from(normalizeServerUrl(serverUrl), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function buildSessionUrl(serverUrl: string, sessionId: string): string {
  return `${normalizeServerUrl(serverUrl)}/server/${encodeServerKey(serverUrl)}/session/${sessionId}`;
}

/**
 * v2 authenticates with HTTP Basic. The username is fixed and the password is
 * the one the server prints on startup.
 */
export function buildAuthHeader(password: string): string {
  const token = Buffer.from(`${AUTH_USERNAME}:${password}`, "utf8").toString("base64");
  return `Basic ${token}`;
}
