import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  packSkill,
  validateSkillManifest,
  validateSkillMd,
  checkMagicBytes,
  validateAndCollectFiles,
  getUnscopedName,
} from "../src/lib/pack.js";
import { initCommand } from "../src/commands/init.js";
import { packCommand } from "../src/commands/pack.js";
import { publishCommand } from "../src/commands/publish.js";
import { yankCommand, parsePackageVersionSpec } from "../src/commands/yank.js";
import { RegistryClient } from "../src/lib/registry.js";

describe("pack and manifest validation", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "skillapt-pack-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("extracts unscoped name correctly", () => {
    expect(getUnscopedName("my-skill")).toBe("my-skill");
    expect(getUnscopedName("@alice/pdf-tool")).toBe("pdf-tool");
    expect(getUnscopedName("@org-123/agent-helper")).toBe("agent-helper");
  });

  it("validates valid skill manifest", () => {
    const valid = {
      name: "pdf-summarizer",
      version: "1.2.0",
      description: "Extracts text from PDF documents and generates structured agent summaries.",
      license: "MIT",
      category: "documents",
      compatibility: ["claude", "cursor"],
      permissions: {
        network: false,
        shell: false,
        filesystem: "none",
      },
    };
    const res = validateSkillManifest(valid);
    expect(res.name).toBe("pdf-summarizer");
    expect(res.version).toBe("1.2.0");
  });

  it("rejects reserved package names", () => {
    const reserved = {
      name: "skillapt",
      version: "1.0.0",
      description: "Invalid package using reserved name.",
      license: "MIT",
      category: "devtools",
      compatibility: ["claude"],
      permissions: { network: false, shell: false, filesystem: "none" },
    };
    expect(() => validateSkillManifest(reserved)).toThrow(/reserved/i);
  });

  it("rejects build metadata in version (+build)", () => {
    const buildMeta = {
      name: "my-package",
      version: "1.0.0+20261107",
      description: "Invalid package with build metadata.",
      license: "MIT",
      category: "coding",
      compatibility: ["cursor"],
      permissions: { network: false, shell: false, filesystem: "none" },
    };
    expect(() => validateSkillManifest(buildMeta)).toThrow(/build metadata/i);
  });

  it("validates SKILL.md frontmatter", () => {
    const validMd = `---
name: pdf-summarizer
description: Extracts text from PDF files.
category: documents
version: 1.2.0
---

# PDF Summarizer

Content with enough length to satisfy 10 characters.
`;
    const res = validateSkillMd(validMd, "pdf-summarizer");
    expect(res.name).toBe("pdf-summarizer");
    expect(res.description).toBe("Extracts text from PDF files.");

    // Scoped package name matches unscoped frontmatter name
    const res2 = validateSkillMd(validMd, "@alice/pdf-summarizer");
    expect(res2.name).toBe("pdf-summarizer");
  });

  it("rejects SKILL.md with mismatched name", () => {
    const mismatch = `---
name: other-skill
description: Something else.
---
# Other
Valid length content here.
`;
    expect(() => validateSkillMd(mismatch, "pdf-summarizer")).toThrow(/does not match/i);
  });

  it("rejects SKILL.md without YAML frontmatter delimiter", () => {
    const invalid = `# Just Markdown
No frontmatter at all.
`;
    expect(() => validateSkillMd(invalid, "my-skill")).toThrow(/YAML frontmatter/i);
  });

  it("detects and rejects executable binary magic bytes", () => {
    // ELF header: 0x7F 'E' 'L' 'F'
    const elfBuf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x00]);
    expect(() => checkMagicBytes(elfBuf, "script.sh")).toThrow(/ELF/i);

    // Windows PE / MZ: 'M' 'Z'
    const peBuf = Buffer.from([0x4d, 0x5a, 0x90, 0x00]);
    expect(() => checkMagicBytes(peBuf, "helper.exe")).toThrow(/Windows PE/i);

    // Java class: 0xCA 0xFE 0xBA 0xBE
    const javaBuf = Buffer.from([0xca, 0xfe, 0xba, 0xbe]);
    expect(() => checkMagicBytes(javaBuf, "data.bin")).toThrow(/Java class/i);
  });

  it("scaffolds skill files with initCommand", async () => {
    await initCommand({ dir: tempDir, name: "my-test-skill" });

    expect(existsSync(join(tempDir, "skill.json"))).toBe(true);
    expect(existsSync(join(tempDir, "SKILL.md"))).toBe(true);
    expect(existsSync(join(tempDir, "skills.json"))).toBe(true);

    const manifest = JSON.parse(await readFile(join(tempDir, "skill.json"), "utf-8"));
    expect(manifest.name).toBe("my-test-skill");
    expect(manifest.version).toBe("0.1.0");

    const skillMd = await readFile(join(tempDir, "SKILL.md"), "utf-8");
    expect(skillMd).toContain("name: my-test-skill");
  });

  it("packs a valid skill directory into .tar.gz", async () => {
    await initCommand({ dir: tempDir, name: "packable-skill" });

    // Add extra valid prompt file
    await writeFile(join(tempDir, "prompt.txt"), "Translate this document to English.");

    const result = await packSkill(tempDir);
    expect(result.tarballPath).toContain("packable-skill-0.1.0.tgz");
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.integrity).toBe(`sha256-${result.sha256}`);
    expect(existsSync(result.tarballPath)).toBe(true);
    expect(result.compressedSize).toBeGreaterThan(0);
  });

  it("rejects packaging when disallowed file extension exists", async () => {
    await initCommand({ dir: tempDir, name: "disallowed-skill" });

    // Create a disallowed .exe file
    await writeFile(join(tempDir, "bad.exe"), "dummy content");

    await expect(packSkill(tempDir)).rejects.toThrow(/prohibited/i);
  });

  it("rejects packaging when unauthorized hidden file exists", async () => {
    await initCommand({ dir: tempDir, name: "hidden-skill" });

    // Create hidden .env file
    await writeFile(join(tempDir, ".env"), "SECRET=123");

    await expect(packSkill(tempDir)).rejects.toThrow(/Hidden file or directory/i);
  });

  it("parses package version spec for yankCommand", () => {
    expect(parsePackageVersionSpec("foo@1.0.0")).toEqual({ name: "foo", version: "1.0.0" });
    expect(parsePackageVersionSpec("@alice/tool@2.3.4")).toEqual({
      name: "@alice/tool",
      version: "2.3.4",
    });
    expect(parsePackageVersionSpec("bar", "3.0.0")).toEqual({ name: "bar", version: "3.0.0" });
    expect(() => parsePackageVersionSpec("foo")).toThrow(/Invalid package version/i);
  });

  it("publishes skill tarball through RegistryClient", async () => {
    await initCommand({ dir: tempDir, name: "publish-skill" });
    const packed = await packSkill(tempDir);

    const publishSpy = vi
      .spyOn(RegistryClient.prototype, "publishSkill")
      .mockResolvedValueOnce({
        name: "publish-skill",
        version: "0.1.0",
        sha256: packed.sha256,
        size: packed.compressedSize,
        tarballUrl: "https://registry.skillapt.dev/v1/skills/publish-skill/-/0.1.0.tgz",
        message: "Successfully published publish-skill@0.1.0",
      });

    const res = await publishCommand(packed.tarballPath, {
      token: "apt_live_mocktoken123",
      json: true,
    });

    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(res.name).toBe("publish-skill");
    expect(res.version).toBe("0.1.0");
  });

  it("yanks skill version through RegistryClient", async () => {
    const yankSpy = vi
      .spyOn(RegistryClient.prototype, "yankSkill")
      .mockResolvedValueOnce({
        name: "test-skill",
        version: "1.0.0",
        yanked: true,
        message: "Version 1.0.0 has been yanked.",
      });

    const res = await yankCommand("test-skill@1.0.0", {
      reason: "Security flaw",
      token: "apt_live_mocktoken123",
      json: true,
    });

    expect(yankSpy).toHaveBeenCalledWith("test-skill", "1.0.0", "Security flaw", "apt_live_mocktoken123");
    expect(res.yanked).toBe(true);
  });
});
