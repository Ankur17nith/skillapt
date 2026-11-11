import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import pc from "picocolors";
import { packSkill, type PackResult } from "../lib/pack.js";

export interface PackCommandOptions {
  out?: string;
  json?: boolean;
}

export async function packCommand(
  dir: string = ".",
  options: PackCommandOptions = {}
): Promise<PackResult> {
  const resolvedDir = resolve(dir);
  if (options.out) {
    await mkdir(resolve(options.out), { recursive: true });
  }
  const result = await packSkill(resolvedDir, options.out);

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          name: result.manifest.name,
          version: result.manifest.version,
          tarball: result.tarballPath,
          sha256: result.sha256,
          integrity: result.integrity,
          fileCount: result.fileCount,
          compressedSize: result.compressedSize,
          uncompressedSize: result.uncompressedSize,
        },
        null,
        2
      )
    );
  } else {
    console.log(pc.green("✓") + ` Packed ${pc.bold(result.manifest.name)}@${pc.bold(result.manifest.version)}`);
    console.log(`  Tarball:   ${pc.cyan(result.tarballPath)}`);
    console.log(`  Integrity: ${pc.dim(result.integrity)}`);
    console.log(`  Files:     ${result.fileCount}`);
    console.log(`  Size:      ${(result.compressedSize / 1024).toFixed(1)} KB compressed (${(result.uncompressedSize / 1024).toFixed(1)} KB uncompressed)`);
  }

  return result;
}
