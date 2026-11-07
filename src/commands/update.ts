import pc from "picocolors";
import { readManifest } from "../lib/manifest.js";
import { readLockfile } from "../lib/lockfile.js";
import { installSingle } from "./install.js";

export interface UpdateOptions {
  json?: boolean;
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

  for (const skillName of toUpdate) {
    const entry = manifest.skills[skillName];
    if (!entry) {
      throw new Error(`Skill "${skillName}" is not listed in skills.json.`);
    }

    const prevVersion =
      lockfile.skills[skillName]?.version ??
      lockfile.skills[skillName]?.sha?.slice(0, 7) ??
      "unknown";

    const isGitHub = entry.source.includes("/") && !entry.source.startsWith("@");
    const sourceSpec = isGitHub
      ? (entry.subpath ? `${entry.source}/${entry.subpath}` : entry.source)
      : `${skillName}${entry.version ? `@${entry.version}` : ""}`;

    await installSingle(sourceSpec);

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
