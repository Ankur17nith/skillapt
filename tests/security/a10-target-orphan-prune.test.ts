import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeCommand } from "../../src/commands/remove.js";
import { writeManifest, readManifest } from "../../src/lib/manifest.js";
import { writeLockfile, readLockfile } from "../../src/lib/lockfile.js";

describe("A-10: Target sync cleanup and orphan dependency pruning", () => {
  let tmpDir: string;
  let skillsDir: string;
  let origCwd: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "skillapt-sec-a10-"));
    skillsDir = join(tmpDir, ".skills");
    await mkdir(skillsDir, { recursive: true });
    process.env.SKILLAPT_DIR = skillsDir;
    origCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(origCwd);
    delete process.env.SKILLAPT_DIR;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("removes recorded synced targets and prunes unreachable orphaned dependencies on remove", async () => {
    // Setup:
    // manifest: root-skill
    // lockfile: root-skill (depends on child-dep) and child-dep
    // syncedTargets created on disk for both
    const customTargetRoot = join(tmpDir, "custom-target", "root-skill");
    const customTargetChild = join(tmpDir, "custom-target", "child-dep");
    await mkdir(join(tmpDir, "custom-target"), { recursive: true });
    await writeFile(customTargetRoot, "dummy-root");
    await writeFile(customTargetChild, "dummy-child");

    const rootSkillDir = join(skillsDir, "root-skill");
    const childDepDir = join(skillsDir, "child-dep");
    await mkdir(rootSkillDir, { recursive: true });
    await mkdir(childDepDir, { recursive: true });

    await writeManifest(
      {
        skills: {
          "root-skill": { source: "root-skill", version: "1.0.0" },
        },
      },
      tmpDir
    );

    await writeLockfile(
      {
        lockfileVersion: 2,
        skills: {
          "root-skill": {
            source: "registry",
            version: "1.0.0",
            sha256: "sha-root",
            dependencies: { "child-dep": "1.0.0" },
            syncedTargets: [customTargetRoot],
          },
          "child-dep": {
            source: "registry",
            version: "1.0.0",
            sha256: "sha-child",
            syncedTargets: [customTargetChild],
          },
        },
      },
      tmpDir
    );

    await removeCommand("root-skill");

    // Check files are deleted
    expect(existsSync(rootSkillDir)).toBe(false);
    expect(existsSync(childDepDir)).toBe(false);
    expect(existsSync(customTargetRoot)).toBe(false);
    expect(existsSync(customTargetChild)).toBe(false);

    // Check manifest and lockfile
    const manifest = await readManifest(tmpDir);
    expect(manifest.skills["root-skill"]).toBeUndefined();

    const lockfile = await readLockfile(tmpDir);
    expect(lockfile.skills["root-skill"]).toBeUndefined();
    expect(lockfile.skills["child-dep"]).toBeUndefined();
  });
});
