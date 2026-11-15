import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeCommand } from "../../src/commands/remove.js";
import { writeManifest } from "../../src/lib/manifest.js";
import { writeLockfile } from "../../src/lib/lockfile.js";
import { isTrustedSyncedTargetPath } from "../../src/lib/targets.js";

describe("A-13: lockfile syncedTargets cannot trigger arbitrary deletion", () => {
  let sandbox: string;
  let tmpDir: string;
  let origCwd: string;

  beforeEach(async () => {
    // The project lives one level inside a private sandbox so that a "../" payload
    // can never reach the real temp directory if the vulnerability regresses.
    sandbox = await mkdtemp(join(tmpdir(), "skillapt-sec-a13-"));
    tmpDir = join(sandbox, "project");
    await mkdir(tmpDir, { recursive: true });
    await mkdir(join(tmpDir, ".skills", "victim-skill"), { recursive: true });
    process.env.SKILLAPT_DIR = join(tmpDir, ".skills");
    origCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(origCwd);
    delete process.env.SKILLAPT_DIR;
    delete process.env.SKILLAPT_CLAUDE_DIR;
    await rm(sandbox, { recursive: true, force: true });
  });

  it("does not delete paths outside known agent target directories", async () => {
    const precious = join(sandbox, "precious");
    await mkdir(precious, { recursive: true });
    await writeFile(join(precious, "keep.txt"), "important");
    const sameNameElsewhere = join(sandbox, "elsewhere", "victim-skill");
    await mkdir(sameNameElsewhere, { recursive: true });

    await writeManifest({ skills: { "victim-skill": { source: "registry", version: "1.0.0" } } }, tmpDir);
    await writeLockfile(
      {
        lockfileVersion: 2,
        skills: {
          "victim-skill": {
            source: "registry",
            version: "1.0.0",
            sha256: "x",
            syncedTargets: [precious, sameNameElsewhere, join(tmpDir, "..")],
          },
        },
      },
      tmpDir
    );

    await removeCommand("victim-skill");

    expect(existsSync(join(precious, "keep.txt"))).toBe(true);
    expect(existsSync(sameNameElsewhere)).toBe(true);
  });

  it("still cleans a recorded path inside a configured target directory", async () => {
    const targetBase = join(tmpDir, "claude-skills");
    process.env.SKILLAPT_CLAUDE_DIR = targetBase;
    const synced = join(targetBase, "victim-skill");
    await mkdir(synced, { recursive: true });

    await writeManifest({ skills: { "victim-skill": { source: "registry", version: "1.0.0" } } }, tmpDir);
    await writeLockfile(
      {
        lockfileVersion: 2,
        skills: {
          "victim-skill": { source: "registry", version: "1.0.0", sha256: "x", syncedTargets: [synced] },
        },
      },
      tmpDir
    );

    await removeCommand("victim-skill");
    expect(existsSync(synced)).toBe(false);
  });

  it("isTrustedSyncedTargetPath requires basename match and known parent", () => {
    process.env.SKILLAPT_CLAUDE_DIR = join(tmpDir, "t");
    expect(isTrustedSyncedTargetPath(join(tmpDir, "t", "my-skill"), "my-skill")).toBe(true);
    expect(isTrustedSyncedTargetPath(join(tmpDir, "t", "other"), "my-skill")).toBe(false);
    expect(isTrustedSyncedTargetPath(join(tmpDir, "t", "my-skill", "nested"), "my-skill")).toBe(false);
    expect(isTrustedSyncedTargetPath("/", "my-skill")).toBe(false);
    expect(isTrustedSyncedTargetPath("relative/my-skill", "my-skill")).toBe(false);
  });
});
