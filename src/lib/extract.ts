import { extract } from "tar";
import { mkdtemp, rm, readdir, stat, access, mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve, normalize, isAbsolute, sep } from "node:path";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import pc from "picocolors";
import { moveDir, assertInside } from "./fs.js";
import { validateSkillTree, parseFrontmatter, rewriteFrontmatterName } from "./validation.js";
import { isValidRegistryName, toOnDiskName } from "./source.js";

// ── Security Limits from SPEC.md ──

/** Maximum compressed archive size: 5 MB */
export const MAX_COMPRESSED_SIZE = 5 * 1024 * 1024; // 5,242,880 bytes

/** Maximum uncompressed payload size: 25 MB (prevents zip bombs) */
export const MAX_UNCOMPRESSED_SIZE = 25 * 1024 * 1024; // 26,214,400 bytes

/** Maximum file count: 500 files */
export const MAX_FILE_COUNT = 500;

/** Maximum file path length: 255 characters */
export const MAX_PATH_LENGTH = 255;

export interface ExtractSkillOptions {
  tarballStream: ReadableStream<Uint8Array>;
  name: string;
  skillsDir: string;
  subpath?: string | null;
  expectedSha256?: string;
  allowExt?: string[];
  isGitHub?: boolean;
  yes?: boolean;
}

/**
 * Safely extract a skill tarball into skillsDir/<name>/.
 *
 * Security checks enforced:
 * 1. Verifies SHA-256 hash BEFORE extraction if expectedSha256 is provided (aborts immediately on mismatch).
 * 2. Enforces maximum compressed archive size (5 MB).
 * 3. Enforces maximum uncompressed payload size (25 MB) to block zip bombs.
 * 4. Enforces maximum file count (500 files) to block inode exhaustion.
 * 5. Enforces maximum file path length (255 characters).
 * 6. Blocks symlinks and hardlinks.
 * 7. Blocks device nodes, FIFOs, and sockets.
 * 8. Blocks absolute paths and path traversal ("..") in tar entries.
 * 9. Rejects null bytes in paths.
 * 10. Validates subpath doesn't escape extraction boundary.
 * 11. Validates resulting package contains SKILL.md with frontmatter matching name.
 * 12. Validates extension allowlist, banned extensions, magic bytes, duplicate paths (case-insensitive & NFC), max depth.
 * 13. Verifies declared permissions and scripts, prompting or requiring --yes for elevated permissions.
 * 14. Extracts into a temp dir and swaps atomically so failed installs never delete the previous version.
 * 15. Cleans up temp directories on error.
 */
export async function extractSkill(options: ExtractSkillOptions): Promise<string> {
  const { tarballStream, name, skillsDir, subpath, expectedSha256, allowExt, isGitHub, yes } = options;

  // Validate skill name to prevent path traversal
  validateSkillTargetName(name);

  // Buffer the stream to calculate SHA-256 and enforce compressed size limit
  const chunks: Uint8Array[] = [];
  let totalCompressedBytes = 0;

  const reader = tarballStream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalCompressedBytes += value.byteLength;
        if (totalCompressedBytes > MAX_COMPRESSED_SIZE) {
          throw new Error(
            `Security: tarball exceeds maximum compressed size of ${MAX_COMPRESSED_SIZE} bytes (5 MB). Aborting.`
          );
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Combine chunks into single Buffer
  const totalLength = chunks.reduce((acc, c) => acc + c.byteLength, 0);
  const tarballBuffer = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    tarballBuffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  // Step 1: Verify SHA-256 BEFORE extracting if expectedSha256 is specified
  if (expectedSha256) {
    const computedSha256 = createHash("sha256").update(tarballBuffer).digest("hex");
    const cleanExpected = expectedSha256.replace(/^sha256-/, "").trim().toLowerCase();
    if (computedSha256.toLowerCase() !== cleanExpected) {
      throw new Error(
        `Integrity check failed for "${name}": expected sha256 ${cleanExpected}, got ${computedSha256}. Aborting.`
      );
    }
  }

  // Setup directories
  const tmpDir = await mkdtemp(join(tmpdir(), "skillapt-extract-"));
  const extractDir = join(tmpDir, "contents");

  try {
    await mkdir(extractDir, { recursive: true });
    const tarFile = join(tmpDir, "archive.tar.gz");
    await writeFile(tarFile, tarballBuffer);

    let uncompressedBytes = 0;
    let fileCount = 0;

    // Step 2: Extract with strict security guards
    await extract({
      file: tarFile,
      cwd: extractDir,
      onReadEntry(entry) {
        fileCount++;
        if (fileCount > MAX_FILE_COUNT) {
          throw new Error(
            `Security: tarball contains more than ${MAX_FILE_COUNT} files. Aborting.`
          );
        }

        uncompressedBytes += entry.size || 0;
        if (uncompressedBytes > MAX_UNCOMPRESSED_SIZE) {
          throw new Error(
            `Security: tarball uncompressed size exceeds ${MAX_UNCOMPRESSED_SIZE} bytes (25 MB). Aborting.`
          );
        }

        // SECURITY: Block path length exceeding 255 chars
        if (entry.path.length > MAX_PATH_LENGTH) {
          throw new Error(
            `Security: path in tarball exceeds ${MAX_PATH_LENGTH} characters — "${entry.path.slice(0, 50)}...". Aborting.`
          );
        }

        // SECURITY: Block null bytes
        if (entry.path.includes("\0")) {
          throw new Error(
            `Security: tarball entry path contains null byte. Aborting.`
          );
        }

        // SECURITY: Block symlinks and hardlinks
        if (entry.type === "SymbolicLink" || entry.type === "Link") {
          throw new Error(
            `Security: tarball contains a link — "${entry.path}". Aborting.`
          );
        }

        // SECURITY: Only allow regular files and directories (block devices, fifos)
        const allowedTypes = ["File", "Directory", "OldFile"];
        if (!allowedTypes.includes(entry.type)) {
          throw new Error(
            `Security: tarball entry type "${entry.type}" is not permitted — "${entry.path}". Aborting.`
          );
        }

        // SECURITY: Block absolute paths
        if (isAbsolute(entry.path) || /^[a-zA-Z]:/.test(entry.path)) {
          throw new Error(
            `Security: tarball contains an absolute path — "${entry.path}". Aborting.`
          );
        }

        // SECURITY: Block path traversal
        const normalized = normalize(entry.path);
        if (
          normalized.startsWith("..") ||
          normalized.includes(`${sep}..`) ||
          normalized.includes(`..${sep}`)
        ) {
          throw new Error(
            `Security: tarball contains a path traversal — "${entry.path}". Aborting.`
          );
        }
      },
    });

    // Step 3: Determine real root directory inside archive
    let sourceDir = extractDir;
    const topEntries = await readdir(extractDir);

    if (topEntries.length === 1) {
      const singlePath = join(extractDir, topEntries[0]);
      const s = await stat(singlePath);
      if (s.isDirectory()) {
        sourceDir = singlePath;
      }
    }

    // Step 4: If subpath specified, use only that subfolder
    if (subpath) {
      const subDir = assertInside(sourceDir, subpath);

      try {
        await access(subDir);
      } catch {
        throw new Error(`Subpath "${subpath}" not found in the repository.`);
      }

      const stats = await stat(subDir);
      if (!stats.isDirectory()) {
        throw new Error(`Subpath "${subpath}" is not a directory.`);
      }

      sourceDir = subDir;
    }

    // Determine effective skill name (for GitHub, inspect skill.json / SKILL.md if present)
    let effectiveName = name;
    if (isGitHub) {
      try {
        const raw = await readFile(join(sourceDir, "skill.json"), "utf-8");
        const json = JSON.parse(raw);
        if (typeof json.name === "string" && isValidRegistryName(json.name.trim())) {
          effectiveName = json.name.trim();
        }
      } catch {
        try {
          const rawMd = await readFile(join(sourceDir, "SKILL.md"), "utf-8");
          const fm = parseFrontmatter(rawMd);
          if (fm.name && isValidRegistryName(fm.name.trim())) {
            effectiveName = fm.name.trim();
          }
        } catch {
          // keep effectiveName = name
        }
      }
    }

    // Step 5: Content Verification on extracted tree BEFORE touching targetDir
    const treeResult = await validateSkillTree(sourceDir, {
      expectedName: effectiveName,
      allowExt,
      isGitHub,
    });

    if (isGitHub && treeResult.skippedFiles.length > 0) {
      console.warn(
        pc.yellow(
          `Warning: Skipped ${treeResult.skippedFiles.length} file(s) from GitHub repository not in allowed extensions list:\n  ${treeResult.skippedFiles.slice(0, 10).join("\n  ")}${treeResult.skippedFiles.length > 10 ? `\n  ... and ${treeResult.skippedFiles.length - 10} more` : ""}`
        )
      );
    }

    // Step 6: Print declared permissions & require confirmation for elevated permissions
    let permissions = { network: false, shell: false, filesystem: "none" };
    try {
      const raw = await readFile(join(sourceDir, "skill.json"), "utf-8");
      const json = JSON.parse(raw);
      if (json.permissions && typeof json.permissions === "object") {
        permissions = {
          network: Boolean(json.permissions.network),
          shell: Boolean(json.permissions.shell),
          filesystem: typeof json.permissions.filesystem === "string" ? json.permissions.filesystem : "none",
        };
      }
    } catch {
      // default permissions
    }

    console.log(pc.bold(`\nDeclared permissions for ${effectiveName}:`));
    console.log(`  • Network:    ${permissions.network ? pc.yellow("true") : pc.green("false")}`);
    console.log(`  • Shell:      ${permissions.shell ? pc.yellow("true") : pc.green("false")}`);
    console.log(`  • Filesystem: ${permissions.filesystem !== "none" ? pc.yellow(permissions.filesystem) : pc.green("none")}`);
    console.log(`  • Scripts:    ${treeResult.hasScripts ? pc.yellow("yes (contains scripts/)") : pc.green("no")}`);

    if (permissions.network || permissions.shell) {
      if (!yes) {
        if (process.stdin.isTTY) {
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          const reasons = [permissions.network && "network", permissions.shell && "shell"].filter(Boolean).join(", ");
          const answer = await new Promise<string>((resolve) => {
            rl.question(`Skill "${effectiveName}" requests elevated permissions (${reasons}). Proceed with install? [y/N] `, resolve);
          });
          rl.close();
          if (!/^y(es)?$/i.test(answer.trim())) {
            throw new Error(`Installation of "${effectiveName}" aborted by user.`);
          }
        } else {
          const reasons = [permissions.network && "network", permissions.shell && "shell"].filter(Boolean).join(", ");
          throw new Error(
            `Skill "${effectiveName}" requests elevated permissions (${reasons}). Pass --yes (-y) to confirm.`
          );
        }
      }
    }

    // Step 7: Flatten scoped name for on-disk folder & rewrite SKILL.md name
    const onDiskName = toOnDiskName(effectiveName);
    if (effectiveName.startsWith("@")) {
      const skillMdPath = join(sourceDir, "SKILL.md");
      try {
        const md = await readFile(skillMdPath, "utf-8");
        const rewritten = rewriteFrontmatterName(md, onDiskName);
        await writeFile(skillMdPath, rewritten, "utf-8");
      } catch {
        // ignore if cannot rewrite
      }
    }

    // Step 8: Atomic swap into targetDir
    const targetDir = assertInside(skillsDir, onDiskName);
    await mkdir(resolve(targetDir, ".."), { recursive: true });

    if (existsSync(targetDir)) {
      // Check for collision with an existing package of different name
      try {
        const existingRaw = await readFile(join(targetDir, "skill.json"), "utf-8");
        const existingJson = JSON.parse(existingRaw);
        if (
          existingJson.name &&
          existingJson.name !== effectiveName &&
          toOnDiskName(existingJson.name) === onDiskName
        ) {
          throw new Error(
            `Naming collision: directory "${onDiskName}" is already occupied by package "${existingJson.name}". Cannot install "${effectiveName}".`
          );
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.message.startsWith("Naming collision:")) {
          throw err;
        }
      }

      const backupDir = join(tmpDir, `backup-target-${Date.now()}`);
      await moveDir(targetDir, backupDir);
      try {
        await moveDir(sourceDir, targetDir);
      } catch (err) {
        // Rollback on failure
        await moveDir(backupDir, targetDir);
        throw err;
      }
    } else {
      await moveDir(sourceDir, targetDir);
    }

    return targetDir;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Validate that skill target name does not contain path traversal.
 */
function validateSkillTargetName(name: string): void {
  if (!name || !name.trim()) {
    throw new Error("Invalid skill name: cannot be empty.");
  }
  if (name.includes("..") || name.includes("\\") || isAbsolute(name)) {
    throw new Error(`Invalid skill name: "${name}"`);
  }
  // Allow scoped packages e.g. @scope/name, but prevent multiple / or empty segments
  const parts = name.split("/");
  if (parts.length > 2) {
    throw new Error(`Invalid skill name: "${name}"`);
  }
  if (parts.some((p) => !p || p === "." || p === "..")) {
    throw new Error(`Invalid skill name: "${name}"`);
  }
}
