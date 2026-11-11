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
import { removeSkillFromTargets } from "../lib/targets.js";

export async function removeCommand(name: string): Promise<void> {
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
  const updatedLockfile = removeLockEntry(lockfile, name);

  // Prune orphaned dependencies
  const remainingRoots = Object.keys(updatedManifest.skills);
  const reachable = new Set<string>(remainingRoots);
  const queue = [...remainingRoots];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const entry = updatedLockfile.skills[current];
    if (entry?.dependencies) {
      for (const dep of Object.keys(entry.dependencies)) {
        if (!reachable.has(dep)) {
          reachable.add(dep);
          queue.push(dep);
        }
      }
    }
  }

  for (const lockedKey of Object.keys(updatedLockfile.skills)) {
    if (!reachable.has(lockedKey)) {
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
