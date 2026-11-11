import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installCommand } from "../src/commands/install.js";
import { updateCommand } from "../src/commands/update.js";
import { removeCommand } from "../src/commands/remove.js";
import { outdatedCommand } from "../src/commands/outdated.js";
import { writeManifest, readManifest } from "../src/lib/manifest.js";
import { writeLockfile, readLockfile } from "../src/lib/lockfile.js";
import { syncSkillToTarget } from "../src/lib/targets.js";
import * as github from "../src/lib/github.js";
import * as extractModule from "../src/lib/extract.js";
import { RegistryClient } from "../src/lib/registry.js";

describe("Install, lockfile, update, and remove logic", () => {
  let tmpDir: string;
  let skillsDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "skillapt-logic-test-"));
    skillsDir = join(tmpDir, ".skills");
    await mkdir(skillsDir, { recursive: true });
    process.env.SKILLAPT_DIR = skillsDir;
  });

  afterEach(async () => {
    delete process.env.SKILLAPT_DIR;
    vi.restoreAllMocks();
    process.exitCode = undefined;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("install without arguments installs locked skills AND missing manifest skills", async () => {
    // 1. Setup manifest with 2 skills: "locked-skill" and "missing-skill"
    await writeManifest(
      {
        skills: {
          "locked-skill": { source: "locked-skill", version: "1.0.0" },
          "missing-skill": { source: "missing-skill", version: "2.0.0" },
        },
      },
      tmpDir
    );

    // 2. Setup lockfile with ONLY "locked-skill"
    await writeLockfile(
      {
        lockfileVersion: 2,
        skills: {
          "locked-skill": {
            source: "registry",
            version: "1.0.0",
            sha256: "aabbccdd11223344",
          },
        },
      },
      tmpDir
    );

    // Mock RegistryClient and extractSkill
    const extractSpy = vi.spyOn(extractModule, "extractSkill").mockResolvedValue(skillsDir);
    vi.spyOn(RegistryClient.prototype, "downloadTarball").mockResolvedValue({
      stream: new ReadableStream(),
      sha256: "aabbccdd11223344",
    });

    // Mock dependency resolver for missing-skill
    vi.spyOn(RegistryClient.prototype, "getSkill").mockResolvedValue({
      name: "missing-skill",
      description: "Missing",
      license: "MIT",
      category: "tools" as any,
      compatibility: ["claude"],
      owner: { handle: "alex" },
      latestVersion: "2.0.0",
      downloads: 1,
      createdAt: "",
      updatedAt: "",
      versions: {
        "2.0.0": {
          version: "2.0.0",
          sha256: "11223344aabbccdd",
          size: 100,
          tarballUrl: "https://example.com/missing.tgz",
          dependencies: {},
          publishedAt: "",
          yanked: false,
          permissions: { network: false, shell: false, filesystem: "none" },
        },
      },
    });

    const origCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      await installCommand(undefined, { yes: true });

      // Both locked-skill and missing-skill should have been extracted
      expect(extractSpy).toHaveBeenCalledWith(
        expect.objectContaining({ name: "locked-skill" })
      );
      expect(extractSpy).toHaveBeenCalledWith(
        expect.objectContaining({ name: "missing-skill" })
      );

      // Lockfile must now contain missing-skill
      const updatedLock = await readLockfile(tmpDir);
      expect(updatedLock.skills["missing-skill"]).toBeDefined();
      expect(updatedLock.skills["locked-skill"]).toBeDefined();
    } finally {
      process.chdir(origCwd);
    }
  });

  it("--frozen fails if locked version does not satisfy manifest range", async () => {
    await writeManifest(
      {
        skills: {
          "semver-skill": { source: "semver-skill", version: "^2.0.0" }, // requires v2
        },
      },
      tmpDir
    );

    await writeLockfile(
      {
        lockfileVersion: 2,
        skills: {
          "semver-skill": {
            source: "registry",
            version: "1.5.0", // does not satisfy ^2.0.0!
            sha256: "112233",
          },
        },
      },
      tmpDir
    );

    const origCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      await expect(
        installCommand(undefined, { frozen: true })
      ).rejects.toThrow("does not satisfy manifest range");
    } finally {
      process.chdir(origCwd);
    }
  });

  it("--frozen fails if a lock entry is missing sha/sha256", async () => {
    await writeManifest(
      {
        skills: {
          "bad-lock-skill": { source: "bad-lock-skill", version: "1.0.0" },
        },
      },
      tmpDir
    );

    await writeLockfile(
      {
        lockfileVersion: 2,
        skills: {
          "bad-lock-skill": {
            source: "registry",
            version: "1.0.0",
            // missing sha256!
          },
        },
      },
      tmpDir
    );

    const origCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      await expect(
        installCommand(undefined, { frozen: true })
      ).rejects.toThrow("missing sha256 checksum");
    } finally {
      process.chdir(origCwd);
    }
  });

  it("update preserves GitHub ref and re-syncs targets", async () => {
    await writeManifest(
      {
        skills: {
          "my-gh-skill": {
            source: "owner/my-gh-skill",
            ref: "v1.2.3",
          },
        },
      },
      tmpDir
    );

    await writeLockfile(
      {
        lockfileVersion: 2,
        skills: {
          "my-gh-skill": {
            source: "owner/my-gh-skill",
            sha: "oldsha12345",
          },
        },
      },
      tmpDir
    );

    // Mock github resolveRef to verify ref "v1.2.3" is passed
    const resolveRefSpy = vi.spyOn(github, "resolveRef").mockResolvedValue("newsha67890");
    vi.spyOn(github, "downloadTarball").mockResolvedValue(new ReadableStream());
    vi.spyOn(extractModule, "extractSkill").mockResolvedValue(
      join(skillsDir, "my-gh-skill")
    );

    // Pre-create skill directory so target syncing can see it
    await mkdir(join(skillsDir, "my-gh-skill"), { recursive: true });
    await writeFile(join(skillsDir, "my-gh-skill", "SKILL.md"), "# Skill");

    const origCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      await updateCommand("my-gh-skill", { target: "claude" });

      // Check that resolveRef was called with ref "v1.2.3"
      expect(resolveRefSpy).toHaveBeenCalledWith("owner", "my-gh-skill", "v1.2.3");

      // Check target was synced
      expect(existsSync(join(tmpDir, ".claude", "skills", "my-gh-skill"))).toBe(true);
    } finally {
      process.chdir(origCwd);
    }
  });

  it("remove deletes synced targets and prunes orphaned dependencies", async () => {
    // Setup installed skill and an orphaned dependency
    const rootSkillDir = join(skillsDir, "root-skill");
    const depSkillDir = join(skillsDir, "orphan-dep");
    await mkdir(rootSkillDir, { recursive: true });
    await mkdir(depSkillDir, { recursive: true });
    await writeFile(join(rootSkillDir, "SKILL.md"), "# Root");
    await writeFile(join(depSkillDir, "SKILL.md"), "# Orphan Dep");

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
            dependencies: { "orphan-dep": "^1.0.0" },
          },
          "orphan-dep": {
            source: "registry",
            version: "1.0.0",
            dependencies: {},
          },
        },
      },
      tmpDir
    );

    // Sync root-skill to claude target
    await syncSkillToTarget({
      skillName: "root-skill",
      sourceDir: rootSkillDir,
      target: "claude",
      projectRoot: tmpDir,
    });
    // Sync orphan-dep to claude target
    await syncSkillToTarget({
      skillName: "orphan-dep",
      sourceDir: depSkillDir,
      target: "claude",
      projectRoot: tmpDir,
    });

    expect(existsSync(join(tmpDir, ".claude", "skills", "root-skill"))).toBe(true);
    expect(existsSync(join(tmpDir, ".claude", "skills", "orphan-dep"))).toBe(true);

    const origCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      await removeCommand("root-skill");

      // Root skill must be removed from .skills/ and targets
      expect(existsSync(rootSkillDir)).toBe(false);
      expect(existsSync(join(tmpDir, ".claude", "skills", "root-skill"))).toBe(false);

      // Orphan dependency must also be pruned from .skills/, targets, and lockfile!
      expect(existsSync(depSkillDir)).toBe(false);
      expect(existsSync(join(tmpDir, ".claude", "skills", "orphan-dep"))).toBe(false);

      const updatedLock = await readLockfile(tmpDir);
      expect(updatedLock.skills["orphan-dep"]).toBeUndefined();
    } finally {
      process.chdir(origCwd);
    }
  });

  it("outdated reports unreachable skills and exits non-zero", async () => {
    await writeManifest(
      {
        skills: {
          "broken-skill": { source: "broken-skill", version: "1.0.0" },
        },
      },
      tmpDir
    );

    await writeLockfile(
      {
        lockfileVersion: 2,
        skills: {
          "broken-skill": { source: "registry", version: "1.0.0" },
        },
      },
      tmpDir
    );

    vi.spyOn(RegistryClient.prototype, "getSkill").mockRejectedValue(
      new Error("Registry server down: 503")
    );

    const origCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      await outdatedCommand();
      expect(process.exitCode).toBe(1);
    } finally {
      process.chdir(origCwd);
    }
  });
});
