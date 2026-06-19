import * as path from "path";
import type { App } from "obsidian";

export function getVaultRoot(app: App): string {
  const adapter = app.vault.adapter as { basePath?: string };
  return adapter.basePath ?? "";
}

export function toProjectRelativePath(
  absoluteFilePath: string,
  projectDirectory: string
): string | null {
  const projectRoot = path.resolve(projectDirectory);
  const absolutePath = path.resolve(absoluteFilePath);

  const relative = path.relative(projectRoot, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return relative.split(path.sep).join("/");
}

export function vaultFileToProjectPath(
  vaultRelativePath: string,
  vaultRoot: string,
  projectDirectory: string
): string | null {
  const absolutePath = path.join(vaultRoot, vaultRelativePath);
  return toProjectRelativePath(absolutePath, projectDirectory);
}

export function projectPathToVaultPath(
  projectRelativePath: string,
  vaultRoot: string,
  projectDirectory: string
): string | null {
  const absolutePath = path.resolve(projectDirectory, projectRelativePath);
  const vaultResolved = path.resolve(vaultRoot);
  const relative = path.relative(vaultResolved, absolutePath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return relative.split(path.sep).join("/");
}
