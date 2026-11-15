import { homedir } from "node:os";
import { resolve, join, dirname, basename, isAbsolute } from "node:path";
import { symlink, cp, mkdir, rm, readFile, lstat } from "node:fs/promises";
import { existsSync } from "node:fs";
import pc from "picocolors";
import { assertInside } from "./fs.js";
import { toOnDiskName } from "./source.js";

export interface TargetDefinition {
  name: string;
  projectDir: string;
  globalDir: string;
  description: string;
}

/**
 * Single config table of supported AI agent skill targets.
 */
export const TARGET_CONFIGS: Record<string, TargetDefinition> = {
  claude: {
    name: "claude",
    projectDir: ".claude/skills",
    globalDir: join(homedir(), ".claude", "skills"),
    description: "Anthropic Claude agent skills directory",
  },
  cursor: {
    name: "cursor",
    projectDir: ".cursor/skills",
    globalDir: join(homedir(), ".cursor", "skills"),
    description: "Cursor IDE agent skills directory",
  },
  codex: {
    name: "codex",
    projectDir: ".codex/skills",
    globalDir: join(homedir(), ".codex", "skills"),
    description: "OpenAI Codex agent skills directory",
  },
  antigravity: {
    name: "antigravity",
    projectDir: ".agents/skills",
    globalDir: join(homedir(), ".gemini", "config", "skills"),
    description: "Google Antigravity agent skills directory",
  },
  "antigravity-cli": {
    name: "antigravity-cli",
    projectDir: ".agents/skills",
    globalDir: join(homedir(), ".gemini", "antigravity-cli", "skills"),
    description: "Google Antigravity CLI skills directory",
  },
};

/**
 * Normalizes a target option (single string, comma-separated string, or array of strings)
 * into a clean, deduplicated array of target keys.
 */
export function normalizeTargets(target?: string | string[]): string[] {
  if (!target) return [];
  const list = Array.isArray(target) ? target : [target];
  const items = list
    .flatMap((t) => t.split(","))
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(items));
}

export interface SyncTargetOptions {
  skillName: string;
  sourceDir: string; // Directory of installed skill, e.g. .skills/<name>
  target: string;
  global?: boolean;
  projectRoot?: string;
  homedir?: string;
}

export interface SyncTargetResult {
  target: string;
  targetPath: string;
  mode: "symlink" | "copy";
}

/**
 * Resolve target base directory for a given target, taking into account
 * --global, legacy directory detection, and SKILLAPT_ANTIGRAVITY_DIR override.
 */
export function resolveTargetDir(
  targetKey: string,
  isGlobal?: boolean,
  projectRoot?: string,
  homeDir: string = homedir()
): string {
  const def = TARGET_CONFIGS[targetKey];
  if (!def) {
    const valid = Object.keys(TARGET_CONFIGS).join(", ");
    throw new Error(
      `Unknown install target "${targetKey}". Supported targets: ${valid}`
    );
  }

  const envKey = `SKILLAPT_${targetKey.toUpperCase().replace(/-/g, "_")}_DIR`;
  if (process.env[envKey]) {
    return resolve(process.env[envKey]!);
  }
  if (targetKey === "antigravity-cli" && process.env.SKILLAPT_ANTIGRAVITY_DIR) {
    return resolve(process.env.SKILLAPT_ANTIGRAVITY_DIR);
  }

  if (targetKey === "antigravity" || targetKey === "antigravity-cli") {
    if (isGlobal) {
      if (targetKey === "antigravity") {
        const legacyGlobal = join(homeDir, ".gemini", "antigravity", "skills");
        const newGlobal = join(homeDir, ".gemini", "config", "skills");
        if (existsSync(legacyGlobal) && !existsSync(newGlobal)) {
          console.log(pc.yellow(`Notice: Using legacy Antigravity directory: ${legacyGlobal}`));
          return legacyGlobal;
        }
        return newGlobal;
      }
      return join(homeDir, ".gemini", "antigravity-cli", "skills");
    } else {
      const root = projectRoot ?? ".";
      const legacyProject = resolve(root, ".agent", "skills");
      const newProject = resolve(root, def.projectDir);
      if (existsSync(legacyProject) && !existsSync(newProject)) {
        console.log(pc.yellow(`Notice: Using legacy Antigravity directory: ${legacyProject}`));
        return legacyProject;
      }
      return newProject;
    }
  }

  if (isGlobal) {
    if (targetKey === "claude") return join(homeDir, ".claude", "skills");
    if (targetKey === "cursor") return join(homeDir, ".cursor", "skills");
    if (targetKey === "codex") return join(homeDir, ".codex", "skills");
    return def.globalDir;
  }

  return resolve(projectRoot ?? ".", def.projectDir);
}

/**
 * Sync an installed skill directory to an agent's target folder via symlink or recursive copy.
 */
export async function syncSkillToTarget(
  options: SyncTargetOptions
): Promise<SyncTargetResult> {
  const targetKey = options.target.trim().toLowerCase();
  const def = TARGET_CONFIGS[targetKey];

  if (!def) {
    const valid = Object.keys(TARGET_CONFIGS).join(", ");
    throw new Error(
      `Unknown install target "${options.target}". Supported targets: ${valid}`
    );
  }

  const baseDir = resolveTargetDir(targetKey, options.global, options.projectRoot, options.homedir);

  await mkdir(baseDir, { recursive: true });

  const onDiskName = toOnDiskName(options.skillName);
  assertInside(baseDir, onDiskName);
  const targetPath = assertInside(baseDir, join(baseDir, onDiskName));

  // Check collision in target directory
  if (existsSync(targetPath)) {
    try {
      const existingRaw = await readFile(join(targetPath, "skill.json"), "utf-8");
      const existingJson = JSON.parse(existingRaw);
      if (
        existingJson.name &&
        existingJson.name !== options.skillName &&
        toOnDiskName(existingJson.name) === onDiskName
      ) {
        throw new Error(
          `Naming collision in target "${targetKey}": "${onDiskName}" is already occupied by package "${existingJson.name}". Cannot sync "${options.skillName}".`
        );
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith("Naming collision in target")) {
        throw err;
      }
    }
  }

  await rm(targetPath, { recursive: true, force: true });

  const absoluteSource = resolve(options.sourceDir);

  try {
    // Try symlink first
    await symlink(absoluteSource, targetPath, "junction");
    return { target: targetKey, targetPath, mode: "symlink" };
  } catch {
    // Fallback to copying files recursively
    await cp(absoluteSource, targetPath, { recursive: true });
    return { target: targetKey, targetPath, mode: "copy" };
  }
}

/**
 * Remove an installed skill and its symlink/copy from known agent targets.
 * If targets is provided, only removes from those targets; otherwise removes from all.
 * If isGlobal is specified, only checks that scope; otherwise checks both local and global.
 */
export async function removeSkillFromTargets(
  skillName: string,
  projectRoot: string = ".",
  targets?: string[],
  isGlobal?: boolean
): Promise<string[]> {
  const onDiskName = toOnDiskName(skillName);
  const removed: string[] = [];
  const targetKeys = targets && targets.length > 0 ? targets : Object.keys(TARGET_CONFIGS);
  const globalModes = isGlobal !== undefined ? [isGlobal] : [false, true];

  for (const targetKey of targetKeys) {
    for (const glob of globalModes) {
      try {
        const baseDir = resolveTargetDir(targetKey, glob, projectRoot);
        const targetPath = assertInside(baseDir, join(baseDir, onDiskName));
        try {
          await lstat(targetPath);
          await rm(targetPath, { recursive: true, force: true });
          removed.push(targetPath);
        } catch {
          // not found
        }
      } catch {
        // target directory resolution error
      }
    }
  }

  return removed;
}

/**
 * Detect all targets where a skill is currently installed/synced.
 */
export async function getExistingTargetsForSkill(
  skillName: string,
  projectRoot: string = "."
): Promise<Array<{ target: string; global: boolean }>> {
  const onDiskName = toOnDiskName(skillName);
  const found: Array<{ target: string; global: boolean }> = [];

  for (const targetKey of Object.keys(TARGET_CONFIGS)) {
    for (const isGlobal of [false, true]) {
      try {
        const baseDir = resolveTargetDir(targetKey, isGlobal, projectRoot);
        const targetPath = join(baseDir, onDiskName);
        if (existsSync(targetPath)) {
          found.push({ target: targetKey, global: isGlobal });
        }
      } catch {
        // target directory resolution error
      }
    }
  }

  return found;
}

/**
 * Decide whether a path recorded in skills.lock.json (`syncedTargets`) is safe to delete.
 *
 * The lockfile is untrusted input (it ships inside repositories), so a recorded path is
 * only trusted if it is exactly `<known agent target dir>/<on-disk skill name>`, where the
 * known target dirs are those resolved for every supported target (project and global).
 */
export function isTrustedSyncedTargetPath(
  recordedPath: string,
  skillName: string,
  projectRoot: string = "."
): boolean {
  if (typeof recordedPath !== "string" || !recordedPath || !isAbsolute(recordedPath)) {
    return false;
  }
  const onDiskName = toOnDiskName(skillName);
  const resolved = resolve(recordedPath);
  if (basename(resolved) !== onDiskName) {
    return false;
  }
  const parent = dirname(resolved);
  for (const targetKey of Object.keys(TARGET_CONFIGS)) {
    for (const isGlobal of [false, true]) {
      try {
        if (resolve(resolveTargetDir(targetKey, isGlobal, projectRoot)) === parent) {
          return true;
        }
      } catch {
        // unresolvable target; ignore
      }
    }
  }
  return false;
}
