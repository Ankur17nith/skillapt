import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir, writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "tar";
import { Readable } from "node:stream";
import { toOnDiskName } from "../src/lib/source.js";
import { extractSkill } from "../src/lib/extract.js";
import { syncSkillToTarget } from "../src/lib/targets.js";
import { removeCommand } from "../src/commands/remove.js";
import { writeManifest } from "../src/lib/manifest.js";
import { writeLockfile } from "../src/lib/lockfile.js";
import { parseFrontmatter } from "../src/lib/validation.js";

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

  it("extracts scoped package into flat on-disk directory and rewrites SKILL.md name", async () => {
    // Create archive for @alice/pdf-tool
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
    await writeFile(
      join(pkgDir, "SKILL.md"),
      `---
name: pdf-tool
description: Alice PDF tool
---
# PDF Tool
Alice's PDF tool
`
    );

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

    // Verify SKILL.md name field is rewritten to flat alice--pdf-tool
    const skillMd = await readFile(join(installedDir, "SKILL.md"), "utf-8");
    const fm = parseFrontmatter(skillMd);
    expect(fm.name).toBe("alice--pdf-tool");
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

  it("detects and rejects collisions when on-disk name is already occupied by a different package", async () => {
    // 1. Existing skill on disk: alice--pdf-tool from unscoped package "alice--pdf-tool"
    const existingDir = join(skillsDir, "alice--pdf-tool");
    await mkdir(existingDir, { recursive: true });
    await writeFile(
      join(existingDir, "skill.json"),
      JSON.stringify({ name: "alice--pdf-tool", version: "1.0.0" })
    );
    await writeFile(
      join(existingDir, "SKILL.md"),
      `---
name: alice--pdf-tool
description: Unscoped tool
---
# Tool
`
    );

    // 2. Try to extract scoped package "@alice/pdf-tool" which maps to the same folder
    const pkgDir = join(tmpDir, "scoped-source");
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
    await writeFile(
      join(pkgDir, "SKILL.md"),
      `---
name: pdf-tool
description: Alice PDF tool
---
# PDF Tool
`
    );

    const tarPath = join(tmpDir, "scoped.tar.gz");
    await create({ gzip: true, file: tarPath, cwd: pkgDir }, ["skill.json", "SKILL.md"]);

    await expect(
      extractSkill({
        tarballStream: fileToWebStream(tarPath),
        name: "@alice/pdf-tool",
        skillsDir,
        yes: true,
      })
    ).rejects.toThrow("Naming collision");
  });

  it("removes scoped skill using flat on-disk name", async () => {
    const pkgDir = join(skillsDir, "alice--pdf-tool");
    await mkdir(pkgDir, { recursive: true });
    await writeFile(join(pkgDir, "SKILL.md"), "# Alice Tool");

    const manifestFile = join(tmpDir, "skills.json");
    const lockFile = join(tmpDir, "skills.lock.json");

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
          "@alice/pdf-tool": { source: "registry", version: "1.0.0" },
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
