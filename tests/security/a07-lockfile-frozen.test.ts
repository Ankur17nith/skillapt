import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installCommand } from "../../src/commands/install.js";
import { writeManifest } from "../../src/lib/manifest.js";
import { writeLockfile } from "../../src/lib/lockfile.js";

describe("A-07: Frozen lockfile integrity enforcement", () => {
  let tmpDir: string;
  let skillsDir: string;
  let origCwd: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "skillapt-sec-a07-"));
    skillsDir = join(tmpDir, ".skills");
    process.env.SKILLAPT_DIR = skillsDir;
    origCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(origCwd);
    delete process.env.SKILLAPT_DIR;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("fails if a package argument is provided with --frozen", async () => {
    await expect(installCommand("any-package", { frozen: true })).rejects.toThrow(
      "Cannot specify a package source when running with --frozen"
    );
  });

  it("fails if lockfile is missing when --frozen is specified", async () => {
    await writeManifest({ skills: { "pkg-a": { source: "pkg-a" } } }, tmpDir);
    await expect(installCommand(undefined, { frozen: true })).rejects.toThrow(
      "Lockfile skills.lock.json not found"
    );
  });

  it("fails if lockfile is out of sync with manifest", async () => {
    await writeManifest(
      {
        skills: {
          "pkg-a": { source: "pkg-a", version: "1.0.0" },
          "pkg-b": { source: "pkg-b", version: "1.0.0" },
        },
      },
      tmpDir
    );
    await writeLockfile(
      {
        lockfileVersion: 2,
        skills: {
          "pkg-a": { source: "registry", version: "1.0.0", sha256: "deadbeef" },
        },
      },
      tmpDir
    );

    await expect(installCommand(undefined, { frozen: true })).rejects.toThrow(
      "skills.lock.json is out of sync with skills.json. Missing: pkg-b"
    );
  });

  it("fails if locked registry entry is missing sha256 checksum", async () => {
    await writeManifest(
      {
        skills: {
          "pkg-a": { source: "pkg-a", version: "1.0.0" },
        },
      },
      tmpDir
    );
    await writeLockfile(
      {
        lockfileVersion: 2,
        skills: {
          "pkg-a": { source: "registry", version: "1.0.0" },
        },
      },
      tmpDir
    );

    await expect(installCommand(undefined, { frozen: true })).rejects.toThrow(
      'Lockfile entry for "pkg-a" is missing sha256 checksum'
    );
  });

  it("fails if locked GitHub entry is missing commit sha", async () => {
    await writeManifest(
      {
        skills: {
          "gh-pkg": { source: "owner/repo" },
        },
      },
      tmpDir
    );
    await writeLockfile(
      {
        lockfileVersion: 2,
        skills: {
          "gh-pkg": { source: "owner/repo" },
        },
      },
      tmpDir
    );

    await expect(installCommand(undefined, { frozen: true })).rejects.toThrow(
      'Lockfile entry for "gh-pkg" is missing commit sha'
    );
  });
});
