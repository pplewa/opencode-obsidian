import { Notice, normalizePath, type App } from "obsidian";

export async function openVaultBacklinkOrNotice(
  app: App,
  vaultRelativePath: string,
  line?: number
): Promise<boolean> {
  const normalized = normalizePath(vaultRelativePath.replace(/^@/, "").trim());
  if (!normalized) {
    return false;
  }

  const candidates = [normalized];
  if (!normalized.endsWith(".md")) {
    candidates.push(`${normalized}.md`);
  }

  for (const candidate of candidates) {
    const resolved = app.metadataCache.getFirstLinkpathDest(candidate, "");
    if (!resolved) {
      continue;
    }

    const linkText =
      line && line > 0 ? `${resolved.path}:${line}` : resolved.path;
    await app.workspace.openLinkText(linkText, "", false);
    return true;
  }

  new Notice(`Note not found in vault: ${normalized}`, 4000);
  return false;
}
