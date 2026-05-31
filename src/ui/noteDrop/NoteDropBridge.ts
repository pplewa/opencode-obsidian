import { App, Notice, TFile } from "obsidian";
import { vaultFileToProjectPath } from "./pathUtils";

export type OpenCodeWebview = HTMLElement & {
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
};

const FILE_DROP_PREFIX = "file:";

function getVaultRoot(app: App): string {
  const adapter = app.vault.adapter as { basePath?: string };
  return adapter.basePath ?? "";
}

function getFilesFromDrag(app: App): TFile[] {
  const draggable = (app as { dragManager?: { draggable?: DraggablePayload } }).dragManager
    ?.draggable;
  if (!draggable) {
    return [];
  }

  switch (draggable.type) {
    case "file":
    case "link":
      return draggable.file ? [draggable.file] : [];
    case "files":
      return draggable.files ?? [];
    default:
      return [];
  }
}

type DraggablePayload =
  | { type: "file" | "link"; file: TFile }
  | { type: "files"; files: TFile[] };

function buildFileDropScript(paths: string[]): string {
  return `(function(){
    const paths = ${JSON.stringify(paths)};
    for (const filePath of paths) {
      const dt = new DataTransfer();
      dt.setData("text/plain", ${JSON.stringify(FILE_DROP_PREFIX)} + filePath);
      document.dispatchEvent(new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
      }));
    }
  })();`;
}

export class NoteDropBridge {
  private overlayEl: HTMLElement | null = null;
  private dragActive = false;
  private webviewReady = false;
  private unregisterDocumentEvents: (() => void) | null = null;

  constructor(
    private app: App,
    private getProjectDirectory: () => string,
    private getWebview: () => OpenCodeWebview | null
  ) {}

  attach(container: HTMLElement): void {
    this.overlayEl = container.createDiv({ cls: "opencode-drop-overlay" });
    this.overlayEl.createSpan({ cls: "opencode-drop-overlay-label", text: "Drop note to reference in chat" });

    this.unregisterDocumentEvents = this.registerDragTracking();
    this.registerOverlayEvents();
  }

  detach(): void {
    this.unregisterDocumentEvents?.();
    this.unregisterDocumentEvents = null;
    this.overlayEl = null;
    this.dragActive = false;
    this.webviewReady = false;
  }

  bindWebview(webview: OpenCodeWebview): void {
    this.webviewReady = false;
    webview.addEventListener("dom-ready", () => {
      this.webviewReady = true;
    });
  }

  onWebviewNavigate(): void {
    this.webviewReady = false;
  }

  private registerDragTracking(): () => void {
    const handleDragStart = (): void => {
      requestAnimationFrame(() => {
        const files = getFilesFromDrag(this.app);
        if (files.length === 0) {
          return;
        }
        this.dragActive = true;
        this.updateOverlayState(false);
      });
    };

    const handleDragEnd = (): void => {
      this.dragActive = false;
      this.updateOverlayState(false);
    };

    document.addEventListener("dragstart", handleDragStart, true);
    document.addEventListener("dragend", handleDragEnd, true);

    return () => {
      document.removeEventListener("dragstart", handleDragStart, true);
      document.removeEventListener("dragend", handleDragEnd, true);
    };
  }

  private registerOverlayEvents(): void {
    const overlay = this.overlayEl;
    if (!overlay) {
      return;
    }

    overlay.addEventListener("dragenter", (event) => {
      if (!this.dragActive) {
        return;
      }
      event.preventDefault();
      this.updateOverlayState(true);
    });

    overlay.addEventListener("dragover", (event) => {
      if (!this.dragActive) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
      this.updateOverlayState(true);
    });

    overlay.addEventListener("dragleave", (event) => {
      if (!this.dragActive) {
        return;
      }
      if (event.relatedTarget instanceof Node && overlay.contains(event.relatedTarget)) {
        return;
      }
      this.updateOverlayState(false);
    });

    overlay.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.dragActive = false;
      this.updateOverlayState(false);
      void this.handleDrop();
    });
  }

  private updateOverlayState(highlight: boolean): void {
    const overlay = this.overlayEl;
    if (!overlay) {
      return;
    }

    overlay.toggleClass("is-active", this.dragActive);
    overlay.toggleClass("is-targeted", this.dragActive && highlight);
  }

  private resolveProjectPaths(files: TFile[]): string[] {
    const vaultRoot = getVaultRoot(this.app);
    const projectDirectory = this.getProjectDirectory();
    const paths: string[] = [];
    const skipped: string[] = [];

    for (const file of files) {
      const relativePath = vaultFileToProjectPath(file.path, vaultRoot, projectDirectory);
      if (!relativePath) {
        skipped.push(file.path);
        continue;
      }
      paths.push(relativePath);
    }

    if (skipped.length > 0) {
      new Notice(
        `Skipped ${skipped.length} item(s) outside the OpenCode project directory.`,
        5000
      );
    }

    return paths;
  }

  private async handleDrop(): Promise<void> {
    const files = getFilesFromDrag(this.app);
    if (files.length === 0) {
      return;
    }

    const paths = this.resolveProjectPaths(files);
    if (paths.length === 0) {
      return;
    }

    const webview = this.getWebview();
    if (!webview) {
      new Notice("OpenCode is not ready yet.", 4000);
      return;
    }

    if (!this.webviewReady) {
      new Notice("OpenCode is still loading. Try again in a moment.", 4000);
      return;
    }

    try {
      await webview.executeJavaScript(buildFileDropScript(paths), true);
    } catch (error) {
      console.error("[OpenCode] Failed to inject file reference(s)", error);
      new Notice("Could not add note reference to OpenCode chat.", 5000);
    }
  }
}
