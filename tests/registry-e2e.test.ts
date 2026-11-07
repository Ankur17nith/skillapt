import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import * as tar from "tar";
import { MockRegistryServer } from "./mock-registry.js";
import { installCommand } from "../src/commands/install.js";
import { readLockfile } from "../src/lib/lockfile.js";
import { readManifest } from "../src/lib/manifest.js";
import { packSkill } from "../src/lib/pack.js";
import { publishCommand } from "../src/commands/publish.js";
import { yankCommand } from "../src/commands/yank.js";
import { infoCommand } from "../src/commands/info.js";

describe("mock registry e2e", () => {
  let mockServer: MockRegistryServer;
  let registryUrl: string;
  let testWorkspace: string;
  let oldRegistryEnv: string | undefined;

  beforeAll(async () => {
    mockServer = new MockRegistryServer();
    registryUrl = await mockServer.start();
    oldRegistryEnv = process.env.SKILLAPT_REGISTRY;
    process.env.SKILLAPT_REGISTRY = registryUrl;
  });

  afterAll(async () => {
    await mockServer.stop();
    if (oldRegistryEnv) {
      process.env.SKILLAPT_REGISTRY = oldRegistryEnv;
    } else {
      delete process.env.SKILLAPT_REGISTRY;
    }
  });

  beforeEach(async () => {
    testWorkspace = await mkdtemp(join(tmpdir(), "skillapt-mock-e2e-"));
    process.env.SKILLAPT_DIR = join(testWorkspace, ".skills");
  });

  afterEach(async () => {
    delete process.env.SKILLAPT_DIR;
    await rm(testWorkspace, { recursive: true, force: true });
  });

  async function createValidSkillTarball(name: string, version: string, dependencies: Record<string, string> = {}): Promise<{ buffer: Buffer; sha256: string }> {
    const pkgDir = await mkdtemp(join(tmpdir(), `pkg-${name}-`));
    await writeFile(
      join(pkgDir, "skill.json"),
      JSON.stringify(
        {
          name,
          version,
          description: `A mock skill package for ${name}`,
          license: "MIT",
          category: "documents",
          compatibility: ["claude", "cursor"],
          dependencies,
          permissions: { network: false, shell: false, filesystem: "none" },
        },
        null,
        2
      )
    );
    await writeFile(
      join(pkgDir, "SKILL.md"),
      `---\nname: ${name}\ndescription: A mock skill package for ${name}\ncategory: documents\nversion: ${version}\n---\n\n# ${name}\nValid prompt guide content.\n`
    );

    const outTarball = join(pkgDir, `${name}-${version}.tgz`);
    await tar.create({ gzip: true, cwd: pkgDir, file: outTarball }, ["skill.json", "SKILL.md"]);

    const buffer = await readFile(outTarball);
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    await rm(pkgDir, { recursive: true, force: true });

    return { buffer, sha256 };
  }

  it("installs a package and its dependencies from mock registry with SHA-256 verification", async () => {
    // 1. Seed dependency skill: text-cleaner@1.0.0
    const depTar = await createValidSkillTarball("text-cleaner", "1.0.0");
    mockServer.addSkill(
      {
        name: "text-cleaner",
        description: "Text cleaner utility",
        license: "MIT",
        category: "data",
        compatibility: ["claude"],
        latestVersion: "1.0.0",
        downloads: 100,
        versions: {
          "1.0.0": {
            version: "1.0.0",
            integrity: `sha256-${depTar.sha256}`,
            sha256: depTar.sha256,
            size: depTar.buffer.length,
            tarballUrl: `${registryUrl}/v1/skills/text-cleaner/-/1.0.0.tgz`,
            dependencies: {},
            publishedAt: new Date().toISOString(),
            status: "active",
            yanked: false,
            permissions: { network: false, shell: false, filesystem: "none" },
          },
        },
        owner: { handle: "alexdev", avatarUrl: "" },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      { "1.0.0": depTar.buffer }
    );

    // 2. Seed root skill: pdf-summarizer@1.2.0 depending on text-cleaner@^1.0.0
    const rootTar = await createValidSkillTarball("pdf-summarizer", "1.2.0", { "text-cleaner": "^1.0.0" });
    mockServer.addSkill(
      {
        name: "pdf-summarizer",
        description: "Summarizes PDF documents",
        license: "MIT",
        category: "documents",
        compatibility: ["claude"],
        latestVersion: "1.2.0",
        downloads: 500,
        versions: {
          "1.2.0": {
            version: "1.2.0",
            integrity: `sha256-${rootTar.sha256}`,
            sha256: rootTar.sha256,
            size: rootTar.buffer.length,
            tarballUrl: `${registryUrl}/v1/skills/pdf-summarizer/-/1.2.0.tgz`,
            dependencies: { "text-cleaner": "^1.0.0" },
            publishedAt: new Date().toISOString(),
            status: "active",
            yanked: false,
            permissions: { network: false, shell: false, filesystem: "none" },
          },
        },
        owner: { handle: "alexdev", avatarUrl: "" },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      { "1.2.0": rootTar.buffer }
    );

    // Run install in testWorkspace
    const originalCwd = process.cwd();
    process.chdir(testWorkspace);
    try {
      await installCommand("pdf-summarizer");

      // Verify files installed
      expect(existsSync(join(testWorkspace, ".skills", "pdf-summarizer", "SKILL.md"))).toBe(true);
      expect(existsSync(join(testWorkspace, ".skills", "text-cleaner", "SKILL.md"))).toBe(true);

      // Verify lockfile v2
      const lockfile = await readLockfile(testWorkspace);
      expect(lockfile.lockfileVersion).toBe(2);
      expect(lockfile.skills["pdf-summarizer"]).toBeDefined();
      expect(lockfile.skills["pdf-summarizer"].sha256).toBe(rootTar.sha256);
      expect(lockfile.skills["pdf-summarizer"].integrity).toBe(`sha256-${rootTar.sha256}`);
      expect(lockfile.skills["text-cleaner"]).toBeDefined();
      expect(lockfile.skills["text-cleaner"].sha256).toBe(depTar.sha256);

      // Verify manifest
      const manifest = await readManifest(testWorkspace);
      expect(manifest.skills["pdf-summarizer"]).toBeDefined();
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("aborts install immediately on hash mismatch", async () => {
    const validTar = await createValidSkillTarball("tampered-skill", "1.0.0");
    const corruptedBuffer = Buffer.from(validTar.buffer);
    corruptedBuffer[corruptedBuffer.length - 10] ^= 0xff; // corrupt a byte

    mockServer.addSkill(
      {
        name: "tampered-skill",
        description: "Skill with corrupted hash",
        license: "MIT",
        category: "data",
        compatibility: ["claude"],
        latestVersion: "1.0.0",
        downloads: 0,
        versions: {
          "1.0.0": {
            version: "1.0.0",
            integrity: `sha256-${validTar.sha256}`,
            sha256: validTar.sha256, // registry advertises valid hash, but serves corrupted bytes
            size: corruptedBuffer.length,
            tarballUrl: `${registryUrl}/v1/skills/tampered-skill/-/1.0.0.tgz`,
            dependencies: {},
            publishedAt: new Date().toISOString(),
            status: "active",
            yanked: false,
            permissions: { network: false, shell: false, filesystem: "none" },
          },
        },
        owner: { handle: "alexdev", avatarUrl: "" },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      { "1.0.0": corruptedBuffer }
    );

    const originalCwd = process.cwd();
    process.chdir(testWorkspace);
    try {
      await expect(installCommand("tampered-skill")).rejects.toThrow(/Integrity check failed/i);
      expect(existsSync(join(testWorkspace, ".skills", "tampered-skill"))).toBe(false);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("performs locked install from skills.lock.json with --frozen", async () => {
    const skillTar = await createValidSkillTarball("locked-skill", "2.0.0");
    mockServer.addSkill(
      {
        name: "locked-skill",
        description: "Skill for locked install",
        license: "MIT",
        category: "data",
        compatibility: ["cursor"],
        latestVersion: "2.0.0",
        downloads: 10,
        versions: {
          "2.0.0": {
            version: "2.0.0",
            integrity: `sha256-${skillTar.sha256}`,
            sha256: skillTar.sha256,
            size: skillTar.buffer.length,
            tarballUrl: `${registryUrl}/v1/skills/locked-skill/-/2.0.0.tgz`,
            dependencies: {},
            publishedAt: new Date().toISOString(),
            status: "active",
            yanked: false,
            permissions: { network: false, shell: false, filesystem: "none" },
          },
        },
        owner: { handle: "alexdev", avatarUrl: "" },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      { "2.0.0": skillTar.buffer }
    );

    const originalCwd = process.cwd();
    process.chdir(testWorkspace);
    try {
      // First install to generate lockfile
      await installCommand("locked-skill");

      // Remove installed directory to test fresh install from lockfile
      await rm(join(testWorkspace, ".skills"), { recursive: true, force: true });

      // Run frozen install
      await installCommand(undefined, { frozen: true });
      expect(existsSync(join(testWorkspace, ".skills", "locked-skill", "SKILL.md"))).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("excludes yanked versions from range resolution but permits pinned install", async () => {
    const tar1 = await createValidSkillTarball("versioned-pkg", "1.0.0");
    const tar2 = await createValidSkillTarball("versioned-pkg", "1.1.0");

    mockServer.addSkill(
      {
        name: "versioned-pkg",
        description: "Package with a yanked version",
        license: "MIT",
        category: "documents",
        compatibility: ["claude"],
        latestVersion: "1.1.0",
        downloads: 50,
        versions: {
          "1.0.0": {
            version: "1.0.0",
            sha256: tar1.sha256,
            size: tar1.buffer.length,
            tarballUrl: `${registryUrl}/v1/skills/versioned-pkg/-/1.0.0.tgz`,
            dependencies: {},
            publishedAt: new Date().toISOString(),
            status: "active",
            yanked: false,
            permissions: { network: false, shell: false, filesystem: "none" },
          },
          "1.1.0": {
            version: "1.1.0",
            sha256: tar2.sha256,
            size: tar2.buffer.length,
            tarballUrl: `${registryUrl}/v1/skills/versioned-pkg/-/1.1.0.tgz`,
            dependencies: {},
            publishedAt: new Date().toISOString(),
            status: "yanked",
            yanked: true,
            permissions: { network: false, shell: false, filesystem: "none" },
          },
        },
        owner: { handle: "alexdev", avatarUrl: "" },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      { "1.0.0": tar1.buffer, "1.1.0": tar2.buffer }
    );

    const originalCwd = process.cwd();
    process.chdir(testWorkspace);
    try {
      // Range resolution should pick 1.0.0 since 1.1.0 is yanked
      await installCommand("versioned-pkg");
      const lockfile = await readLockfile(testWorkspace);
      expect(lockfile.skills["versioned-pkg"].version).toBe("1.0.0");

      // But exact pinned version 1.1.0 can be installed explicitly
      await installCommand("versioned-pkg@1.1.0");
      const lockfile2 = await readLockfile(testWorkspace);
      expect(lockfile2.skills["versioned-pkg"].version).toBe("1.1.0");
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("publishes skill tarball to registry and yanks it", async () => {
    // 1. Create a local skill in testWorkspace
    await writeFile(
      join(testWorkspace, "skill.json"),
      JSON.stringify(
        {
          name: "authored-skill",
          version: "1.0.0",
          description: "An authored skill to publish",
          license: "MIT",
          category: "coding",
          compatibility: ["claude"],
          permissions: { network: false, shell: false, filesystem: "none" },
        },
        null,
        2
      )
    );
    await writeFile(
      join(testWorkspace, "SKILL.md"),
      `---\nname: authored-skill\ndescription: An authored skill to publish\ncategory: coding\nversion: 1.0.0\n---\n\n# Authored Skill\nDocumentation content here.\n`
    );

    const originalCwd = process.cwd();
    process.chdir(testWorkspace);
    try {
      // Publish
      const pubRes = await publishCommand(testWorkspace, {
        registry: registryUrl,
        token: "apt_live_test_token_123",
        keepTarball: true,
      });

      expect(pubRes.name).toBe("mock-published-skill"); // default mock server name handler
      expect(pubRes.version).toBe("1.0.0");

      // Yank
      const yankRes = await yankCommand("mock-published-skill@1.0.0", {
        reason: "Discovered critical bug",
        registry: registryUrl,
        token: "apt_live_test_token_123",
      });

      expect(yankRes.yanked).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });
});
