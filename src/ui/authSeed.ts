import { STORAGE_KEY_SERVER, normalizeServerUrl } from "../lib/serverUrl";

/**
 * Script that writes the server credential into the OpenCode web UI storage.
 *
 * Returns true when it changed anything. The caller then reloads the webview
 * once, because the web UI reads this value during startup. On the next pass
 * the value already matches, so the script returns false and no reload loop
 * can occur.
 */
export function buildAuthSeedScript(serverUrl: string, password: string): string {
  const url = normalizeServerUrl(serverUrl);

  return `(function () {
  var key = ${JSON.stringify(STORAGE_KEY_SERVER)};
  var url = ${JSON.stringify(url)};
  var password = ${JSON.stringify(password)};

  var stored = null;
  try {
    stored = window.localStorage.getItem(key);
  } catch (error) {
    return false;
  }

  var state = null;
  try {
    state = stored ? JSON.parse(stored) : null;
  } catch (error) {
    state = null;
  }

  if (!state || typeof state !== "object") {
    state = {};
  }
  if (!Array.isArray(state.list)) {
    state.list = [];
  }
  if (!state.hidden) {
    state.hidden = {};
  }
  if (!state.projects) {
    state.projects = {};
  }
  if (!state.lastProject) {
    state.lastProject = {};
  }
  if (!state.recentlyClosed) {
    state.recentlyClosed = {};
  }

  var entry = null;
  for (var i = 0; i < state.list.length; i += 1) {
    var candidate = state.list[i];
    if (candidate && candidate.type === "http" && candidate.http && candidate.http.url === url) {
      entry = candidate;
      break;
    }
  }

  if (entry && entry.http.password === password) {
    return false;
  }

  if (entry) {
    entry.http.password = password;
  } else {
    state.list.push({ type: "http", http: { url: url, password: password } });
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(state));
  } catch (error) {
    return false;
  }

  return true;
})();`;
}
