import { readFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import * as tar from "tar";
import {
  RESERVED_NAMES,
  ALLOWED_EXTENSIONS,
  ALLOWED_EXTENSIONLESS,
  ALLOWED_DOTFILES,
  BANNED_EXTENSIONS,
  MAX_COMPRESSED_SIZE,
  MAX_UNCOMPRESSED_SIZE,
  MAX_FILE_COUNT,
  MAX_PATH_LENGTH,
  MAX_SKILL_MD_SIZE,
  MIN_SKILL_MD_CHARS,
  MAX_DEPTH,
  SkillManifest,
  SkillManifestSchema,
  getUnscopedName,
  validateSkillManifest,
  parseFrontmatter,
  validateSkillMd,
  checkMagicBytes,
  validateSkillTree,
  validateSkillTarball,
} from "./validation.js";

export {
  RESERVED_NAMES,
  ALLOWED_EXTENSIONS,
  ALLOWED_EXTENSIONLESS,
  ALLOWED_DOTFILES,
  BANNED_EXTENSIONS,
  MAX_COMPRESSED_SIZE,
  MAX_UNCOMPRESSED_SIZE,
  MAX_FILE_COUNT,
  MAX_PATH_LENGTH,
  MAX_SKILL_MD_SIZE,
  MIN_SKILL_MD_CHARS,
  MAX_DEPTH,
  SkillManifest,
  SkillManifestSchema,
  getUnscopedName,
  validateSkillManifest,
  parseFrontmatter,
  validateSkillMd,
  checkMagicBytes,
  validateSkillTree,
  validateSkillTarball,
};

export async function validateAndCollectFiles(
  dir: string,
  excludeDirs?: string[]
): Promise<{ files: string[]; totalSize: number }> {
  const tree = await validateSkillTree(dir, {
    requireSkillJson: true,
    excludeDirs,
  });
  return { files: tree.files, totalSize: tree.totalSize };
}

export interface PackResult {
  tarballPath: string;
  tarballBuffer: Buffer;
  sha256: string;
  integrity: string;
  manifest: SkillManifest;
  fileCount: number;
  uncompressedSize: number;
  compressedSize: number;
}

/**
 * Validates skill files and creates a .tar.gz tarball in outDir (defaults to ./dist).
 */
export async function packSkill(
  dir: string = ".",
  outDir?: string
): Promise<PackResult> {
  const resolvedDir = resolve(dir);
  const targetOutDir = outDir ? resolve(outDir) : resolve(join(resolvedDir, "dist"));
  await mkdir(targetOutDir, { recursive: true });

  // 1. Read & validate skill.json
  const manifestPath = join(resolvedDir, "skill.json");
  let manifestRaw: string;
  try {
    manifestRaw = await readFile(manifestPath, "utf-8");
  } catch {
    throw new Error(`Cannot read 'skill.json' at ${manifestPath}`);
  }

  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(manifestRaw);
  } catch {
    throw new Error("skill.json contains invalid JSON syntax.");
  }

  const manifest = validateSkillManifest(manifestJson);

  // 2. Read & validate SKILL.md
  const skillMdPath = join(resolvedDir, "SKILL.md");
  let skillMdContent: string;
  try {
    skillMdContent = await readFile(skillMdPath, "utf-8");
  } catch {
    throw new Error(`Cannot read 'SKILL.md' at ${skillMdPath}`);
  }

  validateSkillMd(skillMdContent, manifest.name);

  // 3. Validate all files using shared validateSkillTree, excluding output directory
  const { files, totalSize } = await validateAndCollectFiles(resolvedDir, [targetOutDir]);
  files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  // 4. Create tar.gz archive
  const unscoped = getUnscopedName(manifest.name);
  const tarballName = `${unscoped}-${manifest.version}.tgz`;
  const tarballPath = join(targetOutDir, tarballName);

  await tar.create(
    {
      gzip: true,
      cwd: resolvedDir,
      file: tarballPath,
      portable: true,
      noMtime: true,
      mtime: new Date(0),
    },
    files
  );

  // 5. Read back archive & verify compressed limit
  const tarballBuffer = await readFile(tarballPath);
  if (tarballBuffer.length > MAX_COMPRESSED_SIZE) {
    throw new Error(
      `Compressed tarball exceeds maximum limit of 5 MB (${tarballBuffer.length} bytes).`
    );
  }

  const sha256 = createHash("sha256").update(tarballBuffer).digest("hex");
  const integrity = `sha256-${sha256}`;

  return {
    tarballPath,
    tarballBuffer,
    sha256,
    integrity,
    manifest,
    fileCount: files.length,
    uncompressedSize: totalSize,
    compressedSize: tarballBuffer.length,
  };
}
