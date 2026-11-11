import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The single canonical product name constant as required by SPEC.md.
 */
export const PRODUCT_NAME = "skillapt";

/**
 * Default production registry endpoint.
 */
export const DEFAULT_REGISTRY_URL = "https://registry.skillapt.dev/v1";

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
 * Get the active registry base URL (supports SKILLAPT_REGISTRY env var).
 */
export function getRegistryUrl(): string {
  const url = process.env.SKILLAPT_REGISTRY ?? DEFAULT_REGISTRY_URL;
  const clean = url.replace(/\/+$/, "");
  return validateRegistryUrl(clean);
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
