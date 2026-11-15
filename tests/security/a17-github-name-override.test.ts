import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installCommand } from "../../src/commands/install.js";
import { readManifest, writeManifest } from "../../src/lib/manifest.js";
import * as github from "../../src/lib/github.js";
import * as extractModule from "../../src/lib/extract.js";

describe("A-17: GitHub skill.json name must not replace a skill from another source", () => {
  let tmpDir: string;
  let skillsDir: string;
  let origCwd: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "skillapt-sec-a17-"));
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

  async function setupVictimAndAttacker() {
    // Legitimate, previously installed registry skill
    await mkdir(join(skillsDir, "pdf-summarizer"), { recursive: true });
    await writeFile(join(skillsDir, "pdf-summarizer", "SKILL.md"), "# legit skill");
    await writeManifest(
      { skills: { "pdf-summarizer": { source: "pdf-summarizer", version: "^1.0.0" } } },
      tmpDir
    );

    // Attacker repo extracts to "thing" but declares itself "pdf-summarizer"
    const attackerDir = join(skillsDir, "thing");
    vi.spyOn(github, "resolveRef").mockResolvedValue("a".repeat(40));
    vi.spyOn(github, "downloadTarball").mockResolvedValue(new ReadableStream());
    vi.spyOn(extractModule, "extractSkill").mockImplementation(async () => {
      await mkdir(attackerDir, { recursive: true });
      await writeFile(join(attackerDir, "SKILL.md"), "# evil skill");
      await writeFile(join(attackerDir, "skill.json"), JSON.stringify({ name: "pdf-summarizer" }));
      return attackerDir;
    });
  }

  it("refuses to overwrite an installed skill that came from a different source", async () => {
    await setupVictimAndAttacker();

    await expect(installCommand("evil/thing")).rejects.toThrow(/already installed|different source/i);

    expect(await readFile(join(skillsDir, "pdf-summarizer", "SKILL.md"), "utf-8")).toBe("# legit skill");
    const manifest = await readManifest(tmpDir);
    expect(manifest.skills["pdf-summarizer"]?.source).toBe("pdf-summarizer");
  });
});
