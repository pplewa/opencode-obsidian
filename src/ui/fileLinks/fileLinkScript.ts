import {
  FILE_OPEN_CONSOLE_PREFIX,
  FILE_OPEN_SCHEME,
  type FileLinkBridgeConfig,
} from "./constants";

export function buildFileLinkBridgeScript(config: FileLinkBridgeConfig): string {
  const projectDirectory = config.projectDirectory.replace(/\\/g, "/").replace(/\/$/, "");
  return `(function(){
    const CONSOLE_PREFIX = ${JSON.stringify(FILE_OPEN_CONSOLE_PREFIX)};
    const OPEN_SCHEME = ${JSON.stringify(FILE_OPEN_SCHEME)};
    const PROJECT_DIR = ${JSON.stringify(projectDirectory)};
    const VERSION = 2;

    if (window.__ocFileLinks?.version === VERSION) return;
    window.__ocFileLinks?.cleanup?.();

    const PATH_RE =
      /(?:@)?(?:[A-Za-z0-9_.][A-Za-z0-9_. -]*(?:[\\\\/][A-Za-z0-9_. -]+)+|[A-Za-z0-9_.][A-Za-z0-9_. -]*)\\.(?:md|markdown|txt|pdf|png|jpe?g|gif|webp|canvas|json|ya?ml|ts|tsx|js|jsx|css|html|csv|excalidraw|svg)(?::\\d+(?:-\\d+)?)?/gi;

    function parseRef(raw) {
      let t = (raw || "").trim().replace(/[.,;:!?]+$/, "");
      if (!t || /^https?:\\/\\//i.test(t)) return null;
      if (t.startsWith("@")) t = t.slice(1);
      if (t.startsWith("file://")) t = t.slice(7);
      else if (t.startsWith("file:")) t = t.slice(5);
      t = t.replace(/\\\\/g, "/").trim();
      if (!t) return null;

      let line;
      const lineMatch = t.match(/^(.+):(\\d+)(?:-\\d+)?$/);
      if (lineMatch && !/^[a-zA-Z]:$/.test(lineMatch[1])) {
        t = lineMatch[1];
        line = parseInt(lineMatch[2], 10);
      }
      if (!/\\.[a-z0-9]{1,10}$/i.test(t)) return null;
      if (!t.includes("/") && !/\\.(md|markdown|txt)$/i.test(t)) return null;
      return { file: t, line: line };
    }

    function toVaultRelative(filePath) {
      let p = filePath.replace(/^@/, "").replace(/\\\\/g, "/").trim();
      if (p.startsWith("file:")) p = p.slice(p.startsWith("file://") ? 7 : 5);
      const root = PROJECT_DIR.toLowerCase();
      if (p.toLowerCase().startsWith(root + "/")) {
        p = p.slice(PROJECT_DIR.length).replace(/^\\/+/, "");
      }
      return p;
    }

    function notifyOpen(filePath, line) {
      const file = toVaultRelative(filePath);
      if (!file) return;
      const payload = JSON.stringify({ file: file, line: line || undefined });
      console.log(CONSOLE_PREFIX + payload);
      const params = new URLSearchParams({ file: file });
      if (line) params.set("line", String(line));
      window.location.href = OPEN_SCHEME + "?" + params.toString();
    }

    function stripMarks(text) {
      return (text || "").replace(/[\\u202A-\\u202E\\u2066-\\u2069]/g, "");
    }

    function markPath(el, ref) {
      el.setAttribute("data-oc-file", ref.file);
      if (ref.line) el.setAttribute("data-oc-line", String(ref.line));
    }

    function decorateTextNode(node) {
      const text = node.textContent || "";
      PATH_RE.lastIndex = 0;
      if (!PATH_RE.test(text)) return;

      const parent = node.parentElement;
      if (!parent || parent.closest("[data-oc-file]")) return;

      PATH_RE.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let lastIndex = 0;
      let match;
      while ((match = PATH_RE.exec(text)) !== null) {
        const ref = parseRef(match[0]);
        if (!ref) continue;
        if (match.index > lastIndex) {
          frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        }
        const span = document.createElement("span");
        markPath(span, ref);
        span.textContent = match[0];
        frag.appendChild(span);
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex === 0) return;
      if (lastIndex < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex)));
      }
      parent.replaceChild(frag, node);
    }

    function scanRoot(root) {
      if (!(root instanceof Element)) return;

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: function(node) {
          const parent = node.parentElement;
          if (!parent || parent.closest("script, style, [data-oc-file]")) {
            return NodeFilter.FILTER_REJECT;
          }
          if (parent.closest('[data-slot="session-turn-diff-path"]')) {
            return NodeFilter.FILTER_REJECT;
          }
          if (parent.closest("code, a, button, [role=button]")) {
            return NodeFilter.FILTER_REJECT;
          }
          PATH_RE.lastIndex = 0;
          return PATH_RE.test(node.textContent || "")
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      });

      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(decorateTextNode);
    }

    function readMarkedReference(target) {
      const el = target.closest("[data-oc-file]");
      if (!(el instanceof Element)) return null;
      const file = el.getAttribute("data-oc-file");
      if (!file) return null;
      const lineValue = el.getAttribute("data-oc-line");
      return {
        file: file,
        line: lineValue ? parseInt(lineValue, 10) : undefined,
      };
    }

    function readDiffFilePath(trigger) {
      const item = trigger.closest('[data-slot="accordion-item"]');
      const value = item?.getAttribute("data-value");
      if (value) {
        const ref = parseRef(stripMarks(value));
        if (ref) return ref;
      }

      const pathEl = trigger.querySelector('[data-slot="session-turn-diff-path"]');
      if (!pathEl) return null;

      const dir = stripMarks(pathEl.querySelector('[data-slot="session-turn-diff-directory"]')?.textContent || "");
      const name = stripMarks(pathEl.querySelector('[data-slot="session-turn-diff-filename"]')?.textContent || "");
      const combined = (dir + name).trim() || stripMarks(pathEl.textContent || "").trim();
      return combined ? parseRef(combined) : null;
    }

    function extractFromClick(event) {
      const target = event.target;
      if (!(target instanceof Element)) return null;

      const marked = readMarkedReference(target);
      if (marked) return marked;

      const diffPath = target.closest(
        '[data-slot="session-turn-diff-path"], [data-slot="session-turn-diff-filename"], [data-slot="session-turn-diff-directory"]'
      );
      if (diffPath) {
        const trigger = diffPath.closest('[data-slot="session-turn-diff-trigger"]');
        if (trigger) return readDiffFilePath(trigger);
      }

      return null;
    }

    function onClick(event) {
      const ref = extractFromClick(event);
      if (!ref) return;
      event.preventDefault();
      event.stopPropagation();
      notifyOpen(ref.file, ref.line);
    }

    scanRoot(document.body);

    const observer = new MutationObserver(function(mutations) {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach(function(node) {
          if (node.nodeType === Node.ELEMENT_NODE) scanRoot(node);
          else if (node.nodeType === Node.TEXT_NODE && node.parentElement) {
            scanRoot(node.parentElement);
          }
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("click", onClick, true);

    window.__ocFileLinks = {
      version: VERSION,
      cleanup: function() {
        observer.disconnect();
        document.removeEventListener("click", onClick, true);
      },
    };
  })();`;
}
