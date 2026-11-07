import pc from "picocolors";
import semver from "semver";
import { readManifest } from "../lib/manifest.js";
import { readLockfile } from "../lib/lockfile.js";
import { RegistryClient } from "../lib/registry.js";
import { resolveSkillVersion } from "../lib/semver.js";
import { resolveRef } from "../lib/github.js";

export interface OutdatedOptions {
  json?: boolean;
}

export interface OutdatedItem {
  name: string;
  current: string;
  wanted: string;
  latest: string;
  source: string;
}

export async function outdatedCommand(options: OutdatedOptions = {}): Promise<void> {
  const manifest = await readManifest();
  const lockfile = await readLockfile();
  const installedNames = Object.keys(manifest.skills);

  if (installedNames.length === 0) {
    if (options.json) {
      console.log(JSON.stringify([], null, 2));
    } else {
      console.log(pc.yellow("No skills installed in skills.json."));
    }
    return;
  }

  const client = new RegistryClient();
  const outdatedList: OutdatedItem[] = [];

  for (const name of installedNames) {
    const entry = manifest.skills[name];
    const lockEntry = lockfile.skills[name];
    const isGitHub = entry.source.includes("/") && !entry.source.startsWith("@");

    if (isGitHub) {
      const parts = entry.source.split("/");
      const owner = parts[0];
      const repo = parts[1];
      const currentSha = lockEntry?.sha ? lockEntry.sha.slice(0, 7) : "unknown";

      try {
        const latestShaFull = await resolveRef(owner, repo, entry.ref ?? "HEAD");
        const latestSha = latestShaFull.slice(0, 7);

        if (currentSha !== latestSha) {
          outdatedList.push({
            name,
            current: currentSha,
            wanted: latestSha,
            latest: latestSha,
            source: entry.source,
          });
        }
      } catch {
        // Ignore resolution error in outdated
      }
    } else {
      const currentVersion = lockEntry?.version ?? "0.0.0";
      const requestedRange = entry.version ?? "*";

      try {
        const detail = await client.getSkill(name);
        const wantedSummary = resolveSkillVersion(detail, requestedRange);
        const wantedVersion = wantedSummary.version;
        const latestVersion = detail.latestVersion;

        if (
          semver.gt(wantedVersion, currentVersion) ||
          semver.gt(latestVersion, currentVersion)
        ) {
          outdatedList.push({
            name,
            current: currentVersion,
            wanted: wantedVersion,
            latest: latestVersion,
            source: "registry",
          });
        }
      } catch {
        // Skip unresolvable skills
      }
    }
  }

  if (options.json) {
    console.log(JSON.stringify(outdatedList, null, 2));
    return;
  }

  if (outdatedList.length === 0) {
    console.log(pc.green("All installed skills are up to date."));
    return;
  }

  const colWidths = {
    name: Math.max(7, ...outdatedList.map((r) => r.name.length)),
    current: Math.max(7, ...outdatedList.map((r) => r.current.length)),
    wanted: Math.max(6, ...outdatedList.map((r) => r.wanted.length)),
    latest: Math.max(6, ...outdatedList.map((r) => r.latest.length)),
    source: Math.max(6, ...outdatedList.map((r) => r.source.length)),
  };

  const header = [
    pc.bold("Package".padEnd(colWidths.name)),
    pc.bold("Current".padEnd(colWidths.current)),
    pc.bold("Wanted".padEnd(colWidths.wanted)),
    pc.bold("Latest".padEnd(colWidths.latest)),
    pc.bold("Source".padEnd(colWidths.source)),
  ].join("  ");

  const separator = pc.dim(
    [
      "─".repeat(colWidths.name),
      "─".repeat(colWidths.current),
      "─".repeat(colWidths.wanted),
      "─".repeat(colWidths.latest),
      "─".repeat(colWidths.source),
    ].join("  ")
  );

  console.log(`\n${header}`);
  console.log(separator);

  for (const item of outdatedList) {
    console.log(
      [
        pc.red(item.name.padEnd(colWidths.name)),
        pc.dim(item.current.padEnd(colWidths.current)),
        pc.green(item.wanted.padEnd(colWidths.wanted)),
        pc.cyan(item.latest.padEnd(colWidths.latest)),
        item.source.padEnd(colWidths.source),
      ].join("  ")
    );
  }
  console.log("");
}
