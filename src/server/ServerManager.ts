import { ChildProcess, SpawnOptions } from "child_process";
import { EventEmitter } from "events";
import { OpenCodeSettings } from "../types";
import { ServerState } from "./types";
import { OpenCodeProcess } from "./process/OpenCodeProcess";
import { WindowsProcess } from "./process/WindowsProcess";
import { PosixProcess } from "./process/PosixProcess";
import { ExecutableResolver } from "./ExecutableResolver";
import { buildAuthHeader } from "../lib/serverUrl";

export type { ServerState } from "./types";

/** Server prints this on stdout when it generated its own password. */
const PASSWORD_PATTERN = /^server password (.+)$/;

export class ServerManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private state: ServerState = "stopped";
  private lastError: string | null = null;
  private earlyExitCode: number | null = null;
  private settings: OpenCodeSettings;
  private projectDirectory: string;
  private processImpl: OpenCodeProcess;
  private reportedPassword: string | null = null;
  private outputBuffer = "";

  constructor(settings: OpenCodeSettings, projectDirectory: string) {
    super();
    this.settings = settings;
    this.projectDirectory = projectDirectory;
    this.processImpl =
      process.platform === "win32" ? new WindowsProcess() : new PosixProcess();
  }

  updateSettings(settings: OpenCodeSettings): void {
    this.settings = settings;
  }

  updateProjectDirectory(directory: string): void {
    this.projectDirectory = directory;
    this.emit("projectDirectoryChanged", directory);
  }

  getState(): ServerState {
    return this.state;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  /**
   * Password the running server expects.
   *
   * The plugin passes OPENCODE_SERVER_PASSWORD on spawn, so the configured
   * value is normally correct. A custom command can override that, in which
   * case the server prints its own password and we adopt it.
   */
  getPassword(): string {
    return this.reportedPassword ?? this.settings.serverPassword;
  }

  getUrl(): string {
    return `http://${this.settings.hostname}:${this.settings.port}`;
  }

  async start(): Promise<boolean> {
    if (this.state === "running" || this.state === "starting") {
      return true;
    }

    this.setState("starting");
    this.lastError = null;
    this.earlyExitCode = null;
    this.reportedPassword = null;
    this.outputBuffer = "";

    if (!this.projectDirectory) {
      return this.setError("Project directory (vault) not configured");
    }

    // Determine execution mode and resolve executable path
    let executablePath: string;
    let spawnOptions: SpawnOptions;

    const env = {
      ...process.env,
      NODE_USE_SYSTEM_CA: "1",
      ...(this.settings.serverPassword
        ? { OPENCODE_SERVER_PASSWORD: this.settings.serverPassword }
        : {}),
    };

    if (this.settings.useCustomCommand) {
      // Custom command mode: use custom command directly with shell
      executablePath = this.settings.customCommand;
      spawnOptions = {
        cwd: this.projectDirectory,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,
      };
    } else {
      // Path mode: resolve executable and verify
      executablePath = ExecutableResolver.resolve(this.settings.opencodePath);

      // Pre-flight check: verify executable exists (only for path mode)
      const commandError = await this.processImpl.verifyCommand(executablePath);
      if (commandError) {
        return this.setError(commandError);
      }

      spawnOptions = {
        cwd: this.projectDirectory,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      };
    }

    const existing = await this.probeServer();
    if (existing === "ready") {
      console.log(
        "[OpenCode] Server already running on port",
        this.settings.port
      );
      this.setState("running");
      return true;
    }

    if (existing === "unauthorized") {
      return this.setError(
        `A server is already running on port ${this.settings.port}, but it rejected the configured password. ` +
          "Stop that server, or update the Server password setting to match."
      );
    }

    console.log("[OpenCode] Starting server:", {
      mode: this.settings.useCustomCommand ? "custom" : "path",
      command: executablePath,
      port: this.settings.port,
      hostname: this.settings.hostname,
      cwd: this.projectDirectory,
      projectDirectory: this.projectDirectory,
    });

    if (this.settings.useCustomCommand) {
      // Custom command mode: spawn with shell, no args appended
      this.process = this.processImpl.start(
        executablePath,
        [], // User controls all arguments in custom command
        spawnOptions
      );
    } else {
      // Path mode: spawn with default arguments
      this.process = this.processImpl.start(
        executablePath,
        [
          "serve",
          "--port",
          this.settings.port.toString(),
          "--hostname",
          this.settings.hostname,
          "--cors",
          "app://obsidian.md",
        ],
        spawnOptions
      );
    }

    console.log("[OpenCode] Process spawned with PID:", this.process.pid);

    this.process.stdout?.on("data", (data) => {
      this.handleServerOutput(data.toString());
    });

    this.process.stderr?.on("data", (data) => {
      console.error("[OpenCode Error]", data.toString().trim());
    });

    this.process.on("exit", (code, signal) => {
      console.log(
        `[OpenCode] Process exited with code ${code}, signal ${signal}`
      );
      this.process = null;

      if (this.state === "starting" && code !== null && code !== 0) {
        this.earlyExitCode = code;
      }

      if (this.state === "running") {
        this.setState("stopped");
      }
    });

    this.process.on("error", (err: NodeJS.ErrnoException) => {
      console.error("[OpenCode] Failed to start process:", err);
      this.process = null;

      if (err.code === "ENOENT") {
        const command = this.settings.useCustomCommand 
          ? this.settings.customCommand 
          : this.settings.opencodePath;
        this.setError(
          `Executable not found: '${command}'`
        );
      } else {
        this.setError(`Failed to start: ${err.message}`);
      }
    });

    const outcome = await this.waitForServerOrExit(this.settings.startupTimeout);
    if (outcome === "ready") {
      this.setState("running");
      return true;
    }

    if (this.state === "error") {
      return false;
    }

    await this.stop();

    if (outcome === "unauthorized") {
      return this.setError(
        `OpenCode started on port ${this.settings.port} but rejected the configured password. ` +
          "Check the Server password setting."
      );
    }

    if (this.earlyExitCode !== null) {
      return this.setError(
        `Process exited unexpectedly (exit code ${this.earlyExitCode})`
      );
    }
    if (!this.process) {
      return this.setError("Process exited before server became ready");
    }
    return this.setError("Server failed to start within timeout");
  }

  async stop(): Promise<void> {
    if (!this.process) {
      this.setState("stopped");
      return;
    }

    const proc = this.process;

    this.setState("stopped");
    this.process = null;

    await this.processImpl.stop(proc);
  }

  private setState(state: ServerState): void {
    this.state = state;
    this.emit("stateChange", state);
  }

  /**
   * Read stdout line by line. The server prints its password on startup when it
   * does not use OPENCODE_SERVER_PASSWORD.
   */
  private handleServerOutput(text: string): void {
    this.outputBuffer += text;

    let newlineIndex = this.outputBuffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.outputBuffer.slice(0, newlineIndex).trim();
      this.outputBuffer = this.outputBuffer.slice(newlineIndex + 1);
      if (line) {
        this.handleServerLine(line);
      }
      newlineIndex = this.outputBuffer.indexOf("\n");
    }
  }

  private handleServerLine(line: string): void {
    const match = PASSWORD_PATTERN.exec(line);
    if (match) {
      // Keep the password out of the log.
      console.log("[OpenCode] Server reported a password");
      this.reportedPassword = match[1].trim();
      return;
    }

    console.log("[OpenCode]", line);
  }

  private setError(message: string): false {
    this.lastError = message;
    console.error("[OpenCode Error]", message);
    this.setState("error");
    return false;
  }

  /**
   * Report what is on the configured port.
   *
   * - "down": nothing is listening
   * - "unauthorized": a server is listening but rejects our password
   * - "ready": a server is listening and accepts our password
   */
  private async probeServer(): Promise<"down" | "unauthorized" | "ready"> {
    const password = this.getPassword();
    const url = password ? `${this.getUrl()}/api/info` : this.getUrl();
    const headers = password ? { Authorization: buildAuthHeader(password) } : undefined;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(2000),
      });

      if (response.ok) {
        return "ready";
      }
      if (response.status === 401) {
        return "unauthorized";
      }
      return "down";
    } catch {
      return "down";
    }
  }

  private async waitForServerOrExit(
    timeoutMs: number
  ): Promise<"ready" | "unauthorized" | "timeout"> {
    const startTime = Date.now();
    const pollInterval = 500;
    let sawUnauthorized = false;

    while (Date.now() - startTime < timeoutMs) {
      if (!this.process) {
        console.log("[OpenCode] Process exited before server became ready");
        return "timeout";
      }

      const state = await this.probeServer();
      if (state === "ready") {
        return "ready";
      }
      if (state === "unauthorized") {
        // The server may report its own password a moment later. Give it a
        // chance to arrive before treating this as a failure.
        sawUnauthorized = true;
      }
      await this.sleep(pollInterval);
    }

    return sawUnauthorized ? "unauthorized" : "timeout";
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
