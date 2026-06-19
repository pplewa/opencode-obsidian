import { App, Notice, TFile } from "obsidian";
import { OPENCODE_VIEW_TYPE } from "../../types";
import { vaultFileToProjectPath } from "./pathUtils";

export type OpenCodeWebview = HTMLElement & {
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
};

const FILE_DROP_PREFIX = "file:";

function getVaultRoot(app: App): string {
  const adapter = app.vault.adapter as { basePath?: string };
  return adapter.basePath ?? "";
}

function getFilesFromDragTarget(app: App, event: DragEvent): TFile[] {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return [];
  }

  const fileEl = target.closest(".nav-file");
  const filePath = fileEl?.getAttribute("data-path");
  if (!filePath) {
    return [];
  }

  const file = app.vault.getAbstractFileByPath(filePath);
  return file instanceof TFile ? [file] : [];
}

function getFilesFromDragManager(app: App): TFile[] {
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

function getFilesFromDrag(app: App, event?: DragEvent): TFile[] {
  const fromManager = getFilesFromDragManager(app);
  if (fromManager.length > 0) {
    return fromManager;
  }
  if (event) {
    return getFilesFromDragTarget(app, event);
  }
  return [];
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
  private pendingPaths: string[] = [];
  private webviewReady = false;
  private unregisterDocumentEvents: (() => void) | null = null;
  private unregisterOverlayEvents: (() => void) | null = null;

  constructor(
    private app: App,
    private getProjectDirectory: () => string,
    private getWebview: () => OpenCodeWebview | null,
    private appendPromptReference?: (relativePath: string) => Promise<boolean>
  ) {}

  attach(container: HTMLElement): void {
    this.overlayEl = container.createDiv({ cls: "opencode-drop-overlay" });
    this.overlayEl.createSpan({
      cls: "opencode-drop-overlay-label",
      text: "Drop note to reference in chat",
    });

    this.unregisterDocumentEvents = this.registerDragTracking();
    this.unregisterOverlayEvents = this.registerOverlayEvents();
  }

  detach(): void {
    this.unregisterDocumentEvents?.();
    this.unregisterDocumentEvents = null;
    this.unregisterOverlayEvents?.();
    this.unregisterOverlayEvents = null;
    this.overlayEl = null;
    this.dragActive = false;
    this.pendingPaths = [];
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

  private isOpenCodeViewOpen(): boolean {
    return this.app.workspace.getLeavesOfType(OPENCODE_VIEW_TYPE).length > 0;
  }

  private registerDragTracking(): () => void {
    const handleDragStart = (event: DragEvent): void => {
      if (!this.isOpenCodeViewOpen()) {
        return;
      }

      const files = getFilesFromDrag(this.app, event);
      if (files.length === 0) {
        return;
      }

      const paths = this.resolveProjectPaths(files);
      if (paths.length === 0) {
        return;
      }

      this.pendingPaths = paths;
      event.dataTransfer?.setData("text/plain", `${FILE_DROP_PREFIX}${paths[0]}`);

      this.dragActive = true;
      this.updateOverlayState(false);

      if (paths.length > 1) {
        new Notice(
          "Multiple notes were dragged; only the first will be referenced. Drop one note at a time to reference each file.",
          5000
        );
      }
    };

    const handleDragEnd = (): void => {
      this.dragActive = false;
      this.pendingPaths = [];
      this.updateOverlayState(false);
    };

    document.addEventListener("dragstart", handleDragStart, false);
    document.addEventListener("dragend", handleDragEnd, false);

    return () => {
      document.removeEventListener("dragstart", handleDragStart, false);
      document.removeEventListener("dragend", handleDragEnd, false);
    };
  }

  private registerOverlayEvents(): () => void {
    const overlay = this.overlayEl;
    if (!overlay) {
      return () => undefined;
    }

    const handleDragEnter = (event: DragEvent): void => {
      if (!this.dragActive) {
        return;
      }
      event.preventDefault();
      this.updateOverlayState(true);
    };

    const handleDragOver = (event: DragEvent): void => {
      if (!this.dragActive) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
      this.updateOverlayState(true);
    };

    const handleDragLeave = (event: DragEvent): void => {
      if (!this.dragActive) {
        return;
      }
      if (event.relatedTarget instanceof Node && overlay.contains(event.relatedTarget)) {
        return;
      }
      this.updateOverlayState(false);
    };

    const handleDrop = (event: DragEvent): void => {
      if (!this.dragActive || this.pendingPaths.length === 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.dragActive = false;
      this.updateOverlayState(false);
      void this.handleDrop(this.pendingPaths);
      this.pendingPaths = [];
    };

    overlay.addEventListener("dragenter", handleDragEnter);
    overlay.addEventListener("dragover", handleDragOver);
    overlay.addEventListener("dragleave", handleDragLeave);
    overlay.addEventListener("drop", handleDrop);

    return () => {
      overlay.removeEventListener("dragenter", handleDragEnter);
      overlay.removeEventListener("dragover", handleDragOver);
      overlay.removeEventListener("dragleave", handleDragLeave);
      overlay.removeEventListener("drop", handleDrop);
    };
  }

  private updateOverlayState(highlight: boolean): void {
    const overlay = this.overlayEl;
    if (!overlay) {
      return;
    }

    overlay.toggleClass("is-visible", this.dragActive);
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

  private async handleDrop(paths: string[]): Promise<void> {
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
      return;
    } catch (error) {
      console.warn("[OpenCode] File drop injection failed, trying append-prompt", error);
    }

    if (this.appendPromptReference) {
      const appended = await this.appendPromptReference(paths[0]);
      if (appended) {
        return;
      }
    }

    new Notice("Could not add note reference to OpenCode chat.", 5000);
  }
}
