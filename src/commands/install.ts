import pc from "picocolors";
import { parseSource, type SkillSource, type GitHubSource, type RegistrySource } from "../lib/source.js";
import { resolveRef, downloadTarball } from "../lib/github.js";
import { extractSkill } from "../lib/extract.js";
import { readManifest, writeManifest, addSkill } from "../lib/manifest.js";
import {
  readLockfile,
  writeLockfile,
  addLockEntry,
} from "../lib/lockfile.js";
import { getSkillsDir } from "../lib/config.js";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { moveDir } from "../lib/fs.js";
import { getBanner } from "../lib/banner.js";
import { RegistryClient } from "../lib/registry.js";
import { resolveSkillVersion } from "../lib/semver.js";

export async function installCommand(source?: string): Promise<void> {
  if (source) {
    await installSingle(source);
  } else {
    await installAll();
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

  const rangeOrVersion = options?.forceVersion ?? parsed.range;
  const rangeLabel = rangeOrVersion ? `@${rangeOrVersion}` : "";

  console.log(pc.dim(`Resolving ${parsed.name}${rangeLabel} from registry...`));
  const detail = await client.getSkill(parsed.name);
  const resolved = resolveSkillVersion(detail, rangeOrVersion);

  console.log(pc.dim(`Downloading ${parsed.name}@${resolved.version}...`));
  const { stream } = await client.downloadTarball(parsed.name, resolved.version);

  console.log(pc.dim(`Verifying sha256 & extracting...`));
  await extractSkill({
    tarballStream: stream,
    name: parsed.name,
    skillsDir,
    expectedSha256: resolved.sha256,
  });

  // Update skills.json
  let manifest = await readManifest();
  manifest = addSkill(manifest, parsed.name, {
    source: parsed.name,
    version: parsed.range ?? `^${resolved.version}`,
  });
  await writeManifest(manifest);

  // Update lockfile
  let lockfile = await readLockfile();
  lockfile = addLockEntry(lockfile, parsed.name, {
    source: "registry",
    version: resolved.version,
    resolved: resolved.tarballUrl,
    sha256: resolved.sha256,
    dependencies: resolved.dependencies ?? {},
  });
  await writeLockfile(lockfile);

  console.log(`${getBanner()}`);
  console.log(`${pc.green("✓")} Installed ${pc.bold(parsed.name)} ${pc.dim(`(v${resolved.version})`)}`);
}

async function installAll(): Promise<void> {
  const manifest = await readManifest();
  const lockfile = await readLockfile();
  const skills = Object.entries(manifest.skills);

  if (skills.length === 0) {
    console.log(pc.yellow("No skills listed in skills.json. Nothing to install."));
    return;
  }

  console.log(`Installing ${pc.bold(String(skills.length))} skill(s)...\n`);

  for (const [name, entry] of skills) {
    const isGitHub = entry.source.includes("/") && !entry.source.startsWith("@");
    if (isGitHub) {
      const sourceStr = entry.subpath
        ? `${entry.source}/${entry.subpath}`
        : entry.source;
      const refStr = entry.ref ? `@${entry.ref}` : "";
      console.log(`→ ${pc.bold(name)} ${pc.dim(`(${sourceStr}${refStr})`)}`);

      try {
        const lockEntry = lockfile.skills[name];
        const forceSha = lockEntry?.sha;
        await installSingle(`${sourceStr}${refStr}`, { forceSha });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  ${pc.red("✗")} Failed to install ${name}: ${message}`);
      }
    } else {
      const verStr = entry.version ? `@${entry.version}` : "";
      console.log(`→ ${pc.bold(name)} ${pc.dim(`(${entry.source || name}${verStr})`)}`);

      try {
        const lockEntry = lockfile.skills[name];
        const forceVersion = lockEntry?.version;
        await installSingle(`${name}${verStr}`, { forceVersion });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  ${pc.red("✗")} Failed to install ${name}: ${message}`);
      }
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
