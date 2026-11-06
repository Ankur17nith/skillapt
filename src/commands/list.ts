import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pc from "picocolors";
import { readManifest } from "../lib/manifest.js";
import { readLockfile } from "../lib/lockfile.js";
import { getSkillsDir } from "../lib/config.js";

export async function listCommand(): Promise<void> {
  const skillsDir = getSkillsDir();
  const manifest = await readManifest();
  const lockfile = await readLockfile();
  const names = Object.keys(manifest.skills);

  if (names.length === 0) {
    console.log(pc.yellow("No skills installed."));
    return;
  }

  // Build table data
  const rows: Array<{
    name: string;
    source: string;
    sha: string;
    description: string;
  }> = [];

  for (const name of names) {
    const entry = manifest.skills[name]!;
    const lockEntry = lockfile.skills[name];
    const sha = lockEntry?.sha ? lockEntry.sha.slice(0, 7) : "—";
    const description = await getDescription(name, skillsDir);

    rows.push({
      name,
      source: entry.source,
      sha,
      description,
    });
  }

  // Print as a simple table
  const colWidths = {
    name: Math.max(4, ...rows.map((r) => r.name.length)),
    source: Math.max(6, ...rows.map((r) => r.source.length)),
    sha: 7,
    description: Math.max(11, ...rows.map((r) => r.description.length)),
  };

  const header = [
    pc.bold("Name".padEnd(colWidths.name)),
    pc.bold("Source".padEnd(colWidths.source)),
    pc.bold("SHA".padEnd(colWidths.sha)),
    pc.bold("Description"),
  ].join("  ");

  const separator = pc.dim(
    [
      "─".repeat(colWidths.name),
      "─".repeat(colWidths.source),
      "─".repeat(colWidths.sha),
      "─".repeat(Math.min(colWidths.description, 50)),
    ].join("  ")
  );

  console.log(header);
  console.log(separator);

  for (const row of rows) {
    console.log(
      [
        pc.green(row.name.padEnd(colWidths.name)),
        row.source.padEnd(colWidths.source),
        pc.dim(row.sha.padEnd(colWidths.sha)),
        pc.dim(row.description.slice(0, 60)),
      ].join("  ")
    );
  }
}

/** Get a description for a skill: from skill.json or the first line of SKILL.md. */
async function getDescription(
  name: string,
  skillsDir: string
): Promise<string> {
  const skillDir = join(skillsDir, name);

  // Try skill.json first
  try {
    const raw = await readFile(join(skillDir, "skill.json"), "utf-8");
    const json = JSON.parse(raw) as { description?: string };
    if (typeof json.description === "string" && json.description.trim()) {
      return json.description.trim();
    }
  } catch {
    // No skill.json — try SKILL.md
  }

  // Try first non-empty line of SKILL.md
  try {
    const raw = await readFile(join(skillDir, "SKILL.md"), "utf-8");
    const firstLine = raw
      .split("\n")
      .map((l: string) => l.replace(/^#+\s*/, "").trim())
      .find((l: string) => l.length > 0);
    if (firstLine) {
      return firstLine;
    }
  } catch {
    // No SKILL.md either
  }

  return "—";
}
