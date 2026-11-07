import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  setStoredToken,
  getStoredToken,
  clearStoredToken,
  getAuthToken,
} from "../src/lib/auth.js";
import { loginCommand } from "../src/commands/login.js";
import { logoutCommand } from "../src/commands/logout.js";
import { RegistryClient } from "../src/lib/registry.js";

describe("auth", () => {
  let tmpConfigDir: string;
  const originalEnv = process.env;

  beforeEach(async () => {
    tmpConfigDir = await mkdtemp(join(tmpdir(), "skillapt-config-test-"));
    process.env = { ...originalEnv, XDG_CONFIG_HOME: tmpConfigDir };
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmpConfigDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("stores token with 0600 file mode permissions", async () => {
    await setStoredToken("apt_live_secret12345");
    const configFile = join(tmpConfigDir, "skillapt", "config.json");

    const token = await getStoredToken();
    expect(token).toBe("apt_live_secret12345");

    // Check file mode permissions on Linux/macOS
    if (process.platform !== "win32") {
      const stats = await stat(configFile);
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it("clears stored token on logout", async () => {
    await setStoredToken("apt_live_secret12345");
    expect(await getStoredToken()).toBe("apt_live_secret12345");

    await clearStoredToken();
    expect(await getStoredToken()).toBeNull();
  });

  it("getAuthToken prioritizes SKILLAPT_TOKEN env var", async () => {
    await setStoredToken("stored_token");
    process.env.SKILLAPT_TOKEN = "env_token_override";

    const resolved = await getAuthToken();
    expect(resolved).toBe("env_token_override");
  });

  it("loginCommand saves token without printing it to stdout", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    vi.spyOn(RegistryClient.prototype, "getMe").mockResolvedValue({
      id: "usr_123",
      handle: "testuser",
      name: "Test User",
      email: "test@example.com",
      avatarUrl: "",
      createdAt: "2026-11-01T00:00:00Z",
    });

    const secretToken = "apt_live_verysecretstring";
    await loginCommand({ token: secretToken });

    // Verify token was stored
    expect(await getStoredToken()).toBe(secretToken);

    // Verify token was NEVER printed in any console log
    for (const call of logSpy.mock.calls) {
      for (const arg of call) {
        expect(String(arg)).not.toContain(secretToken);
      }
    }
  });
});
