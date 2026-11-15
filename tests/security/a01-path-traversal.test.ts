import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertInside } from "../../src/lib/fs.js";
import { isValidGitHubSource, isValidRegistryName } from "../../src/lib/source.js";

describe("A-01: Path traversal protection", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "skillapt-sec-a01-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("assertInside rejects escaping paths and directory boundary prefixes", () => {
    const base = join(tmpDir, "base");
    expect(() => assertInside(base, join(tmpDir, "base-other"))).toThrow(/escapes/i);
    expect(() => assertInside(base, join(tmpDir, "base", "..", "victim"))).toThrow(/escapes/i);
    expect(() => assertInside(base, "../../victim")).toThrow(/escapes/i);
    expect(() => assertInside(base, "/etc/passwd")).toThrow(/escapes/i);
    expect(() => assertInside(base, "..\\..\\victim")).toThrow(/escapes/i);
    expect(assertInside(base, join(base, "safe-dir"))).toBe(join(base, "safe-dir"));
  });

  it("isValidGitHubSource rejects traversal segments in repo sources", () => {
    expect(isValidGitHubSource("..")).toBe(false);
    expect(isValidGitHubSource("../repo")).toBe(false);
    expect(isValidGitHubSource("owner/..")).toBe(false);
    expect(isValidGitHubSource("owner/../victim")).toBe(false);
    expect(isValidGitHubSource("./repo")).toBe(false);
    expect(isValidGitHubSource("owner/repo")).toBe(true);
  });

  it("isValidRegistryName rejects traversal segments and double hyphens", () => {
    expect(isValidRegistryName("../../victim")).toBe(false);
    expect(isValidRegistryName("../victim")).toBe(false);
    expect(isValidRegistryName("valid-skill")).toBe(true);
    expect(isValidRegistryName("@scope/valid-skill")).toBe(true);
    expect(isValidRegistryName("invalid--name")).toBe(false);
  });
});
