import { extract } from "tar";
import { mkdtemp, rm, rename, readdir, stat, access, mkdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join, resolve, normalize, isAbsolute, basename, sep } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { moveDir } from "./fs.js";

/**
 * Safely extract a GitHub tarball into .skills/<name>/.
 *
 * Security checks:
 * 1. Extracts to a temp folder first (never directly to the target).
 * 2. Strips GitHub's top-level directory (repo-sha/).
 * 3. Blocks symlinks — GitHub tarballs shouldn't have them.
 * 4. Blocks absolute paths in tar entries.
 * 5. Blocks path traversal ("../" in any entry path).
 * 6. Validates the result contains SKILL.md or skill.json.
 * 7. Cleans up the temp folder on any error.
 */
export async function extractSkill(options: {
  tarballStream: ReadableStream<Uint8Array>;
  name: string;
  skillsDir: string;
  subpath?: string | null;
}): Promise<string> {
  const { tarballStream, name, skillsDir, subpath } = options;

  // Validate skill name to prevent path traversal via the name itself
  if (name.includes("..") || name.includes("/") || name.includes("\\") || isAbsolute(name)) {
    throw new Error(`Invalid skill name: "${name}"`);
  }

  const targetDir = resolve(skillsDir, name);
  const tmpDir = await mkdtemp(join(tmpdir(), "skillpm-extract-"));
  const extractDir = join(tmpDir, "contents");

  try {
    // Create extraction directory
    await mkdir(extractDir, { recursive: true });

    // Step 1: Save tarball to a temp file, then extract
    const tarFile = join(tmpDir, "archive.tar.gz");
    const nodeStream = Readable.fromWeb(tarballStream as import("stream/web").ReadableStream<Uint8Array>);
    await pipeline(nodeStream, createWriteStream(tarFile));

    // Step 2: Extract with security checks
    await extract({
      file: tarFile,
      cwd: extractDir,
      strip: 1, // Strip GitHub's top-level "repo-sha/" directory
      onReadEntry(entry) {
        // SECURITY: Block symlinks
        if (entry.type === "SymbolicLink" || entry.type === "Link") {
          throw new Error(
            `Security: tarball contains a symlink — "${entry.path}". Aborting.`
          );
        }

        // SECURITY: Block absolute paths
        if (isAbsolute(entry.path)) {
          throw new Error(
            `Security: tarball contains an absolute path — "${entry.path}". Aborting.`
          );
        }

        // SECURITY: Block path traversal
        const normalized = normalize(entry.path);
        if (normalized.startsWith("..") || normalized.includes(`${sep}..`)) {
          throw new Error(
            `Security: tarball contains a path traversal — "${entry.path}". Aborting.`
          );
        }
      },
    });

    // Step 3: If a subpath was given, use only that subfolder
    let sourceDir = extractDir;
    if (subpath) {
      const subDir = join(extractDir, subpath);
      // SECURITY: Make sure the subpath doesn't escape
      const resolvedSub = resolve(subDir);
      if (!resolvedSub.startsWith(resolve(extractDir))) {
        throw new Error(
          `Security: subpath "${subpath}" would escape the extraction directory.`
        );
      }

      try {
        await access(subDir);
      } catch {
        throw new Error(
          `Subpath "${subpath}" not found in the repository.`
        );
      }

      const stats = await stat(subDir);
      if (!stats.isDirectory()) {
        throw new Error(`Subpath "${subpath}" is not a directory.`);
      }

      sourceDir = subDir;
    }

    // Step 4: Validate the skill — must contain SKILL.md or skill.json
    const entries = await readdir(sourceDir);
    const hasSkillMd = entries.includes("SKILL.md");
    const hasSkillJson = entries.includes("skill.json");

    if (!hasSkillMd && !hasSkillJson) {
      throw new Error(
        "This repo is not a valid skill — it must contain a SKILL.md or skill.json file."
      );
    }

    // Step 5: Move to the final target directory
    // Remove existing installation if present
    await rm(targetDir, { recursive: true, force: true });

    // Ensure the parent skills directory exists
    await mkdir(skillsDir, { recursive: true });

    await moveDir(sourceDir, targetDir);

    return targetDir;
  } finally {
    // ALWAYS clean up the temp folder
    await rm(tmpDir, { recursive: true, force: true });
  }
}
