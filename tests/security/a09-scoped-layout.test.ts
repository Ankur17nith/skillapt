import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "tar";
import { Readable } from "node:stream";
import { toOnDiskName, isValidRegistryName } from "../../src/lib/source.js";
import { extractSkill } from "../../src/lib/extract.js";
import { validateSkillMd } from "../../src/lib/validation.js";

function fileToWebStream(filePath: string): ReadableStream<Uint8Array> {
  const nodeStream = createReadStream(filePath);
  return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
}

describe("A-09: Scoped layout, double-hyphen ban (D-003), and immutable files (D-004)", () => {
  let tmpDir: string;
  let skillsDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "skillapt-sec-a09-"));
    skillsDir = join(tmpDir, ".skills");
    await mkdir(skillsDir, { recursive: true });
    process.env.SKILLAPT_DIR = skillsDir;
  });

  afterEach(async () => {
    delete process.env.SKILLAPT_DIR;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("D-003: bans double hyphens in names and scopes", () => {
    expect(isValidRegistryName("my--pkg")).toBe(false);
    expect(isValidRegistryName("@scope--bad/pkg")).toBe(false);
    expect(isValidRegistryName("@scope/pkg--bad")).toBe(false);
    expect(isValidRegistryName("@my-scope/my-pkg")).toBe(true);
    expect(isValidRegistryName("valid-pkg-name")).toBe(true);
  });

  it("D-003: maps @scope/name to scope--name flat folder structure", () => {
    expect(toOnDiskName("@myorg/agent-skill")).toBe("myorg--agent-skill");
    expect(toOnDiskName("agent-skill")).toBe("agent-skill");
  });

  it("D-004: requires SKILL.md frontmatter name to match on-disk folder name", () => {
    // Valid match
    expect(() =>
      validateSkillMd(
        `---\nname: myorg--agent-skill\ndescription: "Agent skill description"\n---\n# Docs`,
        "myorg--agent-skill"
      )
    ).not.toThrow();

    // Mismatch throws error
    expect(() =>
      validateSkillMd(
        `---\nname: wrong-name\ndescription: "Agent skill description"\n---\n# Docs`,
        "myorg--agent-skill"
      )
    ).toThrow(/does not match/i);
  });

  it("D-004: extracts without rewriting SKILL.md contents, keeping original file intact", async () => {
    const pkgDir = join(tmpDir, "pkg-source");
    await mkdir(pkgDir, { recursive: true });

    const rawSkillMd = `---\nname: acme--tool\ndescription: "Acme Tool Description"\n---\n# Content\nDo not modify!`;
    await writeFile(
      join(pkgDir, "skill.json"),
      JSON.stringify({
        name: "@acme/tool",
        version: "1.0.0",
        description: "Acme tool package for agents",
        license: "MIT",
        category: "coding",
        compatibility: ["claude"],
        permissions: { network: false, shell: false, filesystem: "none" },
      })
    );
    await writeFile(join(pkgDir, "SKILL.md"), rawSkillMd);

    const tgzPath = join(tmpDir, "acme-tool.tgz");
    await create({ gzip: true, file: tgzPath, cwd: pkgDir }, ["skill.json", "SKILL.md"]);

    await extractSkill({
      tarballStream: fileToWebStream(tgzPath),
      name: "@acme/tool",
      skillsDir,
      yes: true,
    });

    const targetFile = join(skillsDir, "acme--tool", "SKILL.md");
    const extractedContent = await readFile(targetFile, "utf-8");
    expect(extractedContent).toBe(rawSkillMd);
  });
});
