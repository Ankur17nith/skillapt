import { readFile, stat, unlink } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import pc from "picocolors";
import { packSkill, validateSkillTarball } from "../lib/pack.js";
import { RegistryClient, type PublishResponse } from "../lib/registry.js";
import { getAuthToken } from "../lib/auth.js";

import { getRegistryUrl, validateRegistryUrl } from "../lib/config.js";

export interface PublishCommandOptions {
  registry?: string;
  token?: string;
  json?: boolean;
  keepTarball?: boolean;
}

export async function publishCommand(
  target: string = ".",
  options: PublishCommandOptions = {}
): Promise<PublishResponse> {
  const resolvedTarget = resolve(target);
  let tarballBuffer: Buffer;
  let tempTarballPath: string | null = null;
  let pkgName = "";
  let pkgVersion = "";

  const regUrl = options.registry ?? getRegistryUrl();
  validateRegistryUrl(regUrl);
  const targetOrigin = new URL(regUrl).origin;
  const configuredOrigin = new URL(getRegistryUrl()).origin;

  let token = options.token;
  if (!token) {
    if (targetOrigin !== configuredOrigin) {
      // Must not reuse a stored token for a different origin
      token = process.env.SKILLAPT_TOKEN?.trim();
      if (!token) {
        throw new Error(
          `Registry "${regUrl}" does not match the configured registry origin. Provide an explicit --token or SKILLAPT_TOKEN.`
        );
      }
    } else {
      token = (await getAuthToken(regUrl)) ?? process.env.SKILLAPT_TOKEN?.trim();
    }
  }

  if (!token) {
    throw new Error("Authentication required to publish skills. Run 'skillapt login' or set SKILLAPT_TOKEN.");
  }

  const ext = extname(resolvedTarget).toLowerCase();
  if (ext === ".tgz" || resolvedTarget.endsWith(".tar.gz")) {
    // Direct tarball publishing - must run local validation before uploading
    try {
      tarballBuffer = await readFile(resolvedTarget);
    } catch {
      throw new Error(`Cannot read tarball file at ${resolvedTarget}`);
    }
    const validated = await validateSkillTarball(resolvedTarget);
    pkgName = validated.manifest.name;
    pkgVersion = validated.manifest.version;
  } else {
    // Directory - pack first into OS temp
    const packResult = await packSkill(resolvedTarget, tmpdir());
    tarballBuffer = packResult.tarballBuffer;
    tempTarballPath = packResult.tarballPath;
    pkgName = packResult.manifest.name;
    pkgVersion = packResult.manifest.version;
  }

  const client = new RegistryClient({
    baseUrl: options.registry,
    token,
  });

  try {
    const response = await client.publishSkill(tarballBuffer, token);

    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
    } else {
      console.log(pc.green("✓") + ` Published ${pc.bold(response.name)}@${pc.bold(response.version)}`);
      console.log(`  Tarball URL: ${pc.cyan(response.tarballUrl)}`);
      console.log(`  SHA-256:     ${pc.dim(response.sha256)}`);
      console.log(`  Size:        ${(response.size / 1024).toFixed(1)} KB`);
    }

    return response;
  } finally {
    // If we generated a tarball in a temporary run and didn't request keeping it, we can keep or delete
    // In npm, npm publish deletes the pack tarball if created on the fly unless specified
    if (tempTarballPath && !options.keepTarball) {
      try {
        await unlink(tempTarballPath);
      } catch {
        // ignore cleanup error
      }
    }
  }
}
