import { buildAuthHeader, buildSessionUrl, normalizeServerUrl } from "../lib/serverUrl";

type OpenCodeSession = {
  id?: string;
};

type OpenCodeResponse<T> = T | { data?: T } | { message?: T } | null;

const API_PREFIX = "/api";

export class OpenCodeClient {
  private serverUrl: string;
  private password: string;
  private projectDirectory: string;
  private lastInjectedContext: string | null = null;

  constructor(serverUrl: string, password: string, projectDirectory: string) {
    this.serverUrl = normalizeServerUrl(serverUrl);
    this.password = password;
    this.projectDirectory = projectDirectory;
  }

  updateBaseUrl(serverUrl: string, password: string, projectDirectory: string): void {
    const nextServerUrl = normalizeServerUrl(serverUrl);
    if (
      nextServerUrl !== this.serverUrl ||
      password !== this.password ||
      projectDirectory !== this.projectDirectory
    ) {
      this.serverUrl = nextServerUrl;
      this.password = password;
      this.projectDirectory = projectDirectory;
      this.resetTracking();
    }
  }

  private resetTracking(): void {
    this.lastInjectedContext = null;
  }

  /**
   * Touch the session list for the project directory. v2 creates the project
   * lazily on first access, so a list request is enough to register it.
   */
  async initializeProject(): Promise<boolean> {
    try {
      const path = `${API_PREFIX}/session?directory=${encodeURIComponent(this.projectDirectory)}`;
      const response = await fetch(`${this.serverUrl}${path}`, {
        method: "GET",
        headers: this.buildHeaders(),
      });

      if (response.ok) {
        console.log("[OpenCode] Project initialized:", this.projectDirectory);
        return true;
      }

      console.warn("[OpenCode] Project initialization failed:", response.status);
      return false;
    } catch (error) {
      console.error("[OpenCode] Project initialization error:", error);
      return false;
    }
  }

  getSessionUrl(sessionId: string): string {
    return buildSessionUrl(this.serverUrl, sessionId);
  }

  resolveSessionId(iframeUrl: string): string | null {
    const match = iframeUrl.match(/\/session\/([^/?#]+)/);
    return match?.[1] ?? null;
  }

  async createSession(): Promise<string | null> {
    const result = await this.request<OpenCodeSession>("POST", `${API_PREFIX}/session`, {
      title: "Obsidian",
      location: { directory: this.projectDirectory },
    });
    return this.unwrap(result)?.id ?? null;
  }

  /**
   * Push the current workspace context into the session.
   *
   * v2 has no endpoint to update or retract an earlier message, so the context
   * is sent as a synthetic message. The same text is never sent twice in a row,
   * which keeps editor events from flooding the session.
   */
  async updateContext(params: {
    sessionId: string;
    contextText: string | null;
  }): Promise<void> {
    const { sessionId, contextText } = params;

    if (!contextText) {
      return;
    }

    if (this.lastInjectedContext === contextText) {
      return;
    }

    const result = await this.request(
      "POST",
      `${API_PREFIX}/session/${sessionId}/synthetic`,
      { text: contextText }
    );

    if (result) {
      this.lastInjectedContext = contextText;
      console.log("[OpenCode] Injected context message");
    } else {
      console.error("[OpenCode] Failed to inject context message");
    }
  }

  private buildHeaders(hasBody = false): Record<string, string> {
    const headers: Record<string, string> = {};
    if (hasBody) {
      headers["Content-Type"] = "application/json";
    }
    if (this.password) {
      headers["Authorization"] = buildAuthHeader(this.password);
    }
    return headers;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<OpenCodeResponse<T>> {
    try {
      const response = await fetch(`${this.serverUrl}${path}`, {
        method,
        headers: this.buildHeaders(body !== undefined),
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        console.error("[OpenCode] API request failed", {
          path,
          status: response.status,
        });
        return null;
      }

      const json = await response
        .json()
        .catch(() => null);
      return json as OpenCodeResponse<T>;
    } catch (error) {
      console.error("[OpenCode] API request error", error);
      return null;
    }
  }

  private unwrap<T>(result: OpenCodeResponse<T>): T | null {
    if (!result) {
      return null;
    }
    if (typeof result === "object") {
      const payload = result as { data?: T; message?: T };
      if (payload.data) {
        return payload.data;
      }
      if (payload.message) {
        return payload.message;
      }
    }
    return result as T;
  }
}
