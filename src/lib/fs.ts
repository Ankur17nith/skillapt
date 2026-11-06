import { rename, cp, rm } from "node:fs/promises";

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
