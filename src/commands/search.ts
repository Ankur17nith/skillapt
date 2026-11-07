import pc from "picocolors";
import { RegistryClient } from "../lib/registry.js";

export interface SearchOptions {
  json?: boolean;
  category?: string;
  compat?: string;
  verified?: boolean;
  limit?: string;
}

export async function searchCommand(
  query: string,
  options: SearchOptions = {}
): Promise<void> {
  const client = new RegistryClient();
  const limit = options.limit ? parseInt(options.limit, 10) : 20;

  const result = await client.searchSkills({
    q: query,
    category: options.category,
    compat: options.compat,
    verified: options.verified,
    limit,
  });

  if (options.json) {
    console.log(JSON.stringify(result.skills, null, 2));
    return;
  }

  if (result.skills.length === 0) {
    console.log(pc.yellow(`No skills found matching "${query}".`));
    return;
  }

  const rows = result.skills.map((s) => ({
    name: s.name,
    version: s.latestVersion,
    description: s.description || "—",
    downloads: String(s.downloads ?? 0),
    verified: s.verified ? "✓" : " ",
  }));

  const colWidths = {
    name: Math.max(4, ...rows.map((r) => r.name.length)),
    version: Math.max(7, ...rows.map((r) => r.version.length)),
    downloads: Math.max(9, ...rows.map((r) => r.downloads.length)),
    verified: 8,
  };

  const header = [
    pc.bold("Name".padEnd(colWidths.name)),
    pc.bold("Version".padEnd(colWidths.version)),
    pc.bold("Downloads".padEnd(colWidths.downloads)),
    pc.bold("Verified".padEnd(colWidths.verified)),
    pc.bold("Description"),
  ].join("  ");

  const separator = pc.dim(
    [
      "─".repeat(colWidths.name),
      "─".repeat(colWidths.version),
      "─".repeat(colWidths.downloads),
      "─".repeat(colWidths.verified),
      "─".repeat(40),
    ].join("  ")
  );

  console.log(`\nFound ${pc.bold(String(result.pagination.total))} skill(s):\n`);
  console.log(header);
  console.log(separator);

  for (const row of rows) {
    console.log(
      [
        pc.green(row.name.padEnd(colWidths.name)),
        row.version.padEnd(colWidths.version),
        pc.cyan(row.downloads.padEnd(colWidths.downloads)),
        (row.verified === "✓" ? pc.green("✓       ") : "        "),
        pc.dim(row.description.slice(0, 50)),
      ].join("  ")
    );
  }
}
