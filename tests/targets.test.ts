import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  TARGET_CONFIGS,
  syncSkillToTarget,
} from "../src/lib/targets.js";

describe("install targets", () => {
  let tempDir: string;
  let skillDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "skillapt-targets-test-"));
    skillDir = join(tempDir, ".skills", "pdf-summarizer");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# PDF Summarizer");
    await writeFile(join(skillDir, "skill.json"), '{"name": "pdf-summarizer"}');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("contains valid TARGET_CONFIGS table", () => {
    expect(TARGET_CONFIGS.claude).toBeDefined();
    expect(TARGET_CONFIGS.cursor).toBeDefined();
    expect(TARGET_CONFIGS.codex).toBeDefined();
    expect(TARGET_CONFIGS.claude.projectDir).toBe(".claude/skills");
    expect(TARGET_CONFIGS.cursor.projectDir).toBe(".cursor/skills");
    expect(TARGET_CONFIGS.codex.projectDir).toBe(".codex/skills");
  });

  it("syncs skill to claude target directory in project", async () => {
    const res = await syncSkillToTarget({
      skillName: "pdf-summarizer",
      sourceDir: skillDir,
      target: "claude",
      projectRoot: tempDir,
    });

    expect(res.target).toBe("claude");
    expect(existsSync(res.targetPath)).toBe(true);
    expect(existsSync(join(res.targetPath, "SKILL.md"))).toBe(true);

    const content = await readFile(join(res.targetPath, "SKILL.md"), "utf-8");
    expect(content).toBe("# PDF Summarizer");
  });

  it("syncs skill to cursor target directory in project", async () => {
    const res = await syncSkillToTarget({
      skillName: "pdf-summarizer",
      sourceDir: skillDir,
      target: "cursor",
      projectRoot: tempDir,
    });

    expect(res.target).toBe("cursor");
    expect(existsSync(res.targetPath)).toBe(true);
    expect(existsSync(join(res.targetPath, "skill.json"))).toBe(true);
  });

  it("syncs skill to codex target directory in project", async () => {
    const res = await syncSkillToTarget({
      skillName: "pdf-summarizer",
      sourceDir: skillDir,
      target: "codex",
      projectRoot: tempDir,
    });

    expect(res.target).toBe("codex");
    expect(existsSync(res.targetPath)).toBe(true);
  });

  it("replaces existing destination cleanly on re-sync", async () => {
    // Sync once
    await syncSkillToTarget({
      skillName: "pdf-summarizer",
      sourceDir: skillDir,
      target: "claude",
      projectRoot: tempDir,
    });

    // Update source
    await writeFile(join(skillDir, "SKILL.md"), "# Updated PDF Summarizer");

    // Sync again
    const res = await syncSkillToTarget({
      skillName: "pdf-summarizer",
      sourceDir: skillDir,
      target: "claude",
      projectRoot: tempDir,
    });

    const content = await readFile(join(res.targetPath, "SKILL.md"), "utf-8");
    expect(content).toBe("# Updated PDF Summarizer");
  });

  it("throws friendly error for unknown target", async () => {
    await expect(
      syncSkillToTarget({
        skillName: "pdf-summarizer",
        sourceDir: skillDir,
        target: "unknown-ide",
        projectRoot: tempDir,
      })
    ).rejects.toThrow(/Unknown install target "unknown-ide"/);
  });
});
