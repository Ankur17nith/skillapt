import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { outdatedCommand } from "../../src/commands/outdated.js";
import { writeManifest } from "../../src/lib/manifest.js";
import { writeLockfile } from "../../src/lib/lockfile.js";
import { RegistryClient } from "../../src/lib/registry.js";

describe("A-12: Outdated error reporting and non-zero exit on unreachable skills", () => {
  let tmpDir: string;
  let skillsDir: string;
  let origCwd: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "skillapt-sec-a12-"));
    skillsDir = join(tmpDir, ".skills");
    process.env.SKILLAPT_DIR = skillsDir;
    origCwd = process.cwd();
    process.chdir(tmpDir);
    process.exitCode = undefined;
  });

  afterEach(async () => {
    process.chdir(origCwd);
    delete process.env.SKILLAPT_DIR;
    process.exitCode = undefined;
    vi.restoreAllMocks();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("reports unreachable registry dependencies and sets process.exitCode = 1", async () => {
    await writeManifest(
      {
        skills: {
          "unreachable-pkg": { source: "unreachable-pkg", version: "1.0.0" },
        },
      },
      tmpDir
    );

    await writeLockfile(
      {
        lockfileVersion: 2,
        skills: {
          "unreachable-pkg": { source: "registry", version: "1.0.0" },
        },
      },
      tmpDir
    );

    vi.spyOn(RegistryClient.prototype, "getSkill").mockRejectedValue(
      new Error("Registry unreachable: 502 Bad Gateway")
    );

    await outdatedCommand();
    expect(process.exitCode).toBe(1);
  });
});
