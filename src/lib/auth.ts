import { readFile, writeFile, mkdir, chmod, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { getConfigDir, getConfigFilePath, getRegistryUrl } from "./config.js";
import { RegistryClient, type User } from "./registry.js";

const execAsync = promisify(exec);

export interface StoredConfig {
  token?: string;
  registry?: string;
}

/**
 * Get stored token from ~/.config/skillapt/config.json.
 */
export async function getStoredToken(): Promise<string | null> {
  const filePath = getConfigFilePath();
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const raw = await readFile(filePath, "utf-8");
    const json = JSON.parse(raw) as StoredConfig;
    return json.token?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Save token to ~/.config/skillapt/config.json with file mode 0600.
 * Ensures the token is never logged or exposed.
 */
export async function setStoredToken(token: string): Promise<void> {
  const configDir = getConfigDir();
  const filePath = getConfigFilePath();

  // Ensure directory exists with 0700 mode
  await mkdir(configDir, { recursive: true, mode: 0o700 });

  let existing: StoredConfig = {};
  if (existsSync(filePath)) {
    try {
      existing = JSON.parse(await readFile(filePath, "utf-8"));
    } catch {
      existing = {};
    }
  }

  const updated: StoredConfig = {
    ...existing,
    token: token.trim(),
    registry: getRegistryUrl(),
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
 * Returns null if not authenticated.
 */
export async function getAuthToken(): Promise<string | null> {
  const envToken = process.env.SKILLAPT_TOKEN?.trim();
  if (envToken) {
    return envToken;
  }
  return getStoredToken();
}

/**
 * Open a URL in the user's default browser (non-blocking, graceful fallback).
 */
export async function openBrowser(url: string): Promise<boolean> {
  try {
    const platform = process.platform;
    let command = "";
    if (platform === "darwin") {
      command = `open "${url}"`;
    } else if (platform === "win32") {
      command = `start "" "${url}"`;
    } else {
      command = `xdg-open "${url}"`;
    }
    await execAsync(command);
    return true;
  } catch {
    return false;
  }
}

/**
 * Authenticate and verify token with the registry.
 * Returns verified user profile.
 */
export async function verifyToken(token: string): Promise<User> {
  const client = new RegistryClient({ token });
  return client.getMe();
}
