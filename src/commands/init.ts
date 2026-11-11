import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, resolve, join } from "node:path";
import pc from "picocolors";
import { manifestPath, writeManifest } from "../lib/manifest.js";

export interface InitOptions {
  name?: string;
  skillOnly?: boolean;
  workspaceOnly?: boolean;
  dir?: string;
}

function sanitizePackageName(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return cleaned.length >= 3 ? cleaned : "my-skill";
}

export async function initCommand(options: InitOptions = {}): Promise<void> {
  const targetDir = resolve(options.dir ?? ".");
  const pkgName = sanitizePackageName(options.name ?? basename(targetDir));

  let createdCount = 0;

  // 1. Scaffold skill.json if not in workspace-only mode
  if (!options.workspaceOnly) {
    const skillJsonPath = join(targetDir, "skill.json");
    if (!existsSync(skillJsonPath)) {
      const skillManifest = {
        name: pkgName,
        version: "0.1.0",
        description: "An AI agent skill package",
        license: "MIT",
        category: "documents",
        compatibility: ["claude", "cursor", "codex", "antigravity"],
        permissions: {
          network: false,
          shell: false,
          filesystem: "none",
        },
      };
      await writeFile(skillJsonPath, JSON.stringify(skillManifest, null, 2) + "\n", "utf-8");
      console.log(pc.green("✓") + " Created skill.json");
      createdCount++;
    } else if (options.skillOnly) {
      console.log(pc.yellow("skill.json already exists."));
    }

    // 2. Scaffold SKILL.md if not in workspace-only mode
    const skillMdPath = join(targetDir, "SKILL.md");
    if (!existsSync(skillMdPath)) {
      const skillMdContent = `---
name: ${pkgName}
description: An AI agent skill package
category: documents
version: 0.1.0
---

# ${pkgName}

## Capabilities
- Describe what this skill teaches the AI agent.

## Usage Guidelines
- Provide prompt instructions and usage guidelines here.
`;
      await writeFile(skillMdPath, skillMdContent, "utf-8");
      console.log(pc.green("✓") + " Created SKILL.md");
      createdCount++;
    } else if (options.skillOnly) {
      console.log(pc.yellow("SKILL.md already exists."));
    }
  }

  // 3. Scaffold skills.json (consumer manifest) unless in skill-only mode
  if (!options.skillOnly) {
    const path = manifestPath(targetDir);
    if (!existsSync(path)) {
      await writeManifest({ skills: {} }, targetDir);
      console.log(pc.green("✓") + " Created skills.json");
      createdCount++;
    } else if (options.workspaceOnly || createdCount === 0) {
      console.log(pc.yellow("skills.json already exists."));
    }
  }

  if (createdCount === 0 && !options.skillOnly && !options.workspaceOnly) {
    console.log(pc.yellow("Skill and workspace files already exist."));
  }
}
