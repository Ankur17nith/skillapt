import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { symlink, cp, mkdir, rm, readFile } from "node:fs/promises";
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

  if (targetKey === "antigravity" || targetKey === "antigravity-cli") {
    if (process.env.SKILLAPT_ANTIGRAVITY_DIR) {
      return resolve(process.env.SKILLAPT_ANTIGRAVITY_DIR);
    }

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
