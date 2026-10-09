import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { ServerManager } from "../src/server/ServerManager";
import { OpenCodeClient } from "../src/client/OpenCodeClient";
import { OpenCodeSettings } from "../src/types";

const TEST_PORT = 15100;
const PROJECT_DIR = process.cwd();
const PASSWORD = "client-integration-password";

function createTestSettings(port: number): OpenCodeSettings {
  return {
    port,
    hostname: "127.0.0.1",
    autoStart: false,
    opencodePath: "opencode",
    projectDirectory: "",
    startupTimeout: 30000,
    defaultViewLocation: "sidebar",
    injectWorkspaceContext: false,
    maxNotesInContext: 20,
    maxSelectionLength: 2000,
    customCommand: "",
    useCustomCommand: false,
    serverPassword: PASSWORD,
  };
}

let manager: ServerManager;
let client: OpenCodeClient;

beforeAll(async () => {
  manager = new ServerManager(createTestSettings(TEST_PORT), PROJECT_DIR);
  const started = await manager.start();

  if (!started) {
    throw new Error(`Failed to start test server: ${manager.getLastError()}`);
  }

  client = new OpenCodeClient(manager.getUrl(), manager.getPassword(), PROJECT_DIR);
}, 40000);

afterAll(async () => {
  await manager?.stop();
});

describe("OpenCodeClient against a real v2 server", () => {
  test("registers the project directory", async () => {
    expect(await client.initializeProject()).toBe(true);
  });

  test("creates a session and returns a v2 session id", async () => {
    const sessionId = await client.createSession();

    expect(sessionId).toBeTruthy();
    expect(sessionId as string).toMatch(/^ses/);
  });

  test("builds the session route the v2 web UI understands", async () => {
    const sessionId = await client.createSession();
    expect(sessionId).toBeTruthy();

    const url = client.getSessionUrl(sessionId as string);

    expect(url).toBe(
      `${manager.getUrl()}/server/aHR0cDovLzEyNy4wLjAuMToxNTEwMA/session/${sessionId}`
    );
    expect(client.resolveSessionId(url)).toBe(sessionId);
  });

  test("returns null when the server password is wrong", async () => {
    const wrongClient = new OpenCodeClient(manager.getUrl(), "not-the-password", PROJECT_DIR);

    expect(await wrongClient.initializeProject()).toBe(false);
    expect(await wrongClient.createSession()).toBeNull();
  });
});
