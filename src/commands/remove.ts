import { rm } from "node:fs/promises";
import { join } from "node:path";
import pc from "picocolors";
import {
  readManifest,
  writeManifest,
  removeSkill,
} from "../lib/manifest.js";
import { readLockfile, writeLockfile, removeLockEntry } from "../lib/lockfile.js";
import { getSkillsDir } from "../lib/config.js";
import { assertInside } from "../lib/fs.js";
import { toOnDiskName } from "../lib/source.js";
import {
  removeSkillFromTargets,
  normalizeTargets,
  TARGET_CONFIGS,
  resolveTargetDir,
} from "../lib/targets.js";

export interface RemoveOptions {
  target?: string | string[];
  global?: boolean;
}

export async function removeCommand(
  name: string,
  options: RemoveOptions = {}
): Promise<void> {
  const targets = normalizeTargets(options.target);

  if (targets.length > 0) {
    const valid = Object.keys(TARGET_CONFIGS).join(", ");
    for (const t of targets) {
      if (!TARGET_CONFIGS[t]) {
        throw new Error(`Unknown install target "${t}". Supported targets: ${valid}`);
      }
    }

    const manifest = await readManifest();
    const lockfile = await readLockfile();
    if (!manifest.skills[name] && !lockfile.skills[name]) {
      throw new Error(`Skill "${name}" is not installed.`);
    }

    const removedPaths = await removeSkillFromTargets(name, ".", targets, options.global);

    const onDiskName = toOnDiskName(name);
    const targetPathsToRemove = new Set(removedPaths);
    const globalModes = options.global !== undefined ? [options.global] : [false, true];
    for (const t of targets) {
      for (const glob of globalModes) {
        try {
          const baseDir = resolveTargetDir(t, glob, ".");
          targetPathsToRemove.add(join(baseDir, onDiskName));
        } catch {
          // ignore
        }
      }
    }

    if (lockfile.skills[name]?.syncedTargets) {
      lockfile.skills[name].syncedTargets = lockfile.skills[name].syncedTargets.filter(
        (p) => !targetPathsToRemove.has(p)
      );
      await writeLockfile(lockfile);
    }

    console.log(
      `${pc.green("✓")} Removed ${pc.bold(name)} from target(s): ${targets.join(", ")}`
    );
    return;
  }

  const skillsDir = getSkillsDir();
  const onDiskName = toOnDiskName(name);

  // Validate path traversal
  assertInside(skillsDir, onDiskName);

  // Check manifest first
  const manifest = await readManifest();
  const { manifest: updatedManifest, removed } = removeSkill(manifest, name);

  if (!removed) {
    throw new Error(`Skill "${name}" is not installed.`);
  }

  // Remove the skill directory
  const skillDir = assertInside(skillsDir, join(skillsDir, onDiskName));
  await rm(skillDir, { recursive: true, force: true });

  // Delete synced copies/symlinks in agent targets
  await removeSkillFromTargets(name);

  // Update skills.json
  await writeManifest(updatedManifest);

  // Update lockfile
  const lockfile = await readLockfile();
  const entry = lockfile.skills[name];
  if (entry?.syncedTargets) {
    for (const targetPath of entry.syncedTargets) {
      try {
        await rm(targetPath, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
  const updatedLockfile = removeLockEntry(lockfile, name);

  // Prune orphaned dependencies
  const remainingRoots = Object.keys(updatedManifest.skills);
  const reachable = new Set<string>(remainingRoots);
  const queue = [...remainingRoots];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentEntry = updatedLockfile.skills[current];
    if (currentEntry?.dependencies) {
      for (const dep of Object.keys(currentEntry.dependencies)) {
        if (!reachable.has(dep)) {
          reachable.add(dep);
          queue.push(dep);
        }
      }
    }
  }

  for (const lockedKey of Object.keys(updatedLockfile.skills)) {
    if (!reachable.has(lockedKey)) {
      const orphanEntry = updatedLockfile.skills[lockedKey];
      if (orphanEntry?.syncedTargets) {
        for (const targetPath of orphanEntry.syncedTargets) {
          try {
            await rm(targetPath, { recursive: true, force: true });
          } catch {
            // ignore
          }
        }
      }
      delete updatedLockfile.skills[lockedKey];
      const orphanDir = assertInside(skillsDir, join(skillsDir, toOnDiskName(lockedKey)));
      await rm(orphanDir, { recursive: true, force: true });
      await removeSkillFromTargets(lockedKey);
      console.log(pc.dim(`Pruned orphaned dependency: ${lockedKey}`));
    }
  }

  await writeLockfile(updatedLockfile);

  console.log(`${pc.green("✓")} Removed ${pc.bold(name)}`);
}
