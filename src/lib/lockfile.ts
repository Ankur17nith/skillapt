import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Manifest } from "./manifest.js";

export interface LockEntry {
  source: string;
  version?: string;
  resolved?: string;
  integrity?: string;
  sha256?: string;
  sha?: string; // GitHub commit SHA for github sources
  subpath?: string | null;
  category?: string;
  permissions?: unknown;
  dependencies?: Record<string, string>;
}

export interface Lockfile {
  lockfileVersion: number;
  skills: Record<string, LockEntry>;
}

const LOCKFILE_NAME = "skills.lock.json";

/** Path to skills.lock.json relative to the given directory. */
export function lockfilePath(dir: string = "."): string {
  return join(dir, LOCKFILE_NAME);
}

/** Read skills.lock.json. Returns an empty v2 lockfile if the file doesn't exist. */
export async function readLockfile(dir: string = "."): Promise<Lockfile> {
  const filePath = lockfilePath(dir);
  try {
    const raw = await readFile(filePath, "utf-8");
    const json = JSON.parse(raw) as Partial<Lockfile>;
    return {
      lockfileVersion: json.lockfileVersion ?? 2,
      skills: json.skills ?? {},
    };
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === "ENOENT") {
      return {
        lockfileVersion: 2,
        skills: {},
      };
    }
    throw err;
  }
}

/** Write the lockfile to disk with lockfileVersion: 2. */
export async function writeLockfile(
  lockfile: Lockfile,
  dir: string = "."
): Promise<void> {
  const filePath = lockfilePath(dir);
  const v2Lockfile: Lockfile = {
    lockfileVersion: 2,
    skills: lockfile.skills,
  };
  await writeFile(filePath, JSON.stringify(v2Lockfile, null, 2) + "\n", "utf-8");
}

/** Add or update a skill in the lockfile (does not write to disk). */
export function addLockEntry(
  lockfile: Lockfile,
  name: string,
  entry: LockEntry
): Lockfile {
  const normalizedEntry: LockEntry = {
    ...entry,
    integrity: entry.integrity ?? (entry.sha256 ? `sha256-${entry.sha256}` : undefined),
    sha256: entry.sha256 ?? (entry.integrity?.startsWith("sha256-") ? entry.integrity.slice(7) : undefined),
  };
  return {
    ...lockfile,
    lockfileVersion: 2,
    skills: {
      ...lockfile.skills,
      [name]: normalizedEntry,
    },
  };
}

/** Remove a skill from the lockfile (does not write to disk). */
export function removeLockEntry(
  lockfile: Lockfile,
  name: string
): Lockfile {
  const { [name]: _, ...rest } = lockfile.skills;
  return {
    ...lockfile,
    lockfileVersion: 2,
    skills: rest,
  };
}

/**
 * Check if a lockfile is in sync with skills.json manifest.
 */
export function checkLockfileSync(
  manifest: Manifest,
  lockfile: Lockfile
): { inSync: boolean; missing: string[] } {
  const missing: string[] = [];
  const manifestNames = Object.keys(manifest.skills);

  for (const name of manifestNames) {
    if (!lockfile.skills[name]) {
      missing.push(name);
    }
  }

  return {
    inSync: missing.length === 0,
    missing,
  };
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}
