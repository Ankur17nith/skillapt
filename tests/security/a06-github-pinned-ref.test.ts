import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateCommand } from "../../src/commands/update.js";
import { writeManifest } from "../../src/lib/manifest.js";
import { writeLockfile } from "../../src/lib/lockfile.js";
import * as github from "../../src/lib/github.js";
import * as extractModule from "../../src/lib/extract.js";

describe("A-06: Pinned GitHub reference retention on update", () => {
  let tmpDir: string;
  let skillsDir: string;
  let origCwd: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "skillapt-sec-a06-"));
    skillsDir = join(tmpDir, ".skills");
    await mkdir(skillsDir, { recursive: true });
    process.env.SKILLAPT_DIR = skillsDir;
    origCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(origCwd);
    delete process.env.SKILLAPT_DIR;
    vi.restoreAllMocks();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("update preserves pinned ref from manifest instead of overwriting with default branch", async () => {
    await writeManifest(
      {
        skills: {
          "secure-tool": {
            source: "acme/secure-tool",
            ref: "v1.0.0-pinned",
          },
        },
      },
      tmpDir
    );

    await writeLockfile(
      {
        lockfileVersion: 2,
        skills: {
          "secure-tool": {
            source: "acme/secure-tool",
            sha: "old-sha-12345",
          },
        },
      },
      tmpDir
    );

    const resolveRefSpy = vi.spyOn(github, "resolveRef").mockResolvedValue("new-sha-67890");
    vi.spyOn(github, "downloadTarball").mockResolvedValue(new ReadableStream());
    vi.spyOn(extractModule, "extractSkill").mockResolvedValue(
      join(skillsDir, "secure-tool")
    );

    await mkdir(join(skillsDir, "secure-tool"), { recursive: true });
    await writeFile(join(skillsDir, "secure-tool", "SKILL.md"), "# Secure Tool");

    await updateCommand("secure-tool", {});

    expect(resolveRefSpy).toHaveBeenCalledWith("acme", "secure-tool", "v1.0.0-pinned");
  });
});
