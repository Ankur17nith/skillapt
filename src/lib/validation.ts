import { readFile, readdir, stat, open, unlink, mkdtemp, rm } from "node:fs/promises";
import { join, relative, resolve, extname, basename, isAbsolute, normalize, sep } from "node:path";
import { tmpdir } from "node:os";
import semver from "semver";
import { z } from "zod";
import YAML from "yaml";
import { extract as tarExtract } from "tar";
import type { Category, Permissions } from "./registry.js";

export const RESERVED_NAMES = new Set([
  "skillapt", "admin", "api", "www", "official", "registry", "support", "security", "root",
  "claude", "openai", "anthropic", "cursor", "codex", "antigravity", "gemini", "chatgpt",
  "null", "undefined", "core", "internal", "system", "auth", "account", "dashboard"
]);

export const ALLOWED_EXTENSIONS = new Set([
  ".md", ".txt", ".prompt", ".rst",
  ".json", ".yaml", ".yml", ".toml", ".csv", ".tsv",
  ".jinja", ".jinja2", ".mustache", ".hbs", ".template",
  ".js", ".mjs", ".cjs", ".ts", ".py", ".sh", ".bash", ".zsh", ".lua", ".rb",
  ".html", ".css", ".xml", ".xsd", ".svg",
  ".png", ".jpg", ".jpeg", ".pdf",
]);

export const ALLOWED_EXTENSIONLESS = new Set([
  "license", "licence", "notice", "readme", "makefile"
]);

export const ALLOWED_DOTFILES = new Set([
  ".gitignore", ".editorconfig"
]);

export const BANNED_EXTENSIONS = new Set([
  ".exe", ".dll", ".so", ".dylib", ".bin", ".elf", ".macho", ".com",
  ".tar", ".gz", ".zip", ".rar", ".7z", ".bz2"
]);

export const MAX_COMPRESSED_SIZE = 5 * 1024 * 1024; // 5 MB
export const MAX_UNCOMPRESSED_SIZE = 25 * 1024 * 1024; // 25 MB
export const MAX_FILE_COUNT = 500;
export const MAX_PATH_LENGTH = 255;
export const MAX_DEPTH = 10;
export const MAX_SKILL_MD_SIZE = 256 * 1024; // 256 KB
export const MIN_SKILL_MD_CHARS = 10;

export interface SkillManifest {
  name: string;
  version: string;
  description: string;
  license: string;
  repository?: string;
  keywords?: string[];
  category: Category;
  compatibility: string[];
  dependencies?: Record<string, string>;
  permissions: Permissions;
}

const NameRegex = /^(@[a-z0-9-]{2,30}\/)?[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

export const SkillManifestSchema = z.object({
  name: z.string().regex(NameRegex, "Name must be 3-50 chars: lowercase alphanumeric and hyphens, optional @scope/"),
  version: z.string().refine((val) => {
    if (val.includes("+")) return false;
    return semver.valid(val, { loose: false }) !== null;
  }, "Version must be valid SemVer 2.0.0 without build metadata (+...)"),
  description: z.string().min(10, "Description must be at least 10 chars").max(300, "Description max 300 chars"),
  license: z.string().min(1, "License required").max(50, "License max 50 chars"),
  repository: z.string().url("Repository must be a valid URL").max(255).optional(),
  keywords: z.array(z.string().regex(/^[a-z0-9-]{2,30}$/, "Keywords must be 2-30 lowercase alphanumeric/hyphen")).max(10).optional(),
  category: z.enum([
    "documents", "coding", "research", "data", "devtools", "communication", "productivity", "other"
  ] as const),
  compatibility: z.array(z.string().min(1)).min(1, "At least one compatibility target required").max(20),
  dependencies: z.record(z.string(), z.string()).optional().refine((deps) => {
    if (!deps) return true;
    const entries = Object.entries(deps);
    if (entries.length > 50) return false;
    for (const [depName, range] of entries) {
      if (!NameRegex.test(depName)) return false;
      if (!semver.validRange(range)) return false;
    }
    return true;
  }, "Dependencies must be a valid map of skill name -> semver range, max 50 items"),
  permissions: z.object({
    network: z.boolean(),
    shell: z.boolean(),
    filesystem: z.enum(["none", "read", "write", "read-write"]),
  }),
});

/** Extract unscoped name from potentially scoped package name: @scope/name -> name */
export function getUnscopedName(pkgName: string): string {
  if (pkgName.startsWith("@")) {
    const slash = pkgName.indexOf("/");
    return slash !== -1 ? pkgName.slice(slash + 1) : pkgName;
  }
  return pkgName;
}

export function validateSkillManifest(manifestData: unknown): SkillManifest {
  const parsed = SkillManifestSchema.parse(manifestData);

  const unscoped = getUnscopedName(parsed.name);
  if (RESERVED_NAMES.has(unscoped)) {
    throw new Error(`Package name '${parsed.name}' uses a reserved registry name '${unscoped}'.`);
  }

  return parsed as SkillManifest;
}

export function parseFrontmatter(markdown: string): Record<string, string> {
  const trimmed = markdown.trimStart();
  if (!trimmed.startsWith("---")) {
    throw new Error("SKILL.md must begin with YAML frontmatter demarcated by '---'.");
  }

  const lines = trimmed.split("\n");
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "---" || line === "...") {
      endIdx = i;
      break;
    }
  }

  if (endIdx === -1) {
    throw new Error("SKILL.md YAML frontmatter is not closed with '---'.");
  }

  const fmRaw = lines.slice(1, endIdx).join("\n");
  let parsed: unknown;
  try {
    parsed = YAML.parse(fmRaw);
  } catch (err: any) {
    throw new Error(`SKILL.md contains invalid YAML frontmatter: ${err.message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (value === null || value === undefined) {
      result[key] = "";
    } else if (typeof value === "string") {
      result[key] = value.trim();
    } else {
      result[key] = String(value).trim();
    }
  }
  return result;
}

/**
 * Rewrites the frontmatter `name` field in SKILL.md to a new name.
 */
export function rewriteFrontmatterName(content: string, newName: string): string {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) {
    return content;
  }
  const lines = content.split("\n");
  let endFmIdx = -1;
  let startFmIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "---" || line === "...") {
      if (startFmIdx === -1) {
        startFmIdx = i;
      } else {
        endFmIdx = i;
        break;
      }
    }
  }

  if (startFmIdx === -1 || endFmIdx === -1) {
    return content;
  }

  let replaced = false;
  for (let i = startFmIdx + 1; i < endFmIdx; i++) {
    const line = lines[i];
    const colonIdx = line.indexOf(":");
    if (colonIdx !== -1) {
      const key = line.slice(0, colonIdx).trim();
      if (key === "name") {
        lines[i] = `name: ${newName}`;
        replaced = true;
        break;
      }
    }
  }

  if (!replaced) {
    lines.splice(startFmIdx + 1, 0, `name: ${newName}`);
  }

  return lines.join("\n");
}

export function validateSkillMd(content: string, expectedName?: string): { name: string; description: string } {
  const nonWhitespace = content.replace(/\s/g, "");
  if (nonWhitespace.length < MIN_SKILL_MD_CHARS) {
    throw new Error(`SKILL.md must contain at least ${MIN_SKILL_MD_CHARS} non-whitespace characters.`);
  }

  const byteLength = Buffer.byteLength(content, "utf-8");
  if (byteLength > MAX_SKILL_MD_SIZE) {
    throw new Error(`SKILL.md exceeds maximum allowed size of 256 KB (${byteLength} bytes).`);
  }

  const fm = parseFrontmatter(content);
  if (!fm.name || !fm.name.trim()) {
    throw new Error("SKILL.md frontmatter must contain a 'name' field.");
  }
  if (!fm.description || !fm.description.trim()) {
    throw new Error("SKILL.md frontmatter must contain a 'description' field.");
  }

  if (expectedName) {
    const unscoped = getUnscopedName(expectedName);
    const fmUnscoped = getUnscopedName(fm.name.trim());
    if (fmUnscoped !== unscoped) {
      throw new Error(
        `SKILL.md frontmatter name '${fm.name}' does not match unscoped package name '${unscoped}'.`
      );
    }
  }

  return { name: fm.name.trim(), description: fm.description.trim() };
}

export function checkMagicBytes(buffer: Buffer, filePath: string): void {
  if (buffer.length >= 4) {
    // ELF: 0x7F 0x45 0x4C 0x46
    if (buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) {
      throw new Error(`File '${filePath}' contains ELF executable binary magic bytes, which is prohibited.`);
    }
    // Mach-O
    if (
      (buffer[0] === 0xfe && buffer[1] === 0xed && buffer[2] === 0xfa && (buffer[3] === 0xce || buffer[3] === 0xcf)) ||
      (buffer[0] === 0xcf && buffer[1] === 0xfa && buffer[2] === 0xed && buffer[3] === 0xfe) ||
      (buffer[0] === 0xce && buffer[1] === 0xfa && buffer[2] === 0xed && buffer[3] === 0xfe)
    ) {
      throw new Error(`File '${filePath}' contains Mach-O binary magic bytes, which is prohibited.`);
    }
    // Java class: 0xCA 0xFE 0xBA 0xBE
    if (buffer[0] === 0xca && buffer[1] === 0xfe && buffer[2] === 0xba && buffer[3] === 0xbe) {
      throw new Error(`File '${filePath}' contains Java class binary magic bytes, which is prohibited.`);
    }
  }
  if (buffer.length >= 2) {
    // Windows PE / MZ: 0x4D 0x5A ('MZ')
    if (buffer[0] === 0x4d && buffer[1] === 0x5a) {
      throw new Error(`File '${filePath}' contains Windows PE executable binary magic bytes, which is prohibited.`);
    }
  }
}

export interface ValidateTreeOptions {
  expectedName?: string;
  allowExt?: string[];
  isGitHub?: boolean;
  requireSkillJson?: boolean;
  excludeDirs?: string[];
}

export interface ValidateTreeResult {
  files: string[];
  totalSize: number;
  skippedFiles: string[];
  hasScripts: boolean;
}

/**
 * Validates an extracted skill directory tree according to SPEC.md section 13.
 * Enforces extension allowlist, banned extensions, hidden-file rules, magic bytes,
 * duplicate paths (case-insensitive and NFC), max depth, file count, and sizes.
 */
export async function validateSkillTree(
  dir: string,
  options: ValidateTreeOptions = {}
): Promise<ValidateTreeResult> {
  const result: string[] = [];
  const skippedFiles: string[] = [];
  const seenNormalizedPaths = new Set<string>();
  let totalSize = 0;
  let hasScripts = false;

  const allowedExts = new Set(ALLOWED_EXTENSIONS);
  if (options.allowExt) {
    for (const ext of options.allowExt) {
      const normalizedExt = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
      allowedExts.add(normalizedExt);
    }
  }

  const excludedDirs = (options.excludeDirs ?? []).map((d) => resolve(d));

  async function walk(currentDir: string, relPath: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) {
      throw new Error(`Directory depth exceeds maximum limit of ${MAX_DEPTH} levels.`);
    }

    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      const resolvedFullPath = resolve(fullPath);

      if (entry.isDirectory()) {
        // Exclude node_modules and output directories
        if (entry.name === "node_modules") {
          continue;
        }
        let isExcluded = false;
        for (const excl of excludedDirs) {
          if (resolvedFullPath === excl || resolvedFullPath.startsWith(excl + "/")) {
            isExcluded = true;
            break;
          }
        }
        if (isExcluded) {
          continue;
        }
      } else if (entry.isFile()) {
        // Exclude *.tgz archives
        if (entry.name.endsWith(".tgz")) {
          continue;
        }
      }

      const entryRel = relPath ? `${relPath}/${entry.name}` : entry.name;

      if (entryRel.length > MAX_PATH_LENGTH) {
        throw new Error(`Path '${entryRel}' exceeds maximum length of ${MAX_PATH_LENGTH} characters.`);
      }

      // Reject ".." only as a path segment, not as a substring
      const segments = entryRel.split(/[/\\]/);
      if (segments.some((seg) => seg === "..") || entryRel.startsWith("/") || entryRel.startsWith("\\")) {
        throw new Error(`Path '${entryRel}' contains forbidden path traversal.`);
      }

      // Duplicate path check (case-insensitive and Unicode NFC)
      const nfcKey = entryRel.normalize("NFC").toLowerCase();
      if (seenNormalizedPaths.has(nfcKey)) {
        throw new Error(`Duplicate path detected (case-insensitive or NFC collision): '${entryRel}'.`);
      }
      seenNormalizedPaths.add(nfcKey);

      // Check hidden file / directory
      if (entry.name.startsWith(".")) {
        if (!ALLOWED_DOTFILES.has(entry.name)) {
          throw new Error(`Hidden file or directory '${entryRel}' is prohibited in skill packages.`);
        }
      }

      if (entry.isSymbolicLink()) {
        throw new Error(`Symbolic link '${entryRel}' is prohibited.`);
      }

      if (entry.isDirectory()) {
        if (entry.name === "scripts") {
          hasScripts = true;
        }
        await walk(fullPath, entryRel, depth + 1);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        const base = basename(entry.name);
        const baseLower = base.toLowerCase();

        if (BANNED_EXTENSIONS.has(ext)) {
          throw new Error(`Binary or archive extension '${ext}' in '${entryRel}' is prohibited.`);
        }

        const isAllowed =
          allowedExts.has(ext) ||
          ALLOWED_DOTFILES.has(base) ||
          (ext === "" && ALLOWED_EXTENSIONLESS.has(baseLower));

        if (!isAllowed) {
          if (options.isGitHub) {
            // For GitHub installs, skip non-allowed files and unlink them so they are not installed
            skippedFiles.push(entryRel);
            await unlink(fullPath);
            continue;
          } else {
            throw new Error(`File extension '${ext}' in '${entryRel}' is not on the allowed files list.`);
          }
        }

        const fileStat = await stat(fullPath);
        totalSize += fileStat.size;

        if (totalSize > MAX_UNCOMPRESSED_SIZE) {
          throw new Error(
            `Uncompressed package size exceeds maximum limit of 25 MB (${totalSize} bytes).`
          );
        }

        // Magic byte check on first 512 bytes
        const fd = await open(fullPath, "r");
        try {
          const headerBuf = Buffer.alloc(Math.min(512, fileStat.size));
          await fd.read(headerBuf, 0, headerBuf.length, 0);
          checkMagicBytes(headerBuf, entryRel);
        } finally {
          await fd.close();
        }

        if (entryRel.startsWith("scripts/")) {
          hasScripts = true;
        }

        result.push(entryRel);

        if (result.length > MAX_FILE_COUNT) {
          throw new Error(`Package exceeds maximum file count limit of ${MAX_FILE_COUNT} files.`);
        }
      } else {
        throw new Error(`Special file or device '${entryRel}' is prohibited.`);
      }
    }
  }

  await walk(dir, "", 1);

  // Validate SKILL.md existence and frontmatter
  const skillMdPath = join(dir, "SKILL.md");
  let skillMdContent: string;
  try {
    skillMdContent = await readFile(skillMdPath, "utf-8");
  } catch {
    throw new Error("This repo is not a valid skill — it must contain a SKILL.md file.");
  }

  validateSkillMd(skillMdContent, options.expectedName);

  if (options.requireSkillJson) {
    const skillJsonPath = join(dir, "skill.json");
    try {
      await readFile(skillJsonPath, "utf-8");
    } catch {
      throw new Error("Missing required 'skill.json' manifest in skill directory.");
    }
  }

  result.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  return {
    files: result,
    totalSize,
    skippedFiles,
    hasScripts,
  };
}

/**
 * Validates a skill tarball (.tgz) locally according to SPEC.md section 13.
 * Used before uploading to registry during publish.
 */
export async function validateSkillTarball(
  tarballPath: string
): Promise<{ manifest: SkillManifest; fileCount: number; totalSize: number }> {
  const statInfo = await stat(tarballPath);
  if (statInfo.size > MAX_COMPRESSED_SIZE) {
    throw new Error(
      `Compressed tarball exceeds maximum limit of 5 MB (${statInfo.size} bytes).`
    );
  }

  const tempValDir = await mkdtemp(join(tmpdir(), "skillapt-val-tar-"));
  try {
    let fileCount = 0;
    let uncompressedBytes = 0;

    await tarExtract({
      file: tarballPath,
      cwd: tempValDir,
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

        if (entry.path.length > MAX_PATH_LENGTH) {
          throw new Error(
            `Security: path in tarball exceeds ${MAX_PATH_LENGTH} characters — "${entry.path.slice(0, 50)}...". Aborting.`
          );
        }

        if (entry.path.includes("\0")) {
          throw new Error(`Security: tarball entry path contains null byte. Aborting.`);
        }

        if (entry.type === "SymbolicLink" || entry.type === "Link") {
          throw new Error(`Security: tarball contains a link — "${entry.path}". Aborting.`);
        }

        const allowedTypes = ["File", "Directory", "OldFile"];
        if (!allowedTypes.includes(entry.type)) {
          throw new Error(
            `Security: tarball entry type "${entry.type}" is not permitted — "${entry.path}". Aborting.`
          );
        }

        if (isAbsolute(entry.path) || /^[a-zA-Z]:/.test(entry.path)) {
          throw new Error(`Security: tarball contains an absolute path — "${entry.path}". Aborting.`);
        }

        const normalized = normalize(entry.path);
        if (
          normalized.startsWith("..") ||
          normalized.includes(`${sep}..`) ||
          normalized.includes(`..${sep}`)
        ) {
          throw new Error(`Security: tarball contains a path traversal — "${entry.path}". Aborting.`);
        }
      },
    });

    let sourceDir = tempValDir;
    const topEntries = await readdir(tempValDir);
    if (topEntries.length === 1) {
      const singlePath = join(tempValDir, topEntries[0]);
      const s = await stat(singlePath);
      if (s.isDirectory()) {
        sourceDir = singlePath;
      }
    }

    const manifestPath = join(sourceDir, "skill.json");
    let manifestRaw: string;
    try {
      manifestRaw = await readFile(manifestPath, "utf-8");
    } catch {
      throw new Error("Tarball must contain a 'skill.json' file.");
    }

    let manifestJson: unknown;
    try {
      manifestJson = JSON.parse(manifestRaw);
    } catch {
      throw new Error("skill.json contains invalid JSON syntax.");
    }

    const manifest = validateSkillManifest(manifestJson);

    const skillMdPath = join(sourceDir, "SKILL.md");
    let skillMdContent: string;
    try {
      skillMdContent = await readFile(skillMdPath, "utf-8");
    } catch {
      throw new Error("Tarball is not a valid skill — it must contain a SKILL.md file.");
    }

    validateSkillMd(skillMdContent, manifest.name);

    const tree = await validateSkillTree(sourceDir, {
      expectedName: manifest.name,
      requireSkillJson: true,
    });

    return {
      manifest,
      fileCount: tree.files.length,
      totalSize: tree.totalSize,
    };
  } finally {
    await rm(tempValDir, { recursive: true, force: true });
  }
}
