import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";

vi.mock("node:child_process", () => ({
  execFile: vi.fn((file: string, args: string[], cb: Function) => {
    if (typeof cb === "function") cb(null, "", "");
  }),
}));
import {
  setStoredToken,
  getStoredToken,
  clearStoredToken,
  getAuthToken,
  openBrowser,
  getStoredConfig,
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

  it("stores token with origin and 0600 file mode permissions", async () => {
    await setStoredToken("apt_live_secret12345", "https://registry.skillapt.dev/v1");
    const configFile = join(tmpConfigDir, "skillapt", "config.json");

    const config = await getStoredConfig();
    expect(config?.origin).toBe("https://registry.skillapt.dev");
    expect(config?.token).toBe("apt_live_secret12345");

    const token = await getStoredToken();
    expect(token).toBe("apt_live_secret12345");

    // Check file mode permissions on Linux/macOS
    if (process.platform !== "win32") {
      const stats = await stat(configFile);
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it("does not reuse stored token for a different registry origin", async () => {
    await setStoredToken("apt_live_secret12345", "https://registry.skillapt.dev/v1");

    // Matching origin returns token
    expect(await getStoredToken("https://registry.skillapt.dev/v1")).toBe("apt_live_secret12345");

    // Different origin returns null
    expect(await getStoredToken("https://other-registry.dev/v1")).toBeNull();
    expect(await getAuthToken("https://other-registry.dev/v1")).toBeNull();

    // But if SKILLAPT_TOKEN is set, it can be returned
    process.env.SKILLAPT_TOKEN = "custom_env_token";
    expect(await getAuthToken("https://other-registry.dev/v1")).toBe("custom_env_token");
  });

  it("clears stored token on logout", async () => {
    await setStoredToken("apt_live_secret12345");
    expect(await getStoredToken()).toBe("apt_live_secret12345");

    await clearStoredToken();
    expect(await getStoredToken()).toBeNull();
  });

  it("getAuthToken prioritizes SKILLAPT_TOKEN env var for configured registry", async () => {
    await setStoredToken("stored_token");
    process.env.SKILLAPT_TOKEN = "env_token_override";

    const resolved = await getAuthToken();
    expect(resolved).toBe("env_token_override");
  });

  it("loginCommand warns that --token leaks to shell history", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
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

    expect(warnSpy).toHaveBeenCalled();
    const warnMsg = warnSpy.mock.calls[0][0];
    expect(warnMsg.toLowerCase()).toContain("leak");
  });

  it("loginCommand --token-stdin reads token from process.stdin", async () => {
    vi.spyOn(RegistryClient.prototype, "getMe").mockResolvedValue({
      id: "usr_123",
      handle: "testuser",
      name: "Test User",
      email: "test@example.com",
      avatarUrl: "",
      createdAt: "2026-11-01T00:00:00Z",
    });

    const { Readable } = await import("node:stream");
    const mockStdin = Readable.from(["  apt_live_from_stdin_123  \n"]);
    const originalStdin = process.stdin;
    Object.defineProperty(process, "stdin", {
      value: mockStdin,
      configurable: true,
    });

    try {
      await loginCommand({ tokenStdin: true });
      expect(await getStoredToken()).toBe("apt_live_from_stdin_123");
    } finally {
      Object.defineProperty(process, "stdin", {
        value: originalStdin,
        configurable: true,
      });
    }
  });

  it("openBrowser validates URL protocol is https", async () => {
    expect(await openBrowser("http://example.com")).toBe(false);
    expect(await openBrowser("javascript:alert(1)")).toBe(false);
    expect(await openBrowser("file:///etc/passwd")).toBe(false);
  });

  it("openBrowser calls execFile with argument array for https URLs", async () => {
    vi.mocked(execFile).mockClear();

    const success = await openBrowser("https://registry.skillapt.dev/auth/github");
    expect(success).toBe(true);
    expect(execFile).toHaveBeenCalled();
    const [, calledArgs] = vi.mocked(execFile).mock.calls[0];
    expect(Array.isArray(calledArgs)).toBe(true);
    expect(calledArgs).toContain("https://registry.skillapt.dev/auth/github");
  });
});
