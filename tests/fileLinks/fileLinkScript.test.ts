import { describe, expect, test } from "bun:test";
import path from "path";
import { buildFileLinkBridgeScript } from "../../src/ui/fileLinks/fileLinkScript";
import {
  FILE_OPEN_CONSOLE_PREFIX,
  FILE_OPEN_SCHEME,
} from "../../src/ui/fileLinks/constants";

describe("buildFileLinkBridgeScript", () => {
  test("opens vault-relative paths via console and custom scheme", () => {
    const script = buildFileLinkBridgeScript({
      projectDirectory: path.join("/vault"),
    });

    expect(script).toContain(FILE_OPEN_CONSOLE_PREFIX);
    expect(script).toContain(FILE_OPEN_SCHEME);
    expect(script).toContain("data-oc-file");
    expect(script).toContain("session-turn-diff-path");
    expect(script).not.toContain("cursor:pointer");
  });
});
