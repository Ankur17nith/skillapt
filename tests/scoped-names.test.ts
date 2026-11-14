import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "tar";
import { Readable } from "node:stream";
import { toOnDiskName, isValidRegistryName } from "../src/lib/source.js";
import { extractSkill } from "../src/lib/extract.js";
import { syncSkillToTarget } from "../src/lib/targets.js";
import { removeCommand } from "../src/commands/remove.js";
import { writeManifest } from "../src/lib/manifest.js";
import { writeLockfile, readLockfile, addLockEntry } from "../src/lib/lockfile.js";
import { parseFrontmatter, validateSkillManifest } from "../src/lib/validation.js";

function fileToWebStream(filePath: string): ReadableStream<Uint8Array> {
  const nodeStream = createReadStream(filePath);
  return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
}

describe("scoped names and target layout", () => {
  let tmpDir: string;
  let skillsDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "skillapt-scoped-test-"));
    skillsDir = join(tmpDir, ".skills");
    await mkdir(skillsDir, { recursive: true });
    process.env.SKILLAPT_DIR = skillsDir;
  });

  afterEach(async () => {
    delete process.env.SKILLAPT_DIR;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("toOnDiskName converts scoped names to flat directory format", () => {
    expect(toOnDiskName("@alice/pdf-tool")).toBe("alice--pdf-tool");
    expect(toOnDiskName("@team-alpha/super-agent")).toBe("team-alpha--super-agent");
    expect(toOnDiskName("pdf-tool")).toBe("pdf-tool");
  });

  it("extracts scoped package into flat on-disk directory matching SKILL.md name without rewriting", async () => {
    // Create archive for @alice/pdf-tool adhering to D-004 (frontmatter name == on-disk name)
    const pkgDir = join(tmpDir, "pkg-source");
    await mkdir(pkgDir, { recursive: true });
    await writeFile(
      join(pkgDir, "skill.json"),
      JSON.stringify({
        name: "@alice/pdf-tool",
        version: "1.0.0",
        description: "Alice PDF tool",
        license: "MIT",
        category: "documents",
        compatibility: ["claude"],
        permissions: { network: false, shell: false, filesystem: "read" },
      })
    );
    const originalSkillMd = `---
name: alice--pdf-tool
description: Alice PDF tool
---
# PDF Tool
Alice's PDF tool
`;
    await writeFile(join(pkgDir, "SKILL.md"), originalSkillMd);

    const tarPath = join(tmpDir, "alice-pdf-tool.tar.gz");
    await create({ gzip: true, file: tarPath, cwd: pkgDir }, ["skill.json", "SKILL.md"]);

    const installedDir = await extractSkill({
      tarballStream: fileToWebStream(tarPath),
      name: "@alice/pdf-tool",
      skillsDir,
      yes: true,
    });

    // Check directory name is flat alice--pdf-tool
    expect(installedDir).toBe(join(skillsDir, "alice--pdf-tool"));
    expect(existsSync(installedDir)).toBe(true);

    // Verify SKILL.md name field is unchanged and equals on-disk folder name
    const skillMd = await readFile(join(installedDir, "SKILL.md"), "utf-8");
    expect(skillMd).toBe(originalSkillMd);
    const fm = parseFrontmatter(skillMd);
    expect(fm.name).toBe("alice--pdf-tool");
  });

  it("rejects scoped package if SKILL.md frontmatter name does not match on-disk name (D-004)", async () => {
    const pkgDir = join(tmpDir, "mismatched-source");
    await mkdir(pkgDir, { recursive: true });
    await writeFile(
      join(pkgDir, "skill.json"),
      JSON.stringify({
        name: "@alice/pdf-tool",
        version: "1.0.0",
        description: "Alice PDF tool",
        license: "MIT",
        category: "documents",
        compatibility: ["claude"],
        permissions: { network: false, shell: false, filesystem: "read" },
      })
    );
    // Frontmatter name differs from on-disk folder name "alice--pdf-tool"
    await writeFile(
      join(pkgDir, "SKILL.md"),
      `---
name: pdf-tool
description: Alice PDF tool
---
# PDF Tool
`
    );

    const tarPath = join(tmpDir, "mismatched.tar.gz");
    await create({ gzip: true, file: tarPath, cwd: pkgDir }, ["skill.json", "SKILL.md"]);

    await expect(
      extractSkill({
        tarballStream: fileToWebStream(tarPath),
        name: "@alice/pdf-tool",
        skillsDir,
        yes: true,
      })
    ).rejects.toThrow(/does not match unscoped package name/i);
  });

  it("syncs scoped package to flat on-disk directory in agent target", async () => {
    const pkgDir = join(skillsDir, "alice--pdf-tool");
    await mkdir(pkgDir, { recursive: true });
    await writeFile(join(pkgDir, "SKILL.md"), "# Alice Tool");
    await writeFile(
      join(pkgDir, "skill.json"),
      JSON.stringify({ name: "@alice/pdf-tool", version: "1.0.0" })
    );

    const res = await syncSkillToTarget({
      skillName: "@alice/pdf-tool",
      sourceDir: pkgDir,
      target: "claude",
      projectRoot: tmpDir,
    });

    expect(res.targetPath).toBe(join(tmpDir, ".claude", "skills", "alice--pdf-tool"));
    expect(existsSync(res.targetPath)).toBe(true);
  });

  it("rejects collision: an attacker trying to install 'alice--pdf-tool' is rejected by the name rule (D-003)", () => {
    // Packages and scopes cannot contain '--'
    expect(isValidRegistryName("alice--pdf-tool")).toBe(false);
    expect(isValidRegistryName("@attacker--team/tool")).toBe(false);
    expect(isValidRegistryName("@attacker/bad--name")).toBe(false);

    expect(() =>
      validateSkillManifest({
        name: "alice--pdf-tool",
        version: "1.0.0",
        description: "Attacker package attempting collision",
        license: "MIT",
        category: "devtools",
        compatibility: ["claude"],
        permissions: { network: false, shell: false, filesystem: "none" },
      })
    ).toThrow(/--/);
  });

  it("records package name and on-disk folder name in lockfile", async () => {
    let lockfile = await readLockfile(tmpDir);
    lockfile = addLockEntry(lockfile, "@alice/pdf-tool", {
      source: "registry",
      version: "1.0.0",
      resolved: "https://registry.skillapt.dev/v1/skills/@alice/pdf-tool/-/1.0.0.tgz",
    });

    await writeLockfile(lockfile, tmpDir);

    const readBack = await readLockfile(tmpDir);
    expect(readBack.skills["@alice/pdf-tool"]).toBeDefined();
    expect(readBack.skills["@alice/pdf-tool"].folder).toBe("alice--pdf-tool");
  });

  it("removes scoped skill using flat on-disk name", async () => {
    const pkgDir = join(skillsDir, "alice--pdf-tool");
    await mkdir(pkgDir, { recursive: true });
    await writeFile(join(pkgDir, "SKILL.md"), "# Alice Tool");

    await writeManifest(
      {
        skills: {
          "@alice/pdf-tool": { source: "@alice/pdf-tool", version: "1.0.0" },
        },
      },
      tmpDir
    );

    await writeLockfile(
      {
        lockfileVersion: 2,
        skills: {
          "@alice/pdf-tool": { source: "registry", version: "1.0.0", folder: "alice--pdf-tool" },
        },
      },
      tmpDir
    );

    // Mock cwd to tmpDir
    const origCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      await removeCommand("@alice/pdf-tool");
      expect(existsSync(pkgDir)).toBe(false);
    } finally {
      process.chdir(origCwd);
    }
  });
});
