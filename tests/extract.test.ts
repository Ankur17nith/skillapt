import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReadStream } from "node:fs";
import { pack, type Pack } from "tar";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { extractSkill } from "../src/lib/extract.js";

/** Helper: create a tar.gz from an object of { path: content } entries. */
async function createTarball(
  dir: string,
  entries: Record<string, string>,
  opts?: { symlink?: { path: string; target: string } }
): Promise<string> {
  // Create files on disk under a "repo-sha" top-level dir (simulating GitHub)
  const topDir = join(dir, "myrepo-abc123");
  await mkdir(topDir, { recursive: true });

  for (const [filePath, content] of Object.entries(entries)) {
    const fullPath = join(topDir, filePath);
    await mkdir(join(fullPath, ".."), { recursive: true });
    await writeFile(fullPath, content, "utf-8");
  }

  const tarPath = join(dir, "test.tar.gz");

  // Use node tar to pack
  const { create } = await import("tar");
  await create(
    {
      gzip: true,
      file: tarPath,
      cwd: dir,
    },
    ["myrepo-abc123"]
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
    tmpDir = await mkdtemp(join(tmpdir(), "skillpm-extract-test-"));
    skillsDir = join(tmpDir, ".skills");
    await mkdir(skillsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("extracts a valid skill with SKILL.md", async () => {
    const tarPath = await createTarball(tmpDir, {
      "SKILL.md": "# My Skill\nDoes something cool.",
    });

    const result = await extractSkill({
      tarballStream: fileToWebStream(tarPath),
      name: "my-skill",
      skillsDir,
    });

    const files = await readdir(result);
    expect(files).toContain("SKILL.md");
  });

  it("extracts a valid skill with skill.json", async () => {
    const tarPath = await createTarball(tmpDir, {
      "skill.json": '{"name": "test"}',
    });

    const result = await extractSkill({
      tarballStream: fileToWebStream(tarPath),
      name: "test",
      skillsDir,
    });

    const files = await readdir(result);
    expect(files).toContain("skill.json");
  });

  it("rejects a repo without SKILL.md or skill.json", async () => {
    const tarPath = await createTarball(tmpDir, {
      "README.md": "Not a skill",
    });

    await expect(
      extractSkill({
        tarballStream: fileToWebStream(tarPath),
        name: "bad",
        skillsDir,
      })
    ).rejects.toThrow("not a valid skill");
  });

  it("extracts subpath when provided", async () => {
    const tarPath = await createTarball(tmpDir, {
      "skills/my-skill/SKILL.md": "# Sub Skill",
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
      "SKILL.md": "# Root Skill",
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
      "SKILL.md": "# Skill",
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
      "SKILL.md": "# Version 1",
    });

    await extractSkill({
      tarballStream: fileToWebStream(tarPath1),
      name: "my-skill",
      skillsDir,
    });

    // Create a new tarball for "version 2"
    const tmpDir2 = await mkdtemp(join(tmpdir(), "skillpm-extract-v2-"));
    try {
      const tarPath2 = await createTarball(tmpDir2, {
        "SKILL.md": "# Version 2",
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

  it("rejects subpath that tries to escape", async () => {
    const tarPath = await createTarball(tmpDir, {
      "SKILL.md": "# Skill",
    });

    await expect(
      extractSkill({
        tarballStream: fileToWebStream(tarPath),
        name: "test",
        skillsDir,
        subpath: "../../etc",
      })
    ).rejects.toThrow("escape");
  });

  it("verifies sha256 and succeeds on match", async () => {
    const { readFile } = await import("node:fs/promises");
    const { createHash } = await import("node:crypto");

    const tarPath = await createTarball(tmpDir, {
      "SKILL.md": "# Verified Skill",
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
      "SKILL.md": "# Tampered Skill",
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

  it("extracts flat tarball without top-level repo-sha folder", async () => {
    // Create archive directly at root
    const flatDir = join(tmpDir, "flat-source");
    await mkdir(flatDir, { recursive: true });
    await writeFile(join(flatDir, "SKILL.md"), "# Flat Skill");

    const flatTar = join(tmpDir, "flat.tar.gz");
    const { create } = await import("tar");
    await create({ gzip: true, file: flatTar, cwd: flatDir }, ["SKILL.md"]);

    const result = await extractSkill({
      tarballStream: fileToWebStream(flatTar),
      name: "flat-skill",
      skillsDir,
    });

    const files = await readdir(result);
    expect(files).toContain("SKILL.md");
  });
});
