import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";

/**
 * The single canonical product name constant as required by SPEC.md.
 */
export const PRODUCT_NAME = "skillapt";

/**
 * Default registry endpoint, or null while no public registry is deployed.
 *
 * TODO(deploy): after deploying skillapt-registry to Cloudflare Workers, set this to the
 * real base URL (e.g. "https://skillapt-registry.<account>.workers.dev/v1") and update:
 *   - this constant (src/lib/config.ts)
 *   - the SKILLAPT_REGISTRY default in the README.md environment variable table
 *   - the "Registry status" note at the top of README.md
 *   - the default registry in docs/SPEC.md and docs/openapi.yaml (servers section)
 * Until then users configure a registry with SKILLAPT_REGISTRY or `skillapt login`.
 */
export const DEFAULT_REGISTRY_URL: string | null = null;

/** Thrown when a registry is required but none is configured. */
export class RegistryNotConfiguredError extends Error {
  constructor() {
    super(
      "No skillapt registry is configured. Set SKILLAPT_REGISTRY to your registry base URL " +
        "(for example SKILLAPT_REGISTRY=https://<your-worker>.workers.dev/v1), or install " +
        "directly from GitHub with `skillapt install owner/repo`."
    );
    this.name = "RegistryNotConfiguredError";
  }
}

/**
 * Get the skills directory (supports SKILLAPT_DIR or --dir flag via env var).
 */
export function getSkillsDir(): string {
  return process.env.SKILLAPT_DIR ?? ".skills";
}

/**
 * Validate that a registry URL uses HTTPS, allowing HTTP only for localhost and 127.0.0.1.
 */
export function validateRegistryUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid registry URL: "${url}". Must be a valid URL.`);
  }

  if (parsed.protocol === "https:") {
    return url;
  }

  if (parsed.protocol === "http:") {
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") {
      return url;
    }
    throw new Error(
      `Insecure registry URL "${url}". Registry URL must use HTTPS (HTTP is only permitted for localhost / 127.0.0.1).`
    );
  }

  throw new Error(
    `Unsupported protocol "${parsed.protocol}" in registry URL "${url}". Only HTTPS is allowed (HTTP for localhost).`
  );
}

/**
 * Resolve the configured registry without throwing when none is set.
 * Precedence: SKILLAPT_REGISTRY env var, then the registry saved by `skillapt login`,
 * then DEFAULT_REGISTRY_URL.
 */
export function getConfiguredRegistryUrl(): string | null {
  const fromEnv = process.env.SKILLAPT_REGISTRY?.trim();
  const raw = fromEnv || readStoredRegistry() || DEFAULT_REGISTRY_URL;
  if (!raw) return null;
  return validateRegistryUrl(raw.replace(/\/+$/, ""));
}

/**
 * Get the active registry base URL; throws RegistryNotConfiguredError when none is configured.
 */
export function getRegistryUrl(): string {
  const url = getConfiguredRegistryUrl();
  if (!url) throw new RegistryNotConfiguredError();
  return url;
}

function readStoredRegistry(): string | null {
  try {
    const raw = readFileSync(join(getConfigDir(), "config.json"), "utf-8");
    const parsed = JSON.parse(raw) as { registry?: unknown };
    return typeof parsed.registry === "string" && parsed.registry ? parsed.registry : null;
  } catch {
    return null;
  }
}

/**
 * Path to global config directory: ~/.config/skillapt
 */
export function getConfigDir(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  if (xdgConfigHome) {
    return join(xdgConfigHome, PRODUCT_NAME);
  }
  return join(homedir(), ".config", PRODUCT_NAME);
}

/**
 * Path to global config file: ~/.config/skillapt/config.json
 */
export function getConfigFilePath(): string {
  return join(getConfigDir(), "config.json");
}
