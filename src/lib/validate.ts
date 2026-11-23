import { readFile, readdir, stat, open, unlink, mkdtemp, rm } from "node:fs/promises";
import { join, relative, resolve, extname, basename, isAbsolute, normalize, sep } from "node:path";
import { tmpdir } from "node:os";
import semver from "semver";
import { z } from "zod";
import YAML from "yaml";
import { extract as tarExtract } from "tar";
import type { Category, Permissions } from "./registry.js";
import { toOnDiskName } from "./source.js";

// ── Reserved Names ──
export const RESERVED_NAMES = new Set([
  "skillapt", "admin", "api", "www", "official", "registry", "support", "security", "root",
  "claude", "openai", "anthropic", "cursor", "codex", "antigravity", "gemini", "chatgpt",
  "null", "undefined", "core", "internal", "system", "auth", "account", "dashboard"
]);

// ── Allowed Extensions (no images/PDF/fonts yet) ──
export const ALLOWED_EXTENSIONS = new Set([
  ".md", ".txt", ".prompt", ".rst",
  ".json", ".yaml", ".yml", ".toml", ".csv", ".tsv",
  ".jinja", ".jinja2", ".mustache", ".hbs", ".template",
  ".js", ".mjs", ".cjs", ".ts", ".py", ".sh", ".bash", ".zsh", ".lua", ".rb",
  ".html", ".css", ".xml", ".xsd", ".svg",
]);

// ── Extensionless allowed files ──
export const ALLOWED_EXTENSIONLESS = new Set([
  "license", "licence", "notice", "readme", "changelog", "makefile"
]);

// ── Allowed Dotfiles ──
export const ALLOWED_DOTFILES = new Set([
  ".gitignore", ".editorconfig"
]);

// ── Banned Binary / Archive Extensions ──
export const BANNED_EXTENSIONS = new Set([
  ".exe", ".dll", ".so", ".dylib", ".bin", ".elf", ".macho", ".com",
  ".tar", ".gz", ".zip", ".rar", ".7z", ".bz2"
]);

// ── Limits from CONTENT RULES ──
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

export const NameRegex = /^(@[a-z0-9]+(-[a-z0-9]+)*\/)?[a-z0-9]+(-[a-z0-9]+)*$/;

export const SkillManifestSchema = z.object({
  name: z.string().superRefine((val, ctx) => {
    if (val.includes("--")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Package names and scopes may not contain '--'",
      });
      return;
    }
    if (!NameRegex.test(val)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Name must be 3-50 chars: lowercase alphanumeric and single hyphens (no '--'), optional @scope/ (2-30 chars)",
      });
      return;
    }
    if (val.startsWith("@")) {
      const slash = val.indexOf("/");
      if (slash === -1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid scoped name" });
        return;
      }
      const scope = val.slice(1, slash);
      const pkg = val.slice(slash + 1);
      if (scope.length < 2 || scope.length > 30) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Scope must be 2-30 characters" });
        return;
      }
      if (pkg.length < 3 || pkg.length > 50) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Package name must be 3-50 characters" });
        return;
      }
      if (RESERVED_NAMES.has(scope)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Scope '${scope}' is a reserved name` });
        return;
      }
      if (RESERVED_NAMES.has(pkg)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Package name '${pkg}' is a reserved name` });
        return;
      }
    } else {
      if (val.length < 3 || val.length > 50) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Package name must be 3-50 characters" });
        return;
      }
      if (RESERVED_NAMES.has(val)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Package name '${val}' is a reserved name` });
        return;
      }
    }
  }),
  version: z.string().refine((val) => {
    if (val.includes("+")) return false;
    if (val.startsWith("v")) return false;
    if (val.length > 64) return false;
    return semver.valid(val, { loose: false }) === val;
  }, "Version must be canonical SemVer (semver.valid(v) === v), no build metadata, no 'v' prefix, max 64 chars"),
  description: z.string().min(10, "Description must be at least 10 chars").max(300, "Description max 300 chars"),
  license: z.string().min(1, "License required").max(50, "License max 50 chars"),
  repository: z.string().url("Repository must be a valid URL").refine((u) => u.startsWith("https://"), {
    message: "Repository URL must use https://",
  }).max(255).optional(),
  keywords: z.array(z.string().regex(/^[a-z0-9-]{2,30}$/, "Keywords must be 2-30 lowercase alphanumeric/hyphen")).max(10).optional(),
  category: z.enum([
    "documents", "coding", "testing", "devtools", "devops", "database", "data", "research",
    "writing", "design", "security", "automation", "ai-agents", "communication", "productivity",
    "marketing", "finance", "education", "media", "other"
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

  const yamlContent = lines.slice(1, endIdx).join("\n");
  let parsed: unknown;
  try {
    parsed = YAML.parse(yamlContent);
  } catch (err: unknown) {
    throw new Error(`Failed to parse SKILL.md YAML frontmatter: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!parsed || typeof parsed !== "object") {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (value !== null && value !== undefined) {
      result[key] = typeof value === "string" ? value : String(value);
    }
  }
  return result;
}

export function rewriteFrontmatterName(markdown: string, newName: string): string {
  const trimmed = markdown.trimStart();
  if (!trimmed.startsWith("---")) {
    return `---\nname: ${newName}\n---\n${markdown}`;
  }

  const lines = markdown.split("\n");
  let startFmIdx = -1;
  let endFmIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      if (startFmIdx === -1) {
        startFmIdx = i;
      } else {
        endFmIdx = i;
        break;
      }
    }
  }

  if (startFmIdx === -1 || endFmIdx === -1) {
    return markdown;
  }

  let replaced = false;
  for (let i = startFmIdx + 1; i < endFmIdx; i++) {
    const line = lines[i];
    if (/^\s*name\s*:/.test(line)) {
      lines[i] = `name: ${newName}`;
      replaced = true;
      break;
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
    const expectedFolder = toOnDiskName(expectedName);
    const fmName = fm.name.trim();
    if (fmName !== expectedFolder) {
      throw new Error(
        `SKILL.md frontmatter name '${fm.name}' does not match unscoped package name '${expectedFolder}'.`
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
    // Java class / Mach-O universal binary: 0xCA 0xFE 0xBA 0xBE
    if (buffer[0] === 0xca && buffer[1] === 0xfe && buffer[2] === 0xba && buffer[3] === 0xbe) {
      throw new Error(`File '${filePath}' contains Java class / Mach-O binary magic bytes (0xCAFEBABE), which is prohibited.`);
    }
    // WASM: 0x00 0x61 0x73 0x6D ('\0asm')
    if (buffer[0] === 0x00 && buffer[1] === 0x61 && buffer[2] === 0x73 && buffer[3] === 0x6d) {
      throw new Error(`File '${filePath}' contains WebAssembly (WASM) binary magic bytes, which is prohibited.`);
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
  strict?: boolean;
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
 * Validates an extracted skill directory tree according to CONTENT RULES.
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
          const rel = relative(excl, resolvedFullPath);
          if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
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

      // Check hidden file / directory in ANY path segment (except allowed dotfiles at file level)
      const hasHiddenSegment = segments.some((seg) => seg.startsWith(".") && !ALLOWED_DOTFILES.has(seg));
      if (hasHiddenSegment) {
        throw new Error(`Hidden file or directory '${entryRel}' is prohibited in skill packages.`);
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
          if (options.isGitHub && !options.strict) {
            // For GitHub installs without --strict, skip non-allowed files and unlink them so they are not installed
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
 * Validates a skill tarball (.tgz) locally according to CONTENT RULES.
 * Used before uploading to registry during publish.
 */
export async function validateSkillTarball(
  tarballPath: string
): Promise<{ manifest: SkillManifest; fileCount: number; totalSize: number }> {
  const tmpExtract = await mkdtemp(join(tmpdir(), "skillapt-val-tarball-"));
  try {
    let uncompressedBytes = 0;
    let fileCount = 0;

    await tarExtract({
      file: tarballPath,
      cwd: tmpExtract,
      preserveOwner: false,
      onReadEntry(entry) {
        fileCount++;
        if (fileCount > MAX_FILE_COUNT) {
          throw new Error(`Tarball contains more than ${MAX_FILE_COUNT} files.`);
        }
        uncompressedBytes += entry.size || 0;
        if (uncompressedBytes > MAX_UNCOMPRESSED_SIZE) {
          throw new Error(`Tarball uncompressed size exceeds ${MAX_UNCOMPRESSED_SIZE} bytes (25 MB).`);
        }
        if (entry.path.length > MAX_PATH_LENGTH) {
          throw new Error(`Tarball entry path exceeds ${MAX_PATH_LENGTH} characters.`);
        }
        if (entry.type === "SymbolicLink" || entry.type === "Link") {
          throw new Error(`Tarball contains prohibited link: '${entry.path}'.`);
        }
        if (isAbsolute(entry.path) || /^[a-zA-Z]:/.test(entry.path)) {
          throw new Error(`Tarball contains absolute path: '${entry.path}'.`);
        }
        const normalized = normalize(entry.path);
        if (normalized.startsWith("..") || normalized.includes(`${sep}..`) || normalized.includes(`..${sep}`)) {
          throw new Error(`Tarball contains path traversal: '${entry.path}'.`);
        }
      },
    });

    // Check wrapper directory layout: archive root or exactly one top-level directory
    let rootDir = tmpExtract;
    const topEntries = await readdir(tmpExtract);
    if (topEntries.length === 1) {
      const singlePath = join(tmpExtract, topEntries[0]);
      const s = await stat(singlePath);
      if (s.isDirectory()) {
        rootDir = singlePath;
      }
    }

    // Must have skill.json and SKILL.md
    const skillJsonPath = join(rootDir, "skill.json");
    let manifestRaw: string;
    try {
      manifestRaw = await readFile(skillJsonPath, "utf-8");
    } catch {
      throw new Error("Tarball is missing required 'skill.json' at package root.");
    }

    let manifestObj: unknown;
    try {
      manifestObj = JSON.parse(manifestRaw);
    } catch {
      throw new Error("Failed to parse 'skill.json': invalid JSON.");
    }

    const manifest = validateSkillManifest(manifestObj);

    // Validate tree
    const tree = await validateSkillTree(rootDir, {
      expectedName: manifest.name,
      requireSkillJson: true,
    });

    return {
      manifest,
      fileCount: tree.files.length,
      totalSize: tree.totalSize,
    };
  } finally {
    await rm(tmpExtract, { recursive: true, force: true });
  }
}
