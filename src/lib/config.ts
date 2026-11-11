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
 * Get the active registry base URL (supports SKILLAPT_REGISTRY env var).
 */
export function getRegistryUrl(): string {
  const url = process.env.SKILLAPT_REGISTRY ?? DEFAULT_REGISTRY_URL;
  return url.replace(/\/+$/, "");
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
