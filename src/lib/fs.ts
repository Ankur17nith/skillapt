import { rename, cp, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";

export function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

/**
 * Move a directory safely, handling cross-device (EXDEV) moves.
 */
export async function moveDir(src: string, dest: string): Promise<void> {
  try {
    await rename(src, dest);
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === "EXDEV") {
      await cp(src, dest, { recursive: true });
      await rm(src, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
}

/**
 * Asserts that candidate path is strictly inside baseDir.
 * Resolves both paths and checks directory separator boundary.
 * Throws an error if candidate is outside baseDir or is baseDir itself.
 * Returns the resolved candidate path.
 */
export function assertInside(baseDir: string, candidate: string): string {
  const resolvedBase = resolve(baseDir);
  const resolvedCandidate = resolve(baseDir, candidate);
  const prefix = resolvedBase.endsWith(sep) ? resolvedBase : resolvedBase + sep;

  if (
    resolvedCandidate === resolvedBase ||
    !resolvedCandidate.startsWith(prefix)
  ) {
    throw new Error(
      `Security: path "${candidate}" escapes base directory "${baseDir}".`
    );
  }
  return resolvedCandidate;
}
