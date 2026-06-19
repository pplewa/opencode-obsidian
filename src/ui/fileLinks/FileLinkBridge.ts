import { App } from "obsidian";
import type { OpenCodeWebview } from "../noteDrop/NoteDropBridge";
import { FILE_OPEN_CONSOLE_PREFIX, FILE_OPEN_SCHEME } from "./constants";
import { buildFileLinkBridgeScript } from "./fileLinkScript";
import { openVaultBacklinkOrNotice } from "./openVaultFile";

type WebviewNavigateEvent = Event & {
  url?: string;
  preventDefault?: () => void;
};

type ConsoleMessageEvent = Event & {
  message?: string;
};

export class FileLinkBridge {
  private boundWebview: OpenCodeWebview | null = null;
  private handleDomReady: (() => void) | null = null;
  private handleWillNavigate: ((event: WebviewNavigateEvent) => void) | null = null;
  private handleConsoleMessage: ((event: ConsoleMessageEvent) => void) | null = null;

  constructor(
    private app: App,
    private getProjectDirectory: () => string
  ) {}

  bindWebview(webview: OpenCodeWebview): void {
    this.unbindWebview();
    this.boundWebview = webview;

    this.handleDomReady = () => {
      void this.injectBridgeScript(webview);
    };

    this.handleWillNavigate = (event: WebviewNavigateEvent) => {
      const url = event.url;
      if (!url?.startsWith(`${FILE_OPEN_SCHEME}?`)) {
        return;
      }

      event.preventDefault?.();
      void this.handleOpenUrl(url);
    };

    this.handleConsoleMessage = (event: ConsoleMessageEvent) => {
      const message = event.message;
      if (!message?.startsWith(FILE_OPEN_CONSOLE_PREFIX)) {
        return;
      }

      try {
        const payload = JSON.parse(message.slice(FILE_OPEN_CONSOLE_PREFIX.length)) as {
          file?: string;
          line?: number;
        };
        if (payload.file) {
          void this.openFile(payload.file, payload.line);
        }
      } catch (error) {
        console.warn("[OpenCode] Failed to parse file open message", error);
      }
    };

    webview.addEventListener("dom-ready", this.handleDomReady);
    webview.addEventListener("will-navigate", this.handleWillNavigate as EventListener);
    webview.addEventListener("console-message", this.handleConsoleMessage as EventListener);
  }

  detach(): void {
    this.unbindWebview();
  }

  private unbindWebview(): void {
    if (!this.boundWebview) {
      return;
    }

    if (this.handleDomReady) {
      this.boundWebview.removeEventListener("dom-ready", this.handleDomReady);
    }
    if (this.handleWillNavigate) {
      this.boundWebview.removeEventListener(
        "will-navigate",
        this.handleWillNavigate as EventListener
      );
    }
    if (this.handleConsoleMessage) {
      this.boundWebview.removeEventListener(
        "console-message",
        this.handleConsoleMessage as EventListener
      );
    }

    this.boundWebview = null;
    this.handleDomReady = null;
    this.handleWillNavigate = null;
    this.handleConsoleMessage = null;
  }

  private async injectBridgeScript(webview: OpenCodeWebview): Promise<void> {
    try {
      await webview.executeJavaScript(
        buildFileLinkBridgeScript({
          projectDirectory: this.getProjectDirectory(),
        }),
        false
      );
    } catch (error) {
      console.warn("[OpenCode] Failed to inject file link bridge", error);
    }
  }

  private async handleOpenUrl(url: string): Promise<void> {
    try {
      const parsedUrl = new URL(url);
      const file = parsedUrl.searchParams.get("file");
      if (!file) {
        return;
      }

      const lineParam = parsedUrl.searchParams.get("line");
      const line = lineParam ? Number.parseInt(lineParam, 10) : undefined;
      await this.openFile(file, Number.isFinite(line) ? line : undefined);
    } catch (error) {
      console.warn("[OpenCode] Failed to parse file open URL", error);
    }
  }

  private async openFile(vaultRelativePath: string, line?: number): Promise<void> {
    await openVaultBacklinkOrNotice(this.app, vaultRelativePath, line);
  }
}
