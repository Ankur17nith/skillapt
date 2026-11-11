import pc from "picocolors";
import { RegistryClient, type YankResponse } from "../lib/registry.js";
import { getAuthToken } from "../lib/auth.js";
import { getRegistryUrl, validateRegistryUrl } from "../lib/config.js";

export interface YankCommandOptions {
  reason?: string;
  registry?: string;
  token?: string;
  json?: boolean;
}

export function parsePackageVersionSpec(
  spec: string,
  versionArg?: string
): { name: string; version: string } {
  if (versionArg) {
    return { name: spec, version: versionArg };
  }

  // Handle @scope/name@1.0.0 or name@1.0.0
  const lastAtIndex = spec.lastIndexOf("@");
  if (lastAtIndex > 0) {
    const name = spec.slice(0, lastAtIndex);
    const version = spec.slice(lastAtIndex + 1);
    if (name && version) {
      return { name, version };
    }
  }

  throw new Error(`Invalid package version specification: "${spec}". Use "name@version" or provide version as an argument.`);
}

export async function yankCommand(
  spec: string,
  versionOrOptions?: string | YankCommandOptions,
  maybeOptions?: YankCommandOptions
): Promise<YankResponse> {
  let versionArg: string | undefined;
  let options: YankCommandOptions;

  if (typeof versionOrOptions === "string") {
    versionArg = versionOrOptions;
    options = maybeOptions ?? {};
  } else {
    options = versionOrOptions ?? {};
  }

  const { name, version } = parsePackageVersionSpec(spec, versionArg);

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
    throw new Error("Authentication required to yank skills. Run 'skillapt login' or set SKILLAPT_TOKEN.");
  }

  const client = new RegistryClient({
    baseUrl: options.registry,
    token,
  });

  const response = await client.yankSkill(name, version, options.reason, token);

  if (options.json) {
    console.log(JSON.stringify(response, null, 2));
  } else {
    console.log(pc.green("✓") + ` Yanked ${pc.bold(response.name)}@${pc.bold(response.version)}`);
    if (options.reason) {
      console.log(`  Reason: ${pc.dim(options.reason)}`);
    }
  }

  return response;
}
