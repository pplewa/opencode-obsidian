import { describe, test, expect } from "bun:test";
import { buildAuthSeedScript } from "../src/ui/authSeed";
import { STORAGE_KEY_SERVER } from "../src/lib/serverUrl";

type FakeStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

function createFakeWindow(initial?: string): { window: { localStorage: FakeStorage }; read: () => string | null } {
  const store = new Map<string, string>();
  if (initial !== undefined) {
    store.set(STORAGE_KEY_SERVER, initial);
  }

  return {
    window: {
      localStorage: {
        getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
      },
    },
    read: () => (store.has(STORAGE_KEY_SERVER) ? (store.get(STORAGE_KEY_SERVER) as string) : null),
  };
}

function runSeed(script: string, fake: { window: { localStorage: FakeStorage } }): unknown {
  // A browser evaluates the injected expression and returns its value; mirror
  // that here so the returned "changed" flag is observable.
  const fn = new Function("window", `return ${script}`);
  return fn(fake.window);
}

describe("buildAuthSeedScript", () => {
  test("writes the credential and reports a change on first run", () => {
    const fake = createFakeWindow();
    const changed = runSeed(buildAuthSeedScript("http://127.0.0.1:14096", "secret"), fake);

    expect(changed).toBe(true);
    expect(JSON.parse(fake.read() as string)).toEqual({
      list: [{ type: "http", http: { url: "http://127.0.0.1:14096", password: "secret" } }],
      hidden: {},
      projects: {},
      lastProject: {},
      recentlyClosed: {},
    });
  });

  test("reports no change when the credential already matches", () => {
    const fake = createFakeWindow();
    const script = buildAuthSeedScript("http://127.0.0.1:14096", "secret");

    expect(runSeed(script, fake)).toBe(true);
    // A second pass must not report a change, otherwise the webview reloads forever.
    expect(runSeed(script, fake)).toBe(false);
  });

  test("updates the password when it changed on the server", () => {
    const fake = createFakeWindow();
    runSeed(buildAuthSeedScript("http://127.0.0.1:14096", "old"), fake);

    const changed = runSeed(buildAuthSeedScript("http://127.0.0.1:14096", "new"), fake);

    expect(changed).toBe(true);
    const state = JSON.parse(fake.read() as string);
    expect(state.list).toHaveLength(1);
    expect(state.list[0].http.password).toBe("new");
  });

  test("keeps other stored servers and existing state", () => {
    const other = {
      list: [{ type: "http", http: { url: "http://10.0.0.5:4096", password: "other" } }],
      hidden: { "http://10.0.0.5:4096": true },
      projects: { "http://10.0.0.5:4096": [{ worktree: "/tmp/x" }] },
      lastProject: {},
      recentlyClosed: {},
    };
    const fake = createFakeWindow(JSON.stringify(other));

    runSeed(buildAuthSeedScript("http://127.0.0.1:14096", "secret"), fake);

    const state = JSON.parse(fake.read() as string);
    expect(state.list).toHaveLength(2);
    expect(state.list[0].http.url).toBe("http://10.0.0.5:4096");
    expect(state.list[1].http.url).toBe("http://127.0.0.1:14096");
    expect(state.hidden).toEqual({ "http://10.0.0.5:4096": true });
    expect(state.projects).toEqual({ "http://10.0.0.5:4096": [{ worktree: "/tmp/x" }] });
  });

  test("recovers from corrupted storage", () => {
    const fake = createFakeWindow("not json");

    const changed = runSeed(buildAuthSeedScript("http://127.0.0.1:14096", "secret"), fake);

    expect(changed).toBe(true);
    const state = JSON.parse(fake.read() as string);
    expect(state.list).toHaveLength(1);
    expect(state.list[0].http.password).toBe("secret");
  });

  test("normalizes a trailing slash so the server key matches", () => {
    const fake = createFakeWindow();

    runSeed(buildAuthSeedScript("http://127.0.0.1:14096/", "secret"), fake);

    const state = JSON.parse(fake.read() as string);
    expect(state.list[0].http.url).toBe("http://127.0.0.1:14096");
  });
});
