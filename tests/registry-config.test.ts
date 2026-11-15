import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getRegistryUrl,
  getConfiguredRegistryUrl,
  RegistryNotConfiguredError,
} from "../src/lib/config.js";
import { setStoredToken } from "../src/lib/auth.js";
import { doctorCommand } from "../src/commands/doctor.js";

describe("registry configuration without a default registry", () => {
  let configHome: string;
  const savedXdg = process.env.XDG_CONFIG_HOME;
  const savedRegistry = process.env.SKILLAPT_REGISTRY;

  beforeEach(async () => {
    configHome = await mkdtemp(join(tmpdir(), "skillapt-regcfg-"));
    process.env.XDG_CONFIG_HOME = configHome;
    delete process.env.SKILLAPT_REGISTRY;
  });

  afterEach(async () => {
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = savedXdg;
    if (savedRegistry === undefined) delete process.env.SKILLAPT_REGISTRY;
    else process.env.SKILLAPT_REGISTRY = savedRegistry;
    vi.restoreAllMocks();
    await rm(configHome, { recursive: true, force: true });
  });

  it("returns null / throws a helpful error when nothing is configured", () => {
    expect(getConfiguredRegistryUrl()).toBeNull();
    expect(() => getRegistryUrl()).toThrow(RegistryNotConfiguredError);
    expect(() => getRegistryUrl()).toThrow(/SKILLAPT_REGISTRY/);
  });

  it("uses SKILLAPT_REGISTRY and strips trailing slashes", () => {
    process.env.SKILLAPT_REGISTRY = "https://reg.example.com/v1///";
    expect(getRegistryUrl()).toBe("https://reg.example.com/v1");
  });

  it("falls back to the registry saved by login", async () => {
    await setStoredToken("apt_live_x", "https://saved.example.com/v1");
    expect(getRegistryUrl()).toBe("https://saved.example.com/v1");
    process.env.SKILLAPT_REGISTRY = "https://env.example.com/v1";
    expect(getRegistryUrl()).toBe("https://env.example.com/v1");
  });

  it("doctor reports an unconfigured registry as informational, not a failure", async () => {
    const out: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m: unknown) => void out.push(String(m)));
    const ok = await doctorCommand({ json: true });
    const parsed = JSON.parse(out.find((l) => l.includes('"checks"'))!);
    const registry = parsed.checks.find((c: { name: string }) => c.name === "Registry service");
    expect(registry.ok).toBe(true);
    expect(registry.message).toMatch(/not configured/);
    expect(ok).toBe(true);
  });
});
