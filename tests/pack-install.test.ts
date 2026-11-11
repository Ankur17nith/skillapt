import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";

describe("package pack and install verification", () => {
  it("packs skillapt, installs tarball in temp dir, and runs skillapt --version", async () => {
    const rootDir = resolve(".");
    const pkgJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf-8"));
    const expectedVersion = pkgJson.version;

    const tmpDir = await mkdtemp(join(tmpdir(), "skillapt-pack-install-test-"));

    try {
      // 1. Run npm pack in rootDir, outputting tarball into tmpDir
      const packOutput = execFileSync("npm", ["pack", "--ignore-scripts", "--pack-destination", tmpDir], {
        cwd: rootDir,
        encoding: "utf-8",
      }).trim();
      const lines = packOutput.split("\n").map((l) => l.trim()).filter(Boolean);
      const tarballName = lines[lines.length - 1];
      const tarballPath = join(tmpDir, tarballName);

      // 2. In a consumer temp dir, run npm install <tarball>
      const consumerDir = join(tmpDir, "consumer");
      await mkdir(consumerDir, { recursive: true });
      execFileSync("npm", ["init", "-y"], { cwd: consumerDir, encoding: "utf-8" });
      execFileSync("npm", ["install", "--no-save", tarballPath], {
        cwd: consumerDir,
        encoding: "utf-8",
      });

      // 3. Execute the installed CLI binary and verify version
      const cliBin = join(consumerDir, "node_modules", ".bin", "skillapt");
      const versionOut = execFileSync(cliBin, ["--version"], {
        cwd: consumerDir,
        encoding: "utf-8",
      }).trim();

      expect(versionOut).toBe(expectedVersion);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }, 60000);
});
