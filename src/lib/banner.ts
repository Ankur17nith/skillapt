import pc from "picocolors";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Discover the package.json version dynamically by traversing up.
 */
export function getVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (dir !== dirname(dir)) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
          name?: string;
          version?: string;
        };
        if (pkg.name === "skillpm" && pkg.version) {
          return pkg.version;
        }
      } catch {
        // ignore parse error and keep walking up
      }
    }
    dir = dirname(dir);
  }
  return "0.0.1";
}

/**
 * Returns a small CLI banner: "skillpm" in bold, version in muted color.
 */
export function getBanner(): string {
  return `${pc.bold("skillpm")} ${pc.dim(`v${getVersion()}`)}`;
}
