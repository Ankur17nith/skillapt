import pc from "picocolors";
import { join } from "node:path";
import { readManifest } from "../lib/manifest.js";
import { readLockfile } from "../lib/lockfile.js";
import { getSkillsDir } from "../lib/config.js";
import { toOnDiskName } from "../lib/source.js";
import { syncSkillToTarget, getExistingTargetsForSkill } from "../lib/targets.js";
import { installSingle } from "./install.js";

export interface UpdateOptions {
  json?: boolean;
  target?: string;
  global?: boolean;
}

export async function updateCommand(
  name?: string,
  options: UpdateOptions = {}
): Promise<void> {
  const manifest = await readManifest();
  const lockfile = await readLockfile();

  const toUpdate = name ? [name] : Object.keys(manifest.skills);

  if (toUpdate.length === 0) {
    if (options.json) {
      console.log(JSON.stringify([], null, 2));
    } else {
      console.log(pc.yellow("No skills installed in skills.json to update."));
    }
    return;
  }

  const results: Array<{ name: string; previousVersion: string; newVersion: string }> = [];
  const skillsDir = getSkillsDir();

  for (const skillName of toUpdate) {
    const entry = manifest.skills[skillName];
    if (!entry) {
      throw new Error(`Skill "${skillName}" is not listed in skills.json.`);
    }

    const prevVersion =
      lockfile.skills[skillName]?.version ??
      lockfile.skills[skillName]?.sha?.slice(0, 7) ??
      "unknown";

    // Track targets that were already synced before update
    const previousTargets = await getExistingTargetsForSkill(skillName);

    const isGitHub = entry.source.includes("/") && !entry.source.startsWith("@");
    const refStr = entry.ref ? `@${entry.ref}` : "";
    const sourceSpec = isGitHub
      ? `${entry.subpath ? `${entry.source}/${entry.subpath}` : entry.source}${refStr}`
      : `${skillName}${entry.version ? `@${entry.version}` : ""}`;

    await installSingle(sourceSpec, {
      target: options.target,
      global: options.global,
    });

    // Re-sync any targets that were previously synced
    const sourceDir = join(skillsDir, toOnDiskName(skillName));
    for (const pt of previousTargets) {
      await syncSkillToTarget({
        skillName,
        sourceDir,
        target: pt.target,
        global: pt.global,
      });
    }

    const updatedLock = await readLockfile();
    const newVersion =
      updatedLock.skills[skillName]?.version ??
      updatedLock.skills[skillName]?.sha?.slice(0, 7) ??
      "unknown";

    results.push({
      name: skillName,
      previousVersion: prevVersion,
      newVersion,
    });
  }

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  console.log(`\n${pc.green("✓")} Updated skills:`);
  for (const r of results) {
    console.log(`  • ${pc.bold(r.name)} (${pc.dim(r.previousVersion)} -> ${pc.green(r.newVersion)})`);
  }
}
