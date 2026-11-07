import { z } from "zod";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ── Schema ──

const skillEntrySchema = z.object({
  source: z.string(),
  version: z.string().optional(),
  ref: z.string().nullable().optional(),
  subpath: z.string().nullable().optional(),
});

const manifestSchema = z.object({
  skills: z.record(z.string(), skillEntrySchema).default({}),
});

export type SkillEntry = z.infer<typeof skillEntrySchema>;
export type Manifest = z.infer<typeof manifestSchema>;

const MANIFEST_FILE = "skills.json";

// ── Public API ──

/** Path to skills.json relative to the given directory. */
export function manifestPath(dir: string = "."): string {
  return join(dir, MANIFEST_FILE);
}

/** Read and validate skills.json. Returns an empty manifest if the file doesn't exist. */
export async function readManifest(dir: string = "."): Promise<Manifest> {
  const filePath = manifestPath(dir);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === "ENOENT") {
      return { skills: {} };
    }
    throw err;
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`Failed to parse ${MANIFEST_FILE}: invalid JSON.`);
  }

  const result = manifestSchema.safeParse(json);
  if (!result.success) {
    throw new Error(
      `Invalid ${MANIFEST_FILE}: ${result.error.issues.map((i) => i.message).join(", ")}`
    );
  }
  return result.data;
}

/** Write a manifest to skills.json. */
export async function writeManifest(
  manifest: Manifest,
  dir: string = "."
): Promise<void> {
  const filePath = manifestPath(dir);
  await writeFile(filePath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
}

/** Add or update a skill in the manifest (does not write to disk). */
export function addSkill(
  manifest: Manifest,
  name: string,
  entry: SkillEntry
): Manifest {
  return {
    ...manifest,
    skills: {
      ...manifest.skills,
      [name]: entry,
    },
  };
}

/** Remove a skill from the manifest (does not write to disk). Returns false if not found. */
export function removeSkill(
  manifest: Manifest,
  name: string
): { manifest: Manifest; removed: boolean } {
  if (!(name in manifest.skills)) {
    return { manifest, removed: false };
  }
  const { [name]: _, ...rest } = manifest.skills;
  return {
    manifest: { ...manifest, skills: rest },
    removed: true,
  };
}

// ── Helpers ──

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}
