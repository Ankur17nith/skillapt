import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { assertInside } from "../src/lib/fs.js";
import { installSingle } from "../src/commands/install.js";
import { isValidRegistryName, isValidGitHubSource } from "../src/lib/source.js";
import * as github from "../src/lib/github.js";
import { create } from "tar";

function fileToWebStream(filePath: string): ReadableStream<Uint8Array> {
  const nodeStream = createReadStream(filePath);
  return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
}

describe("assertInside and path traversal protection", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "skillapt-traversal-test-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("assertInside accepts paths strictly inside baseDir", () => {
    const base = join(tmpDir, "base");
    const valid = join(base, "sub", "file.txt");
    expect(assertInside(base, "sub/file.txt")).toBe(valid);
    expect(assertInside(base, valid)).toBe(valid);
  });

  it("assertInside rejects path traversal escaping baseDir with '..'", () => {
    const base = join(tmpDir, "base");
    expect(() => assertInside(base, "../../victim")).toThrow("escapes base directory");
    expect(() => assertInside(base, "../base")).toThrow("escapes base directory");
    expect(() => assertInside(base, "sub/../../victim")).toThrow("escapes base directory");
  });

  it("assertInside rejects base directory itself", () => {
    const base = join(tmpDir, "base");
    expect(() => assertInside(base, ".")).toThrow("escapes base directory");
    expect(() => assertInside(base, "")).toThrow("escapes base directory");
    expect(() => assertInside(base, "   ")).toThrow("escapes base directory");
    expect(() => assertInside(base, base)).toThrow("escapes base directory");
  });

  it("assertInside rejects absolute paths outside baseDir", () => {
    const base = join(tmpDir, "base");
    expect(() => assertInside(base, "/etc/passwd")).toThrow("escapes base directory");
    expect(() => assertInside(base, "/tmp/victim")).toThrow("escapes base directory");
  });

  it("assertInside rejects backslash traversal", () => {
    const base = join(tmpDir, "base");
    expect(() => assertInside(base, "..\\..\\victim")).toThrow("escapes base directory");
    expect(() => assertInside(base, "sub\\..\\..\\victim")).toThrow("escapes base directory");
  });

  it("assertInside rejects prefix collisions without directory separator", () => {
    const base = join(tmpDir, "base");
    const evil = join(tmpDir, "base-evil");
    expect(() => assertInside(base, evil)).toThrow("escapes base directory");
  });

  it("assertInside rejects over-long escaping paths", () => {
    const base = join(tmpDir, "base");
    const longEscape = "../" + "a".repeat(300);
    expect(() => assertInside(base, longEscape)).toThrow("escapes base directory");
  });

  it("unit-tests name and source validation on '..', absolute, backslash, empty, over-long, '@a/b'", () => {
    // Empty strings
    expect(isValidRegistryName("")).toBe(false);
    expect(isValidGitHubSource("")).toBe(false);

    // ".." and "."
    expect(isValidRegistryName("..")).toBe(false);
    expect(isValidRegistryName("../victim")).toBe(false);
    expect(isValidRegistryName("../../victim")).toBe(false);
    expect(isValidRegistryName(".")).toBe(false);
    expect(isValidGitHubSource("..")).toBe(false);
    expect(isValidGitHubSource("../repo")).toBe(false);
    expect(isValidGitHubSource("owner/..")).toBe(false);
    expect(isValidGitHubSource(".")).toBe(false);
    expect(isValidGitHubSource("owner/.")).toBe(false);
    expect(isValidGitHubSource("./repo")).toBe(false);

    // Absolute paths
    expect(isValidRegistryName("/etc/passwd")).toBe(false);
    expect(isValidRegistryName("/tmp/victim")).toBe(false);
    expect(isValidGitHubSource("/owner/repo")).toBe(false);

    // Backslashes
    expect(isValidRegistryName("foo\\bar")).toBe(false);
    expect(isValidRegistryName("..\\victim")).toBe(false);
    expect(isValidGitHubSource("owner\\repo")).toBe(false);

    // Over-long names
    const longName = "a".repeat(51);
    expect(isValidRegistryName(longName)).toBe(false);
    const longScope = "@" + "a".repeat(31) + "/valid-name";
    expect(isValidRegistryName(longScope)).toBe(false);

    // "@a/b"
    // Valid scope: @alice/pdf-tool (scope 2..30 chars, name 3..50)
    expect(isValidRegistryName("@alice/pdf-tool")).toBe(true);
    // Invalid scope: @a/b (scope only 1 char "a", name only 1 char "b")
    expect(isValidRegistryName("@a/b")).toBe(false);
    // Double hyphen in scope or name (D-003)
    expect(isValidRegistryName("@ali--ce/tool")).toBe(false);
    expect(isValidRegistryName("my--tool")).toBe(false);
  });

  it("tarball whose skill.json name is '../../victim' ignores invalid name and leaves victim directory untouched", async () => {
    // Setup victim directory with important file
    const victimDir = join(tmpDir, "victim");
    await mkdir(victimDir, { recursive: true });
    const canaryFile = join(victimDir, "canary.txt");
    await writeFile(canaryFile, "IMPORTANT DATA - DO NOT DELETE", "utf-8");

    // Setup working directory and skillsDir
    const workDir = join(tmpDir, "workspace");
    const skillsDir = join(workDir, ".skills");
    await mkdir(skillsDir, { recursive: true });

    // Create a malicious tarball with skill.json having name "../../victim"
    // and valid SKILL.md
    const repoDir = join(tmpDir, "my-repo-123");
    await mkdir(repoDir, { recursive: true });
    await writeFile(
      join(repoDir, "skill.json"),
      JSON.stringify({ name: "../../victim", version: "1.0.0" }),
      "utf-8"
    );
    await writeFile(
      join(repoDir, "SKILL.md"),
      "---\nname: malicious-repo\ndescription: Malicious skill test\n---\n# Malicious Skill\nAttacking victim directory.",
      "utf-8"
    );

    const maliciousTar = join(tmpDir, "malicious.tar.gz");
    await create(
      {
        gzip: true,
        file: maliciousTar,
        cwd: tmpDir,
      },
      ["my-repo-123"]
    );

    // Mock github.resolveRef and github.downloadTarball
    vi.spyOn(github, "resolveRef").mockResolvedValue("abcdef1234567890");
    vi.spyOn(github, "downloadTarball").mockImplementation(async () => {
      return fileToWebStream(maliciousTar);
    });

    // Mock process.cwd to be the workspace
    const originalCwd = process.cwd();
    process.chdir(workDir);

    try {
      // Install the malicious github repo — it should ignore "../../victim", warn, and use "malicious-repo"
      await installSingle("attacker/malicious-repo");

      // Verify that the victim directory and canary file are UNTOUCHED
      expect(existsSync(victimDir)).toBe(true);
      expect(existsSync(canaryFile)).toBe(true);
      const content = await readFile(canaryFile, "utf-8");
      expect(content).toBe("IMPORTANT DATA - DO NOT DELETE");

      // Verify it was safely installed under default folder name "malicious-repo" inside skillsDir
      expect(existsSync(join(skillsDir, "malicious-repo"))).toBe(true);
      expect(existsSync(join(skillsDir, "victim"))).toBe(false);
    } finally {
      process.chdir(originalCwd);
    }
  });
});
