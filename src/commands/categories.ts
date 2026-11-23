import pc from "picocolors";
import { RegistryClient } from "../lib/registry.js";

export interface CategoriesOptions {
  json?: boolean;
  plain?: boolean;
}

/** List what skills are for, so a person or agent can narrow a search with --category. */
export async function categoriesCommand(options: CategoriesOptions = {}): Promise<void> {
  const categories = await new RegistryClient().getCategories();

  if (options.json) {
    console.log(JSON.stringify(categories, null, 2));
    return;
  }

  if (options.plain ?? !process.stdout.isTTY) {
    for (const c of categories) console.log(`${c.id} (${c.count}): ${c.description}`);
    console.log('Use: skillapt search --category <id> "<what you need>"');
    return;
  }

  const width = Math.max(...categories.map((c) => c.id.length));
  console.log(`\n${pc.bold("Skill categories")}\n`);
  for (const c of categories) {
    console.log(`${pc.green(c.id.padEnd(width))}  ${pc.cyan(String(c.count).padStart(5))}  ${pc.dim(c.description)}`);
  }
  console.log(`\nNarrow a search: ${pc.bold('skillapt search --category <id> "<what you need>"')}`);
}
