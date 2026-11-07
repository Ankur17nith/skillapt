import pc from "picocolors";
import { existsSync } from "node:fs";
import { parseSource, type SkillSource, type GitHubSource, type RegistrySource } from "../lib/source.js";
import { resolveRef, downloadTarball } from "../lib/github.js";
import { extractSkill } from "../lib/extract.js";
import { readManifest, writeManifest, addSkill } from "../lib/manifest.js";
import {
  readLockfile,
  writeLockfile,
  addLockEntry,
  lockfilePath,
  checkLockfileSync,
  type LockEntry,
} from "../lib/lockfile.js";
import { getSkillsDir } from "../lib/config.js";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { moveDir } from "../lib/fs.js";
import { getBanner } from "../lib/banner.js";
import { RegistryClient } from "../lib/registry.js";
import { DependencyResolver } from "../lib/dependencies.js";

export interface InstallOptions {
  frozen?: boolean;
}

export async function installCommand(
  source?: string,
  options: InstallOptions = {}
): Promise<void> {
  if (options.frozen && source) {
    throw new Error("Cannot specify a package source when running with --frozen.");
  }

  if (source) {
    await installSingle(source);
  } else {
    await installAll(options);
  }
}

export async function installSingle(
  source: string,
  options?: { forceSha?: string; forceVersion?: string }
): Promise<void> {
  const parsed = parseSource(source);

  if (parsed.type === "github") {
    await installGitHub(parsed, options);
  } else {
    await installRegistry(parsed, options);
  }
}

async function installGitHub(
  parsed: GitHubSource,
  options?: { forceSha?: string }
): Promise<void> {
  const skillsDir = getSkillsDir();
  const refLabel = parsed.ref ?? "HEAD";

  console.log(
    pc.dim(`Resolving ${parsed.owner}/${parsed.repo}@${refLabel}...`)
  );

  // Use forced SHA (from lockfile) or resolve the ref
  const sha = options?.forceSha ?? await resolveRef(parsed.owner, parsed.repo, parsed.ref);
  const shortSha = sha.slice(0, 7);

  console.log(pc.dim(`Downloading ${shortSha}...`));
  const tarball = await downloadTarball(parsed.owner, parsed.repo, sha);

  // Determine skill name: check skill.json after extraction, fallback to repo/subfolder name
  const defaultName = parsed.subpath
    ? parsed.subpath.split("/").pop()!
    : parsed.repo;

  console.log(pc.dim(`Extracting...`));
  const installDir = await extractSkill({
    tarballStream: tarball,
    name: defaultName,
    skillsDir,
    subpath: parsed.subpath,
  });

  // Try to read a name from skill.json
  const name = await readSkillName(installDir) ?? defaultName;

  // If skill.json provided a different name, rename the directory
  if (name !== defaultName) {
    const newDir = join(skillsDir, name);
    await rm(newDir, { recursive: true, force: true });
    await moveDir(installDir, newDir);
  }

  // Update skills.json
  let manifest = await readManifest();
  manifest = addSkill(manifest, name, {
    source: `${parsed.owner}/${parsed.repo}`,
    ref: parsed.ref ?? undefined,
    subpath: parsed.subpath ?? undefined,
  });
  await writeManifest(manifest);

  // Update lockfile
  let lockfile = await readLockfile();
  lockfile = addLockEntry(lockfile, name, {
    source: `${parsed.owner}/${parsed.repo}`,
    sha,
    subpath: parsed.subpath ?? undefined,
  });
  await writeLockfile(lockfile);

  console.log(`${getBanner()}`);
  console.log(`${pc.green("✓")} Installed ${pc.bold(name)} ${pc.dim(`(${shortSha})`)}`);
}

async function installRegistry(
  parsed: RegistrySource,
  options?: { forceVersion?: string }
): Promise<void> {
  const skillsDir = getSkillsDir();
  const client = new RegistryClient();
  const resolver = new DependencyResolver(client);

  const rangeOrVersion = options?.forceVersion ?? parsed.range;
  const rangeLabel = rangeOrVersion ? `@${rangeOrVersion}` : "";

  console.log(pc.dim(`Resolving dependencies for ${parsed.name}${rangeLabel}...`));
  const { packages, installOrder, treeString } = await resolver.resolve(parsed.name, rangeOrVersion);

  let lockfile = await readLockfile();

  // Install in deterministic topological order (dependencies first)
  for (const pkg of installOrder) {
    console.log(pc.dim(`Downloading ${pkg.name}@${pkg.version}...`));
    const { stream } = await client.downloadTarball(pkg.name, pkg.version);

    console.log(pc.dim(`Verifying sha256 & extracting ${pkg.name}...`));
    await extractSkill({
      tarballStream: stream,
      name: pkg.name,
      skillsDir,
      expectedSha256: pkg.sha256,
    });

    lockfile = addLockEntry(lockfile, pkg.name, {
      source: "registry",
      version: pkg.version,
      resolved: pkg.tarballUrl,
      sha256: pkg.sha256,
      dependencies: pkg.dependencies,
    });
  }

  await writeLockfile(lockfile);

  // Update skills.json with the root package
  const rootPkg = packages.get(parsed.name)!;
  let manifest = await readManifest();
  manifest = addSkill(manifest, parsed.name, {
    source: parsed.name,
    version: parsed.range ?? `^${rootPkg.version}`,
  });
  await writeManifest(manifest);

  console.log(`${getBanner()}`);
  console.log(`${pc.green("✓")} Installed skills:`);
  console.log(treeString);
}

/**
 * Install all skills from manifest and lockfile.
 * In locked install, registry packages NEVER call the resolve endpoint and fail on any hash mismatch.
 */
async function installAll(options: InstallOptions = {}): Promise<void> {
  const lockExists = existsSync(lockfilePath());

  if (options.frozen && !lockExists) {
    throw new Error(
      "Lockfile skills.lock.json not found. Run 'skillapt install' to generate a lockfile before using --frozen."
    );
  }

  const manifest = await readManifest();
  const lockfile = await readLockfile();
  const skillsDir = getSkillsDir();

  // If frozen, enforce complete lockfile sync
  if (options.frozen) {
    const sync = checkLockfileSync(manifest, lockfile);
    if (!sync.inSync) {
      throw new Error(
        `skills.lock.json is out of sync with skills.json. Missing: ${sync.missing.join(", ")}. Aborting frozen install.`
      );
    }
  }

  const lockedSkills = Object.entries(lockfile.skills);

  // If lockfile has skills, install strictly from lockfile (never calling resolve endpoint)
  if (lockedSkills.length > 0) {
    console.log(
      `Installing ${pc.bold(String(lockedSkills.length))} skill(s) from ${pc.cyan("skills.lock.json")}${options.frozen ? " (frozen)" : ""}...\n`
    );

    const client = new RegistryClient();

    for (const [name, entry] of lockedSkills) {
      if (entry.source === "registry" || (!entry.source.includes("/") && entry.version)) {
        // Registry skill from lockfile: DO NOT call resolve endpoint!
        if (!entry.version) {
          throw new Error(`Lockfile entry for "${name}" is missing version.`);
        }
        if (!entry.sha256) {
          throw new Error(`Lockfile entry for "${name}" is missing sha256 checksum.`);
        }

        console.log(`→ ${pc.bold(name)} ${pc.dim(`(v${entry.version})`)} [locked]`);
        const { stream } = await client.downloadTarball(name, entry.version);

        await extractSkill({
          tarballStream: stream,
          name,
          skillsDir,
          expectedSha256: entry.sha256,
        });
      } else {
        // GitHub skill from lockfile
        const sourceStr = entry.subpath ? `${entry.source}/${entry.subpath}` : entry.source;
        console.log(`→ ${pc.bold(name)} ${pc.dim(`(${sourceStr})`)} [locked]`);

        const tarball = await downloadTarball(
          entry.source.split("/")[0],
          entry.source.split("/")[1],
          entry.sha!
        );

        await extractSkill({
          tarballStream: tarball,
          name,
          skillsDir,
          subpath: entry.subpath,
        });
      }
    }

    console.log(`\n${pc.green("✓")} All skills installed successfully from lockfile.`);
    return;
  }

  // Fallback if lockfile is empty: install from skills.json and generate lockfile
  const manifestSkills = Object.entries(manifest.skills);
  if (manifestSkills.length === 0) {
    console.log(pc.yellow("No skills listed in skills.json. Nothing to install."));
    return;
  }

  console.log(`Installing ${pc.bold(String(manifestSkills.length))} skill(s) from skills.json...\n`);

  for (const [name, entry] of manifestSkills) {
    const isGitHub = entry.source.includes("/") && !entry.source.startsWith("@");
    if (isGitHub) {
      const sourceStr = entry.subpath ? `${entry.source}/${entry.subpath}` : entry.source;
      const refStr = entry.ref ? `@${entry.ref}` : "";
      console.log(`→ ${pc.bold(name)} ${pc.dim(`(${sourceStr}${refStr})`)}`);
      await installSingle(`${sourceStr}${refStr}`);
    } else {
      const verStr = entry.version ? `@${entry.version}` : "";
      console.log(`→ ${pc.bold(name)} ${pc.dim(`(${entry.source || name}${verStr})`)}`);
      await installSingle(`${name}${verStr}`);
    }
  }
}

async function readSkillName(dir: string): Promise<string | null> {
  try {
    const raw = await readFile(join(dir, "skill.json"), "utf-8");
    const json = JSON.parse(raw) as { name?: string };
    if (typeof json.name === "string" && json.name.trim()) {
      return json.name.trim();
    }
  } catch {
    // No skill.json or invalid — that's fine
  }
  return null;
}
