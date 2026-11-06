import { existsSync } from "node:fs";
import pc from "picocolors";
import { manifestPath, writeManifest } from "../lib/manifest.js";

export async function initCommand(): Promise<void> {
  const path = manifestPath();

  if (existsSync(path)) {
    console.log(pc.yellow("skills.json already exists."));
    return;
  }

  await writeManifest({ skills: {} });
  console.log(pc.green("✓") + " Created skills.json");
}
