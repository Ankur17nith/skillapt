import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface LockEntry {
  source: string;
  sha: string;
  subpath?: string | null;
}

export interface Lockfile {
  skills: Record<string, LockEntry>;
}

const LOCKFILE_NAME = "skills.lock.json";

/** Path to skills.lock.json relative to the given directory. */
export function lockfilePath(dir: string = "."): string {
  return join(dir, LOCKFILE_NAME);
}

/** Read skills.lock.json. Returns an empty lockfile if the file doesn't exist. */
export async function readLockfile(dir: string = "."): Promise<Lockfile> {
  const filePath = lockfilePath(dir);
  try {
    const raw = await readFile(filePath, "utf-8");
    const json = JSON.parse(raw) as Lockfile;
    return { skills: json.skills ?? {} };
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === "ENOENT") {
      return { skills: {} };
    }
    throw err;
  }
}

/** Write the lockfile to disk. */
export async function writeLockfile(
  lockfile: Lockfile,
  dir: string = "."
): Promise<void> {
  const filePath = lockfilePath(dir);
  await writeFile(filePath, JSON.stringify(lockfile, null, 2) + "\n", "utf-8");
}

/** Add or update a skill in the lockfile (does not write to disk). */
export function addLockEntry(
  lockfile: Lockfile,
  name: string,
  entry: LockEntry
): Lockfile {
  return {
    ...lockfile,
    skills: {
      ...lockfile.skills,
      [name]: entry,
    },
  };
}

/** Remove a skill from the lockfile (does not write to disk). */
export function removeLockEntry(
  lockfile: Lockfile,
  name: string
): Lockfile {
  const { [name]: _, ...rest } = lockfile.skills;
  return { ...lockfile, skills: rest };
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}
