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

  // Update skills.json
  await writeManifest(updatedManifest);

  // Update lockfile
  const lockfile = await readLockfile();
  const updatedLockfile = removeLockEntry(lockfile, name);
  await writeLockfile(updatedLockfile);

  console.log(`${pc.green("✓")} Removed ${pc.bold(name)}`);
}
