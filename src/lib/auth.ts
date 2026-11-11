import { readFile, writeFile, mkdir, chmod, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { getConfigDir, getConfigFilePath, getRegistryUrl } from "./config.js";
import { RegistryClient, type User } from "./registry.js";

export interface StoredConfig {
  origin?: string;
  token?: string;
  registry?: string;
}

/**
 * Read the full stored config JSON.
 */
export async function getStoredConfig(): Promise<StoredConfig | null> {
  const filePath = getConfigFilePath();
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as StoredConfig;
  } catch {
    return null;
  }
}

/**
 * Get stored token from ~/.config/skillapt/config.json bound to registry origin.
 * If targetRegistryUrl is specified, only returns the token if the origin matches.
 */
export async function getStoredToken(targetRegistryUrl?: string): Promise<string | null> {
  const config = await getStoredConfig();
  if (!config || !config.token) {
    return null;
  }

  const targetUrl = targetRegistryUrl ?? getRegistryUrl();
  const targetOrigin = new URL(targetUrl).origin;
  const storedOrigin = config.origin ?? (config.registry ? new URL(config.registry).origin : null);

  // If stored config has an origin, it MUST match the request origin
  if (storedOrigin && storedOrigin !== targetOrigin) {
    return null;
  }

  return config.token.trim() || null;
}

/**
 * Save token to ~/.config/skillapt/config.json with file mode 0600.
 * Binds the token to the registry origin.
 */
export async function setStoredToken(token: string, registryUrl?: string): Promise<void> {
  const configDir = getConfigDir();
  const filePath = getConfigFilePath();

  // Ensure directory exists with 0700 mode
  await mkdir(configDir, { recursive: true, mode: 0o700 });

  const existing: StoredConfig = (await getStoredConfig()) ?? {};
  const activeRegistry = registryUrl ?? getRegistryUrl();
  const origin = new URL(activeRegistry).origin;

  const updated: StoredConfig = {
    ...existing,
    origin,
    token: token.trim(),
    registry: activeRegistry,
  };

  // Write file with mode 0600
  await writeFile(filePath, JSON.stringify(updated, null, 2) + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });

  // Explicitly ensure chmod 0600 on existing files as well
  try {
    await chmod(filePath, 0o600);
  } catch {
    // Windows might ignore chmod, which is fine
  }
}

/**
 * Clear stored token from config.
 */
export async function clearStoredToken(): Promise<void> {
  const filePath = getConfigFilePath();
  if (!existsSync(filePath)) {
    return;
  }

  try {
    const raw = await readFile(filePath, "utf-8");
    const json = JSON.parse(raw) as StoredConfig;
    delete json.token;
    delete json.origin;
    await writeFile(filePath, JSON.stringify(json, null, 2) + "\n", {
      encoding: "utf-8",
      mode: 0o600,
    });
  } catch {
    // If corrupted, remove the file
    await rm(filePath, { force: true });
  }
}

/**
 * Resolves active token from environment variable SKILLAPT_TOKEN or config file.
 * - SKILLAPT_TOKEN applies to configured registry only (unless explicitly passed for commands).
 * - Stored token is bound to its origin and is never reused for a different origin.
 * Returns null if not authenticated.
 */
export async function getAuthToken(targetRegistryUrl?: string): Promise<string | null> {
  const configuredUrl = getRegistryUrl();
  const configuredOrigin = new URL(configuredUrl).origin;
  const targetOrigin = targetRegistryUrl ? new URL(targetRegistryUrl).origin : configuredOrigin;

  // When a different registry origin is explicitly targeted:
  // Do NOT reuse stored token from a different origin.
  // SKILLAPT_TOKEN can be used if user set it.
  if (targetOrigin !== configuredOrigin) {
    const envToken = process.env.SKILLAPT_TOKEN?.trim();
    return envToken || null;
  }

  const envToken = process.env.SKILLAPT_TOKEN?.trim();
  if (envToken) {
    return envToken;
  }

  return getStoredToken(targetRegistryUrl);
}

/**
 * Open a URL in the user's default browser (non-blocking, graceful fallback).
 * Validates that URL protocol is HTTPS and uses execFile with an argument array.
 */
export async function openBrowser(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return false;
    }
  } catch {
    return false;
  }

  return new Promise<boolean>((resolve) => {
    let cmd: string;
    let args: string[];

    if (process.platform === "darwin") {
      cmd = "open";
      args = [url];
    } else if (process.platform === "win32") {
      cmd = process.env.COMSPEC || "cmd.exe";
      args = ["/c", "start", "", url];
    } else {
      cmd = "xdg-open";
      args = [url];
    }

    try {
      execFile(cmd, args, (err) => {
        if (err) {
          resolve(false);
        } else {
          resolve(true);
        }
      });
    } catch {
      resolve(false);
    }
  });
}

/**
 * Authenticate and verify token with the registry.
 * Returns verified user profile.
 */
export async function verifyToken(token: string, registryUrl?: string): Promise<User> {
  const client = new RegistryClient({ baseUrl: registryUrl, token });
  return client.getMe();
}
