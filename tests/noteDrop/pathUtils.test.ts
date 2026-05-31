import { describe, expect, test } from "bun:test";
import path from "path";
import { toProjectRelativePath, vaultFileToProjectPath } from "../../src/ui/noteDrop/pathUtils";

describe("toProjectRelativePath", () => {
  test("returns a forward-slash path for files inside the project", () => {
    const project = path.join("/vault");
    const file = path.join("/vault", "Notes", "Daily.md");

    expect(toProjectRelativePath(file, project)).toBe("Notes/Daily.md");
  });

  test("returns null for files outside the project", () => {
    const project = path.join("/vault");
    const file = path.join("/other", "Notes", "Daily.md");

    expect(toProjectRelativePath(file, project)).toBeNull();
  });
});

describe("vaultFileToProjectPath", () => {
  test("maps vault-relative paths into project-relative paths", () => {
    const vaultRoot = path.join("/vault");
    const project = path.join("/vault");

    expect(vaultFileToProjectPath("Projects/Spec.md", vaultRoot, project)).toBe(
      "Projects/Spec.md"
    );
  });
});
