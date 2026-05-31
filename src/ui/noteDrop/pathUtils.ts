import * as path from "path";

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
