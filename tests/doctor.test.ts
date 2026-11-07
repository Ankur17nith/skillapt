import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { doctorCommand } from "../src/commands/doctor.js";
import { RegistryClient } from "../src/lib/registry.js";
import * as auth from "../src/lib/auth.js";

describe("doctor command", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes checks when registry is reachable and anonymous", async () => {
    vi.spyOn(auth, "getAuthToken").mockResolvedValue(null);
    vi.spyOn(RegistryClient.prototype, "getHealth").mockResolvedValue({
      status: "ok",
      product: "skillapt",
      version: "1.1.0",
      timestamp: new Date().toISOString(),
    });

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const ok = await doctorCommand({ json: true });
    expect(ok).toBe(true);

    const logged = consoleSpy.mock.calls[0]?.[0];
    const parsed = JSON.parse(logged);
    expect(parsed.allPassed).toBe(true);
    expect(parsed.checks.some((c: { name: string }) => c.name === "Node.js runtime")).toBe(true);
    expect(parsed.checks.some((c: { name: string }) => c.name === "Registry service")).toBe(true);
  });

  it("checks authenticated user when token exists", async () => {
    vi.spyOn(auth, "getAuthToken").mockResolvedValue("apt_live_mocktoken");
    vi.spyOn(RegistryClient.prototype, "getHealth").mockResolvedValue({
      status: "ok",
      product: "skillapt",
      version: "1.1.0",
      timestamp: new Date().toISOString(),
    });
    vi.spyOn(RegistryClient.prototype, "getMe").mockResolvedValue({
      id: "usr_123",
      handle: "alexdev",
      name: "Alex",
      email: "alex@example.com",
      avatarUrl: "",
      createdAt: "",
    });

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const ok = await doctorCommand();
    expect(ok).toBe(true);

    const allLogs = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(allLogs).toContain("alexdev");
    expect(allLogs).toContain("Node.js runtime");
  });

  it("handles registry reachability failure gracefully", async () => {
    vi.spyOn(RegistryClient.prototype, "getHealth").mockRejectedValue(
      new Error("ECONNREFUSED")
    );

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const ok = await doctorCommand({ json: true });
    expect(ok).toBe(false);

    const logged = consoleSpy.mock.calls[0]?.[0];
    const parsed = JSON.parse(logged);
    expect(parsed.allPassed).toBe(false);
    const regCheck = parsed.checks.find((c: { name: string }) => c.name === "Registry service");
    expect(regCheck.ok).toBe(false);
  });
});
