import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir, writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReadStream } from "node:fs";
import { create } from "tar";
import { Readable } from "node:stream";
import { extractSkill } from "../src/lib/extract.js";

function makeSkillMd(name: string, description: string = "A helpful agent skill"): string {
  return `---
name: ${name}
description: ${description}
---
# ${name}
${description}
`;
}

/** Helper: create a tar.gz from an object of { path: content | Buffer } entries. */
async function createTarball(
  dir: string,
  entries: Record<string, string | Buffer>,
  topDirName: string = "myrepo-abc123"
): Promise<string> {
  const topDir = join(dir, topDirName);
  await mkdir(topDir, { recursive: true });

  for (const [filePath, content] of Object.entries(entries)) {
    const fullPath = join(topDir, filePath);
    await mkdir(join(fullPath, ".."), { recursive: true });
    await writeFile(fullPath, content);
  }

  const tarPath = join(dir, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.tar.gz`);

  await create(
    {
      gzip: true,
      file: tarPath,
      cwd: dir,
    },
    [topDirName]
  );

  return tarPath;
}

/** Convert a file to a ReadableStream (simulating what fetch returns). */
function fileToWebStream(filePath: string): ReadableStream<Uint8Array> {
  const nodeStream = createReadStream(filePath);
  return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
}

describe("extractSkill", () => {
  let tmpDir: string;
  let skillsDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "skillapt-extract-test-"));
    skillsDir = join(tmpDir, ".skills");
    await mkdir(skillsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("extracts a valid skill with SKILL.md", async () => {
    const tarPath = await createTarball(tmpDir, {
      "SKILL.md": makeSkillMd("my-skill"),
    });

    const result = await extractSkill({
      tarballStream: fileToWebStream(tarPath),
      name: "my-skill",
      skillsDir,
    });

    const files = await readdir(result);
    expect(files).toContain("SKILL.md");
  });

  it("extracts a valid skill with SKILL.md and skill.json", async () => {
    const tarPath = await createTarball(tmpDir, {
      "SKILL.md": makeSkillMd("test"),
      "skill.json": '{"name": "test"}',
    });

    const result = await extractSkill({
      tarballStream: fileToWebStream(tarPath),
      name: "test",
      skillsDir,
    });

    const files = await readdir(result);
    expect(files).toContain("skill.json");
    expect(files).toContain("SKILL.md");
  });

  it("rejects a repo without SKILL.md", async () => {
    const tarPath = await createTarball(tmpDir, {
      "README.md": "Not a skill",
    });

    await expect(
      extractSkill({
        tarballStream: fileToWebStream(tarPath),
        name: "bad",
        skillsDir,
      })
    ).rejects.toThrow("must contain a SKILL.md file");
  });

  it("rejects a skill whose SKILL.md frontmatter name does not match package name", async () => {
    const tarPath = await createTarball(tmpDir, {
      "SKILL.md": makeSkillMd("different-name"),
    });

    await expect(
      extractSkill({
        tarballStream: fileToWebStream(tarPath),
        name: "expected-name",
        skillsDir,
      })
    ).rejects.toThrow("does not match unscoped package name");
  });

  it("extracts subpath when provided", async () => {
    const tarPath = await createTarball(tmpDir, {
      "skills/my-skill/SKILL.md": makeSkillMd("my-skill"),
      "README.md": "Root readme",
    });

    const result = await extractSkill({
      tarballStream: fileToWebStream(tarPath),
      name: "my-skill",
      skillsDir,
      subpath: "skills/my-skill",
    });

    const files = await readdir(result);
    expect(files).toContain("SKILL.md");
    expect(files).not.toContain("README.md");
  });

  it("rejects invalid subpath", async () => {
    const tarPath = await createTarball(tmpDir, {
      "SKILL.md": makeSkillMd("test"),
    });

    await expect(
      extractSkill({
        tarballStream: fileToWebStream(tarPath),
        name: "test",
        skillsDir,
        subpath: "nonexistent/path",
      })
    ).rejects.toThrow("not found");
  });

  it("rejects invalid skill name with path traversal", async () => {
    const tarPath = await createTarball(tmpDir, {
      "SKILL.md": makeSkillMd("evil"),
    });

    await expect(
      extractSkill({
        tarballStream: fileToWebStream(tarPath),
        name: "../evil",
        skillsDir,
      })
    ).rejects.toThrow("Invalid skill name");
  });

  it("replaces an existing installation", async () => {
    const tarPath1 = await createTarball(tmpDir, {
      "SKILL.md": makeSkillMd("my-skill", "Version 1 description"),
    });

    await extractSkill({
      tarballStream: fileToWebStream(tarPath1),
      name: "my-skill",
      skillsDir,
    });

    const tmpDir2 = await mkdtemp(join(tmpdir(), "skillapt-extract-v2-"));
    try {
      const tarPath2 = await createTarball(tmpDir2, {
        "SKILL.md": makeSkillMd("my-skill", "Version 2 description"),
        "extra.txt": "new file",
      });

      const result = await extractSkill({
        tarballStream: fileToWebStream(tarPath2),
        name: "my-skill",
        skillsDir,
      });

      const files = await readdir(result);
      expect(files).toContain("SKILL.md");
      expect(files).toContain("extra.txt");
    } finally {
      await rm(tmpDir2, { recursive: true, force: true });
    }
  });

  it("atomic swap: failed install leaves previous version intact", async () => {
    // 1. Install good v1
    const tarPath1 = await createTarball(tmpDir, {
      "SKILL.md": makeSkillMd("my-skill", "Version 1"),
      "canary.txt": "V1 CANARY CONTENT",
    });

    const targetDir = await extractSkill({
      tarballStream: fileToWebStream(tarPath1),
      name: "my-skill",
      skillsDir,
    });

    expect(await readFile(join(targetDir, "canary.txt"), "utf-8")).toBe("V1 CANARY CONTENT");

    // 2. Attempt install of v2 that fails validation (contains banned .exe file)
    const tmpDir2 = await mkdtemp(join(tmpdir(), "skillapt-extract-bad-"));
    try {
      const badTar = await createTarball(tmpDir2, {
        "SKILL.md": makeSkillMd("my-skill", "Version 2"),
        "malware.exe": "echo bad",
      });

      await expect(
        extractSkill({
          tarballStream: fileToWebStream(badTar),
          name: "my-skill",
          skillsDir,
        })
      ).rejects.toThrow();

      // 3. Verify previous v1 version is still intact
      expect(existsSync(targetDir)).toBe(true);
      expect(await readFile(join(targetDir, "canary.txt"), "utf-8")).toBe("V1 CANARY CONTENT");
    } finally {
      await rm(tmpDir2, { recursive: true, force: true });
    }
  });

  it("verifies sha256 and succeeds on match", async () => {
    const { readFile } = await import("node:fs/promises");
    const { createHash } = await import("node:crypto");

    const tarPath = await createTarball(tmpDir, {
      "SKILL.md": makeSkillMd("verified-skill"),
    });

    const fileBytes = await readFile(tarPath);
    const correctHash = createHash("sha256").update(fileBytes).digest("hex");

    const result = await extractSkill({
      tarballStream: fileToWebStream(tarPath),
      name: "verified-skill",
      skillsDir,
      expectedSha256: correctHash,
    });

    const files = await readdir(result);
    expect(files).toContain("SKILL.md");
  });

  it("aborts before extraction on sha256 mismatch", async () => {
    const tarPath = await createTarball(tmpDir, {
      "SKILL.md": makeSkillMd("tampered-skill"),
    });

    await expect(
      extractSkill({
        tarballStream: fileToWebStream(tarPath),
        name: "tampered-skill",
        skillsDir,
        expectedSha256: "0000000000000000000000000000000000000000000000000000000000000000",
      })
    ).rejects.toThrow("Integrity check failed");
  });

  it("rejects banned extensions (.exe, .dll, etc.)", async () => {
    const tarPath = await createTarball(tmpDir, {
      "SKILL.md": makeSkillMd("banned-skill"),
      "binary.dll": "fake dll content",
    });

    await expect(
      extractSkill({
        tarballStream: fileToWebStream(tarPath),
        name: "banned-skill",
        skillsDir,
      })
    ).rejects.toThrow("prohibited");
  });

  it("rejects files with ELF magic bytes", async () => {
    const elfHeader = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
    const tarPath = await createTarball(tmpDir, {
      "SKILL.md": makeSkillMd("magic-skill"),
      "script.txt": elfHeader,
    });

    await expect(
      extractSkill({
        tarballStream: fileToWebStream(tarPath),
        name: "magic-skill",
        skillsDir,
      })
    ).rejects.toThrow("ELF executable binary magic bytes");
  });

  it("rejects files with Windows PE magic bytes", async () => {
    const peHeader = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // MZ
    const tarPath = await createTarball(tmpDir, {
      "SKILL.md": makeSkillMd("magic-pe"),
      "script.py": peHeader,
    });

    await expect(
      extractSkill({
        tarballStream: fileToWebStream(tarPath),
        name: "magic-pe",
        skillsDir,
      })
    ).rejects.toThrow("Windows PE executable binary magic bytes");
  });

  it("GitHub install skips non-allowlisted files and accepts --allow-ext", async () => {
    const tarPath = await createTarball(tmpDir, {
      "SKILL.md": makeSkillMd("github-skill"),
      "docs.unknownext": "some random doc",
      "special.custom": "custom content",
    });

    // 1. Without allowExt: .unknownext and .custom are skipped (unlinked)
    const result1 = await extractSkill({
      tarballStream: fileToWebStream(tarPath),
      name: "github-skill",
      skillsDir,
      isGitHub: true,
    });

    const files1 = await readdir(result1);
    expect(files1).toContain("SKILL.md");
    expect(files1).not.toContain("docs.unknownext");
    expect(files1).not.toContain("special.custom");

    // 2. With allowExt: custom extension is preserved
    const tarPath2 = await createTarball(tmpDir, {
      "SKILL.md": makeSkillMd("github-skill"),
      "docs.unknownext": "some random doc",
      "special.custom": "custom content",
    });

    const result2 = await extractSkill({
      tarballStream: fileToWebStream(tarPath2),
      name: "github-skill",
      skillsDir,
      isGitHub: true,
      allowExt: [".custom"],
    });

    const files2 = await readdir(result2);
    expect(files2).toContain("special.custom");
    expect(files2).not.toContain("docs.unknownext");
  });

  it("requires --yes when shell or network permissions are declared in non-interactive mode", async () => {
    const tarPath = await createTarball(tmpDir, {
      "SKILL.md": makeSkillMd("perm-skill"),
      "skill.json": JSON.stringify({
        name: "perm-skill",
        permissions: { network: true, shell: false, filesystem: "read" },
      }),
    });

    // Without yes in non-interactive environment: fails
    await expect(
      extractSkill({
        tarballStream: fileToWebStream(tarPath),
        name: "perm-skill",
        skillsDir,
        yes: false,
      })
    ).rejects.toThrow("elevated permissions");

    // With yes: succeeds
    const result = await extractSkill({
      tarballStream: fileToWebStream(tarPath),
      name: "perm-skill",
      skillsDir,
      yes: true,
    });
    expect(existsSync(join(result, "SKILL.md"))).toBe(true);
  });
});
