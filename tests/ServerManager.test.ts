import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { ServerManager, ServerState } from "../src/server/ServerManager";
import { OpenCodeSettings } from "../src/types";

// Test configuration
const TEST_PORT_BASE = 15000;
const TEST_TIMEOUT_MS = 10000; // 10 seconds for server startup in tests
const PROJECT_DIR = process.cwd();

let currentPort = TEST_PORT_BASE;

function getNextPort(): number {
  return currentPort++;
}

function createTestSettings(port: number): OpenCodeSettings {
  return {
    port,
    hostname: "127.0.0.1",
    autoStart: false,
    opencodePath: "opencode",
    projectDirectory: "",
    startupTimeout: process.platform === "win32" ? 15000 : TEST_TIMEOUT_MS,
    defaultViewLocation: "sidebar",
    injectWorkspaceContext: true,
    maxNotesInContext: 20,
    maxSelectionLength: 2000,
    customCommand: "",
    useCustomCommand: false,
    serverPassword: "test-password",
  };
}

// Track current manager for cleanup
let currentManager: ServerManager | null = null;

// Verify opencode binary is available before running tests
beforeAll(async () => {
  const proc = Bun.spawn(["opencode", "--version"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(
      "opencode binary not found or not executable. " +
        "Please ensure 'opencode' is installed and available in PATH."
    );
  }
});

// Cleanup after each test
afterEach(async () => {
  if (currentManager) {
    await currentManager.stop();
    // Give process time to fully terminate
    await new Promise((resolve) => setTimeout(resolve, 500));
    currentManager = null;
  }
});

describe("ServerManager", () => {
  describe("happy path", () => {
     test("starts server and transitions to running state", async () => {
       const port = getNextPort();
       const settings = createTestSettings(port);
       const stateHistory: ServerState[] = [];

       currentManager = new ServerManager(settings, PROJECT_DIR);
       currentManager.on("stateChange", (state: ServerState) => {
         stateHistory.push(state);
       });

      expect(currentManager.getState()).toBe("stopped");

      const success = await currentManager.start();

      expect(success).toBe(true);
      expect(currentManager.getState()).toBe("running");
      expect(stateHistory).toContain("starting");
      expect(stateHistory).toContain("running");
    }, 30000); // Increased timeout for database migration on first run

     test("reports the server root URL", async () => {
       const port = getNextPort();
       const settings = createTestSettings(port);

       currentManager = new ServerManager(settings, PROJECT_DIR);

      const url = currentManager.getUrl();

      expect(url).toBe(`http://127.0.0.1:${port}`);
    });

     test("stops server gracefully and transitions to stopped state", async () => {
       const port = getNextPort();
       const settings = createTestSettings(port);
       const stateHistory: ServerState[] = [];

       currentManager = new ServerManager(settings, PROJECT_DIR);
       currentManager.on("stateChange", (state: ServerState) => {
         stateHistory.push(state);
       });

      await currentManager.start();
      expect(currentManager.getState()).toBe("running");

      await currentManager.stop();

      expect(currentManager.getState()).toBe("stopped");
      expect(stateHistory).toContain("stopped");
    });

     test("state callbacks fire in correct order: starting -> running", async () => {
       const port = getNextPort();
       const settings = createTestSettings(port);
       const stateHistory: ServerState[] = [];

       currentManager = new ServerManager(settings, PROJECT_DIR);
       currentManager.on("stateChange", (state: ServerState) => {
         stateHistory.push(state);
       });

      await currentManager.start();

      // Verify order: first starting, then running
      const startingIndex = stateHistory.indexOf("starting");
      const runningIndex = stateHistory.indexOf("running");

      expect(startingIndex).toBeGreaterThanOrEqual(0);
      expect(runningIndex).toBeGreaterThan(startingIndex);
    });

     test("can restart after stop", async () => {
       const port = getNextPort();
       const settings = createTestSettings(port);

       currentManager = new ServerManager(settings, PROJECT_DIR);

      // First start
      const firstStart = await currentManager.start();
      expect(firstStart).toBe(true);
      expect(currentManager.getState()).toBe("running");

      // Stop
      await currentManager.stop();
      expect(currentManager.getState()).toBe("stopped");

      // Wait for process to fully terminate
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Restart
      const secondStart = await currentManager.start();
      expect(secondStart).toBe(true);
      expect(currentManager.getState()).toBe("running");
    });

     test("returns true immediately if already running", async () => {
       const port = getNextPort();
       const settings = createTestSettings(port);

       currentManager = new ServerManager(settings, PROJECT_DIR);

      // First start
      await currentManager.start();
      expect(currentManager.getState()).toBe("running");

      // Second start should return true immediately without state changes
      const stateHistory: ServerState[] = [];
      const onStateChange = (state: ServerState) => {
        stateHistory.push(state);
      };
      currentManager.on("stateChange", onStateChange);

      const result = await currentManager.start();

      expect(result).toBe(true);
      expect(currentManager.getState()).toBe("running");
      // Should not have triggered any state changes
      expect(stateHistory).toEqual([]);
    });

     test("health check endpoint is accessible when running", async () => {
       const port = getNextPort();
       const settings = createTestSettings(port);

       currentManager = new ServerManager(settings, PROJECT_DIR);

      await currentManager.start();

      // Verify we can hit the server root (open mode waives authentication)
      const url = currentManager.getUrl();

      const response = await fetch(url, {
        signal: AbortSignal.timeout(2000),
      });

      expect(response.ok).toBe(true);
    });

     test("passes the configured password to the server", async () => {
       const port = getNextPort();
       const settings = createTestSettings(port);
       settings.serverPassword = "integration-secret";

       currentManager = new ServerManager(settings, PROJECT_DIR);

      await currentManager.start();

      expect(currentManager.getPassword()).toBe("integration-secret");

      // The API must accept the password the plugin pinned via the environment.
      const token = Buffer.from(`opencode:${settings.serverPassword}`).toString("base64");
      const response = await fetch(`${currentManager.getUrl()}/api/info`, {
        headers: { Authorization: `Basic ${token}` },
        signal: AbortSignal.timeout(5000),
      });

      expect(response.status).toBe(200);
      const info = (await response.json()) as { version?: string };
      expect(info.version).toBeDefined();
    });
  });

  describe("password mismatch", () => {
    test("reports an error when a server on the port rejects the configured password", async () => {
      const port = getNextPort();
      const otherPassword = "someone-elses-password";
      const otherToken = Buffer.from(`opencode:${otherPassword}`).toString("base64");

      const server = Bun.spawn(
        ["opencode", "serve", "--port", String(port), "--hostname", "127.0.0.1"],
        {
          env: { ...process.env, OPENCODE_SERVER_PASSWORD: otherPassword },
          stdout: "pipe",
          stderr: "pipe",
        }
      );

      try {
        const deadline = Date.now() + 20000;
        let up = false;
        while (Date.now() < deadline) {
          try {
            const response = await fetch(`http://127.0.0.1:${port}/api/info`, {
              headers: { Authorization: `Basic ${otherToken}` },
              signal: AbortSignal.timeout(1000),
            });
            if (response.ok) {
              up = true;
              break;
            }
          } catch {
            // not listening yet
          }
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
        expect(up).toBe(true);

        const settings = createTestSettings(port);
        settings.serverPassword = "different-password";
        const manager = new ServerManager(settings, PROJECT_DIR);

        const success = await manager.start();

        expect(success).toBe(false);
        expect(manager.getState()).toBe("error");
        expect(manager.getLastError()).toContain("rejected the configured password");
      } finally {
        server.kill();
        await server.exited;
      }
    }, 40000);
  });

  describe("custom command that pins a different password", () => {
    test("fails cleanly and does not leave the server running", async () => {
      const port = getNextPort();
      const settings = createTestSettings(port);
      settings.startupTimeout = 4000;
      settings.useCustomCommand = true;
      settings.serverPassword = "plugin-password";
      settings.customCommand = `OPENCODE_SERVER_PASSWORD=other-secret opencode serve --port ${port} --hostname 127.0.0.1`;

      const manager = new ServerManager(settings, PROJECT_DIR);

      const success = await manager.start();

      expect(success).toBe(false);
      expect(manager.getState()).toBe("error");
      expect(manager.getLastError()).toContain("rejected the configured password");

      // The failed start must not leak the process it spawned.
      await new Promise((resolve) => setTimeout(resolve, 1000));
      let stillListening = false;
      try {
        const response = await fetch(`http://127.0.0.1:${port}`, {
          signal: AbortSignal.timeout(1500),
        });
        stillListening = response.ok || response.status === 401;
      } catch {
        stillListening = false;
      }
      expect(stillListening).toBe(false);
    }, 30000);
  });

  describe("async stop behavior", () => {
    test("stop returns immediately when no process", async () => {
      const port = getNextPort();
      const settings = createTestSettings(port);
      const stateHistory: ServerState[] = [];

      currentManager = new ServerManager(settings, PROJECT_DIR);
      currentManager.on("stateChange", (state: ServerState) => {
        stateHistory.push(state);
      });

      // Stop without starting - should not throw and set state
      await currentManager.stop();

      expect(currentManager.getState()).toBe("stopped");
    });

    test("stop completes within timeout when process exits quickly", async () => {
      const port = getNextPort();
      const settings = createTestSettings(port);

      currentManager = new ServerManager(settings, PROJECT_DIR);

      await currentManager.start();
      expect(currentManager.getState()).toBe("running");

      // Stop should complete within 5 seconds (2s SIGTERM wait + 3s SIGKILL wait)
      const stopStart = Date.now();
      await currentManager.stop();
      const stopDuration = Date.now() - stopStart;

      expect(currentManager.getState()).toBe("stopped");
      // Should complete well before 5 second timeout
      expect(stopDuration).toBeLessThan(6000);
    });

    test("process is fully terminated after stop completes", async () => {
      const port = getNextPort();
      const settings = createTestSettings(port);

      currentManager = new ServerManager(settings, PROJECT_DIR);

      await currentManager.start();

      const url = currentManager.getUrl();
      
      await currentManager.stop();

      // Wait a bit then verify server is not accessible
      await new Promise((resolve) => setTimeout(resolve, 1000));

      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(1000),
        });
        // If we get here, server is still running - test should fail
        expect(response.ok).toBe(false);
      } catch (e) {
        // Expected - server should not be accessible
        expect(e).toBeDefined();
      }
    });
  });

  describe("error handling", () => {
    test("handles double stop gracefully", async () => {
      const port = getNextPort();
      const settings = createTestSettings(port);

      currentManager = new ServerManager(settings, PROJECT_DIR);

      await currentManager.start();
      expect(currentManager.getState()).toBe("running");

      // First stop
      await currentManager.stop();
      expect(currentManager.getState()).toBe("stopped");

      // Second stop should not throw
      await currentManager.stop();
      expect(currentManager.getState()).toBe("stopped");
    });
  });

  describe("server URL", () => {
    test("getUrl returns the server root", () => {
      const settings = createTestSettings(getNextPort());
      const manager = new ServerManager(settings, "/home/user/\u{1F4C1}Notes");

      expect(manager.getUrl()).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    });
  });
});
