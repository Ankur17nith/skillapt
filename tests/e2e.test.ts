import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";

const SKIP = process.env.SKIP_NETWORK === "1";
const CLI = resolve("dist/cli.js");

// Use a small, well-known public repo that has a SKILL.md.
// We'll use the Antigravity "agy-customizations" skill as it's a real public skill folder.
// Alternatively, we can use any small public repo. Let's use a simple one.
// For testing, we'll create a test that works with any repo that has a SKILL.md.
// Using "google/gemini-cli" as an example — but we need one with SKILL.md.
// Let's use a repo we know will work. For safety, we'll just test the init/list path
// and do a real install only if we have a known working repo.

function run(args: string[], cwd: string): string {
  return execFileSync("node", [CLI, ...args], {
    cwd,
    encoding: "utf-8",
    timeout: 30000,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      NO_COLOR: "1", // Disable colors for easier assertion
    },
  });
}

function runMayFail(args: string[], cwd: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = run(args, cwd);
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: e.status ?? 1,
    };
  }
}

describe.skipIf(SKIP)("e2e", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "skillpm-e2e-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("init creates skills.json", () => {
    const out = run(["init"], dir);
    expect(out).toContain("Created skills.json");

    const manifest = JSON.parse(
      execFileSync("cat", [join(dir, "skills.json")], { encoding: "utf-8" })
    );
    expect(manifest).toEqual({ skills: {} });
  });

  it("init is idempotent", () => {
    run(["init"], dir);
    const out2 = run(["init"], dir);
    expect(out2).toContain("already exists");
  });

  it("list shows empty when nothing installed", () => {
    run(["init"], dir);
    const out = run(["list"], dir);
    expect(out).toContain("No skills installed");
  });

  it("remove fails for unknown skill", () => {
    run(["init"], dir);
    const { exitCode } = runMayFail(["remove", "nonexistent"], dir);
    expect(exitCode).not.toBe(0);
  });

  it("fails cleanly when repo is not a skill", () => {
    run(["init"], dir);
    const { exitCode, stderr } = runMayFail(
      ["install", "octocat/Hello-World"],
      dir
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not a valid skill");
  });

  it("full lifecycle: install -> list -> remove", async () => {
    // 1. Initialize
    run(["init"], dir);

    // 2. Install a real skill
    const installOut = run(
      ["install", "vercel-labs/skills/skills/find-skills"],
      dir
    );
    expect(installOut).toContain("Installed find-skills");

    // Check files exist
    const skillMdExists = existsSync(join(dir, ".skills", "find-skills", "SKILL.md"));
    expect(skillMdExists).toBe(true);

    // Check lockfile and skills.json exist
    const lockfileRaw = JSON.parse(
      execFileSync("cat", [join(dir, "skills.lock.json")], { encoding: "utf-8" })
    );
    expect(lockfileRaw.skills["find-skills"]).toBeDefined();

    // 3. List
    const listOut = run(["list"], dir);
    expect(listOut).toContain("find-skills");

    // 4. Remove
    const removeOut = run(["remove", "find-skills"], dir);
    expect(removeOut).toContain("Removed find-skills");

    // 5. List again — should be empty
    const listOutEmpty = run(["list"], dir);
    expect(listOutEmpty).toContain("No skills installed");
  });

  it("--version works", () => {
    const out = run(["--version"], dir);
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("--help works", () => {
    const out = run(["--help"], dir);
    expect(out).toContain("skillapt");
    expect(out).toContain("install");
    expect(out).toContain("remove");
    expect(out).toContain("list");
    expect(out).toContain("init");
    expect(out).toContain("search");
    expect(out).toContain("info");
    expect(out).toContain("outdated");
    expect(out).toContain("update");
  });

  it("--dir option changes skills directory", () => {
    const customDir = join(dir, "custom-skills");
    run(["init"], dir);

    // List with custom dir — should show no skills
    const out = run(["--dir", customDir, "list"], dir);
    expect(out).toContain("No skills installed");
  });
});
