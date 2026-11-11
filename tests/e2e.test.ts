import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import * as tar from "tar";

const execFileAsync = promisify(execFile);
const CLI = resolve("dist/cli.js");

describe("e2e", () => {
  let dir: string;
  let server: Server;
  let serverPort: number;
  let nonSkillTarball: Buffer;
  let validSkillTarball: Buffer;

  beforeAll(async () => {
    // 1. Build non-skill tarball (missing SKILL.md)
    const nonSkillDir = await mkdtemp(join(tmpdir(), "mock-gh-nonskill-"));
    const nonSkillSub = join(nonSkillDir, "Hello-World-head");
    await mkdir(nonSkillSub, { recursive: true });
    await writeFile(join(nonSkillSub, "README.md"), "Hello World");
    const nonSkillTarPath = join(nonSkillDir, "repo.tgz");
    await tar.create({ gzip: true, cwd: nonSkillDir, file: nonSkillTarPath }, ["Hello-World-head"]);
    nonSkillTarball = await readFile(nonSkillTarPath);
    await rm(nonSkillDir, { recursive: true, force: true });

    // 2. Build valid skill tarball containing skills/find-skills
    const skillRepoDir = await mkdtemp(join(tmpdir(), "mock-gh-skill-"));
    const skillSub = join(skillRepoDir, "skills-head", "skills", "find-skills");
    await mkdir(skillSub, { recursive: true });
    await writeFile(
      join(skillSub, "skill.json"),
      JSON.stringify({
        name: "find-skills",
        version: "1.0.0",
        description: "Skill to find other skills in repository",
        license: "MIT",
        category: "devtools",
        compatibility: ["claude", "cursor"],
        permissions: { network: false, shell: false, filesystem: "none" },
      })
    );
    await writeFile(
      join(skillSub, "SKILL.md"),
      `---\nname: find-skills\ndescription: Skill to find other skills in repository\n---\n# Find Skills\nMock content for finding skills.\n`
    );
    const skillTarPath = join(skillRepoDir, "skills.tgz");
    await tar.create({ gzip: true, cwd: skillRepoDir, file: skillTarPath }, ["skills-head"]);
    validSkillTarball = await readFile(skillTarPath);
    await rm(skillRepoDir, { recursive: true, force: true });

    // 3. Start local mock HTTP server for GitHub API & codeload
    server = createServer((req, res) => {
      const url = req.url ?? "";
      if (url.includes("/commits/")) {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("1234567890abcdef1234567890abcdef12345678");
        return;
      }
      if (url.includes("/Hello-World/tar.gz/")) {
        res.writeHead(200, { "Content-Type": "application/gzip" });
        res.end(nonSkillTarball);
        return;
      }
      if (url.includes("/skills/tar.gz/")) {
        res.writeHead(200, { "Content-Type": "application/gzip" });
        res.end(validSkillTarball);
        return;
      }
      res.writeHead(404);
      res.end("Not Found");
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        serverPort = (server.address() as any).port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "skillapt-e2e-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function run(args: string[], cwd: string, isLive = false): Promise<string> {
    const env: Record<string, string | undefined> = {
      ...process.env,
      NO_COLOR: "1",
    };
    if (!isLive && serverPort) {
      env.SKILLAPT_GITHUB_API_BASE = `http://127.0.0.1:${serverPort}`;
      env.SKILLAPT_GITHUB_CODELOAD_BASE = `http://127.0.0.1:${serverPort}`;
    }
    const { stdout } = await execFileAsync("node", [CLI, ...args], {
      cwd,
      encoding: "utf-8",
      timeout: 10000,
      env: env as Record<string, string>,
    });
    return stdout;
  }

  async function runMayFail(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    try {
      const stdout = await run(args, cwd);
      return { stdout, stderr: "", exitCode: 0 };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number; status?: number };
      return {
        stdout: e.stdout ?? "",
        stderr: e.stderr ?? "",
        exitCode: e.code ?? e.status ?? 1,
      };
    }
  }

  it("init creates skills.json", async () => {
    const out = await run(["init"], dir);
    expect(out).toContain("Created skills.json");

    const manifestRaw = await readFile(join(dir, "skills.json"), "utf-8");
    const manifest = JSON.parse(manifestRaw);
    expect(manifest).toEqual({ skills: {} });
  });

  it("init is idempotent", async () => {
    await run(["init"], dir);
    const out2 = await run(["init"], dir);
    expect(out2).toContain("already exists");
  });

  it("list shows empty when nothing installed", async () => {
    await run(["init"], dir);
    const out = await run(["list"], dir);
    expect(out).toContain("No skills installed");
  });

  it("remove fails for unknown skill", async () => {
    await run(["init"], dir);
    const { exitCode } = await runMayFail(["remove", "nonexistent"], dir);
    expect(exitCode).not.toBe(0);
  });

  it("fails cleanly when repo is not a skill without hitting live GitHub", async () => {
    await run(["init"], dir);
    const { exitCode, stderr } = await runMayFail(
      ["install", "octocat/Hello-World"],
      dir
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not a valid skill");
  });

  it("full lifecycle: install -> list -> remove with mocked GitHub fixtures", async () => {
    // 1. Initialize
    await run(["init"], dir);

    // 2. Install a GitHub skill using local mock server fixtures
    const installOut = await run(
      ["install", "vercel-labs/skills/skills/find-skills"],
      dir
    );
    expect(installOut).toContain("Installed find-skills");

    // Check files exist
    const skillMdExists = existsSync(join(dir, ".skills", "find-skills", "SKILL.md"));
    expect(skillMdExists).toBe(true);

    // Check lockfile and skills.json exist
    const lockfileRaw = JSON.parse(
      await readFile(join(dir, "skills.lock.json"), "utf-8")
    );
    expect(lockfileRaw.skills["find-skills"]).toBeDefined();

    // 3. List
    const listOut = await run(["list"], dir);
    expect(listOut).toContain("find-skills");

    // 4. Remove
    const removeOut = await run(["remove", "find-skills"], dir);
    expect(removeOut).toContain("Removed find-skills");

    // 5. List again — should be empty
    const listOutEmpty = await run(["list"], dir);
    expect(listOutEmpty).toContain("No skills installed");
  });

  it("--version works", async () => {
    const out = await run(["--version"], dir);
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("--help works", async () => {
    const out = await run(["--help"], dir);
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

  it("--dir option changes skills directory", async () => {
    const customDir = join(dir, "custom-skills");
    await run(["init"], dir);

    // List with custom dir — should show no skills
    const out = await run(["--dir", customDir, "list"], dir);
    expect(out).toContain("No skills installed");
  });

  it.runIf(process.env.LIVE_GITHUB_TEST === "1")(
    "live GitHub API install (opt-in via LIVE_GITHUB_TEST=1)",
    async () => {
      const liveDir = await mkdtemp(join(tmpdir(), "skillapt-live-"));
      try {
        await run(["init"], liveDir, true);
        const out = await run(
          ["install", "vercel-labs/skills/skills/find-skills"],
          liveDir,
          true
        );
        expect(out).toContain("Installed find-skills");
      } finally {
        await rm(liveDir, { recursive: true, force: true });
      }
    }
  );
});
