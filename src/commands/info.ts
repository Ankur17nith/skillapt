import pc from "picocolors";
import { RegistryClient } from "../lib/registry.js";

export interface InfoOptions {
  json?: boolean;
}

export async function infoCommand(
  name: string,
  options: InfoOptions = {}
): Promise<void> {
  const client = new RegistryClient();
  const skill = await client.getSkill(name);

  if (options.json) {
    console.log(JSON.stringify(skill, null, 2));
    return;
  }

  const latestVer = skill.latestVersion;
  const latestObj = skill.versions?.[latestVer];

  console.log(`\n${pc.bold(pc.green(skill.name))} ${pc.dim(`@${latestVer}`)}`);
  console.log(pc.dim("─".repeat(40)));
  console.log(`${pc.bold("Description:")}   ${skill.description || "—"}`);
  console.log(`${pc.bold("License:")}       ${skill.license || "—"}`);
  console.log(`${pc.bold("Category:")}      ${skill.category || "—"}`);
  console.log(`${pc.bold("Compatibility:")} ${(skill.compatibility || []).join(", ") || "—"}`);
  if (skill.repository) {
    console.log(`${pc.bold("Repository:")}    ${skill.repository}`);
  }
  if (skill.owner?.handle) {
    console.log(`${pc.bold("Publisher:")}     ${skill.owner.handle}`);
  }
  console.log(`${pc.bold("Downloads:")}     ${skill.downloads ?? 0}`);

  // Permissions of latest version
  if (latestObj?.permissions) {
    const p = latestObj.permissions;
    console.log(`\n${pc.bold("Permissions:")}`);
    console.log(`  • Network:    ${p.network ? pc.yellow("true") : pc.green("false")}`);
    console.log(`  • Shell:      ${p.shell ? pc.red("true") : pc.green("false")}`);
    console.log(`  • Filesystem: ${p.filesystem !== "none" ? pc.yellow(p.filesystem) : pc.green("none")}`);
  }

  // Dependencies
  const deps = Object.entries(latestObj?.dependencies ?? {});
  if (deps.length > 0) {
    console.log(`\n${pc.bold("Dependencies:")}`);
    for (const [dep, range] of deps) {
      console.log(`  • ${dep}: ${pc.cyan(range)}`);
    }
  }

  // Versions list
  const allVersions = Object.keys(skill.versions || {});
  console.log(`\n${pc.bold("Versions:")} (${allVersions.length} total)`);
  for (const v of allVersions.slice(-10)) {
    const isYanked = skill.versions[v]?.yanked;
    const yankTag = isYanked ? ` ${pc.red("[yanked]")}` : "";
    const isLatest = v === latestVer ? ` ${pc.cyan("(latest)")}` : "";
    console.log(`  • ${v}${isLatest}${yankTag}`);
  }
  console.log("");
}
