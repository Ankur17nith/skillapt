import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { symlink, cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";

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
};

export interface SyncTargetOptions {
  skillName: string;
  sourceDir: string; // Directory of installed skill, e.g. .skills/<name>
  target: string;
  global?: boolean;
  projectRoot?: string;
}

export interface SyncTargetResult {
  target: string;
  targetPath: string;
  mode: "symlink" | "copy";
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

  const baseDir = options.global
    ? def.globalDir
    : resolve(options.projectRoot ?? ".", def.projectDir);

  await mkdir(baseDir, { recursive: true });

  const targetPath = join(baseDir, options.skillName);

  if (existsSync(targetPath)) {
    await rm(targetPath, { recursive: true, force: true });
  }

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
