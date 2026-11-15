import { describe, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { doctorCommand } from "../../src/commands/doctor.js";

describe("A-02: Installation and Packaging", () => {
  it("package.json defines proper scripts, engines, and files", async () => {
    const pkgRaw = await readFile(resolve("package.json"), "utf-8");
    const pkg = JSON.parse(pkgRaw);

    expect(pkg.engines?.node).toMatch(/>=\s*22/);
    expect(pkg.scripts?.prepare).toBe("npm run build");
    expect(pkg.scripts?.prepublishOnly).toContain("npm run build");
    expect(pkg.files).toContain("dist");
    expect(pkg.files).toContain("README.md");
    expect(pkg.files).toContain("LICENSE");
    expect(pkg.bin?.skillpm).toBeUndefined();
  });

  it("doctor command is strictly read-only and does not create directories", async () => {
    const nonExistentDir = join(tmpdir(), `nonexistent-skills-dir-${Date.now()}`);
    process.env.SKILLAPT_DIR = nonExistentDir;
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await doctorCommand({ json: true });
      expect(existsSync(nonExistentDir)).toBe(false);
      const output = consoleSpy.mock.calls.find((c) => {
        try {
          return JSON.parse(c[0]).checks;
        } catch {
          return false;
        }
      });
      expect(output).toBeDefined();
    } finally {
      delete process.env.SKILLAPT_DIR;
      consoleSpy.mockRestore();
    }
  });
});
