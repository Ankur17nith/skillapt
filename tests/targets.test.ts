import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  TARGET_CONFIGS,
  syncSkillToTarget,
  resolveTargetDir,
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
    delete process.env.SKILLAPT_ANTIGRAVITY_DIR;
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("contains valid TARGET_CONFIGS table with all 5 targets", () => {
    expect(TARGET_CONFIGS.claude).toBeDefined();
    expect(TARGET_CONFIGS.cursor).toBeDefined();
    expect(TARGET_CONFIGS.codex).toBeDefined();
    expect(TARGET_CONFIGS.antigravity).toBeDefined();
    expect(TARGET_CONFIGS["antigravity-cli"]).toBeDefined();

    expect(TARGET_CONFIGS.claude.projectDir).toBe(".claude/skills");
    expect(TARGET_CONFIGS.cursor.projectDir).toBe(".cursor/skills");
    expect(TARGET_CONFIGS.codex.projectDir).toBe(".codex/skills");
    expect(TARGET_CONFIGS.antigravity.projectDir).toBe(".agents/skills");
    expect(TARGET_CONFIGS["antigravity-cli"].projectDir).toBe(".agents/skills");

    expect(TARGET_CONFIGS.antigravity.globalDir).toBe(
      join(homedir(), ".gemini", "config", "skills")
    );
    expect(TARGET_CONFIGS["antigravity-cli"].globalDir).toBe(
      join(homedir(), ".gemini", "antigravity-cli", "skills")
    );
  });

  it("syncs skill to project directory for all targets", async () => {
    const targets = ["claude", "cursor", "codex", "antigravity", "antigravity-cli"];

    for (const target of targets) {
      const res = await syncSkillToTarget({
        skillName: "pdf-summarizer",
        sourceDir: skillDir,
        target,
        projectRoot: tempDir,
      });

      expect(res.target).toBe(target);
      expect(existsSync(res.targetPath)).toBe(true);
      expect(existsSync(join(res.targetPath, "SKILL.md"))).toBe(true);

      const content = await readFile(join(res.targetPath, "SKILL.md"), "utf-8");
      expect(content).toBe("# PDF Summarizer");
    }
  });

  it("resolves global directory for every target", () => {
    expect(resolveTargetDir("claude", true)).toBe(join(homedir(), ".claude", "skills"));
    expect(resolveTargetDir("cursor", true)).toBe(join(homedir(), ".cursor", "skills"));
    expect(resolveTargetDir("codex", true)).toBe(join(homedir(), ".codex", "skills"));
    expect(resolveTargetDir("antigravity", true)).toBe(
      join(homedir(), ".gemini", "config", "skills")
    );
    expect(resolveTargetDir("antigravity-cli", true)).toBe(
      join(homedir(), ".gemini", "antigravity-cli", "skills")
    );
  });

  it("syncs skill to global directory for all targets", async () => {
    const fakeHome = join(tempDir, "global-home");
    const targets = ["claude", "cursor", "codex", "antigravity", "antigravity-cli"];

    for (const target of targets) {
      const res = await syncSkillToTarget({
        skillName: "pdf-summarizer",
        sourceDir: skillDir,
        target,
        global: true,
        homedir: fakeHome,
      });

      expect(res.target).toBe(target);
      expect(existsSync(res.targetPath)).toBe(true);
      expect(existsSync(join(res.targetPath, "SKILL.md"))).toBe(true);
    }
  });

  it("detects legacy project directory .agent/skills for antigravity when new path is missing", async () => {
    const legacyDir = join(tempDir, ".agent", "skills");
    await mkdir(legacyDir, { recursive: true });

    const dir = resolveTargetDir("antigravity", false, tempDir);
    expect(dir).toBe(legacyDir);
  });

  it("detects legacy global directory ~/.gemini/antigravity/skills when new path is missing", async () => {
    // Mock homedir to temp directory
    const fakeHome = join(tempDir, "fakehome");
    const legacyGlobal = join(fakeHome, ".gemini", "antigravity", "skills");
    await mkdir(legacyGlobal, { recursive: true });

    const dir = resolveTargetDir("antigravity", true, undefined, fakeHome);
    expect(dir).toBe(legacyGlobal);
  });

  it("honors SKILLAPT_ANTIGRAVITY_DIR override", () => {
    const customDir = join(tempDir, "custom-antigravity");
    process.env.SKILLAPT_ANTIGRAVITY_DIR = customDir;

    expect(resolveTargetDir("antigravity", false, tempDir)).toBe(customDir);
    expect(resolveTargetDir("antigravity", true, tempDir)).toBe(customDir);
    expect(resolveTargetDir("antigravity-cli", false, tempDir)).toBe(customDir);
  });

  it("replaces existing destination cleanly on re-sync", async () => {
    // Sync once
    await syncSkillToTarget({
      skillName: "pdf-summarizer",
      sourceDir: skillDir,
      target: "antigravity",
      projectRoot: tempDir,
    });

    // Update source
    await writeFile(join(skillDir, "SKILL.md"), "# Updated PDF Summarizer");

    // Sync again
    const res = await syncSkillToTarget({
      skillName: "pdf-summarizer",
      sourceDir: skillDir,
      target: "antigravity",
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
