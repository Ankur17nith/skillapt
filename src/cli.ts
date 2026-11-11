import { Command } from "commander";
import pc from "picocolors";
import { initCommand, type InitOptions } from "./commands/init.js";
import { installCommand } from "./commands/install.js";
import { removeCommand } from "./commands/remove.js";
import { listCommand, type ListOptions } from "./commands/list.js";
import { searchCommand, type SearchOptions } from "./commands/search.js";
import { infoCommand, type InfoOptions } from "./commands/info.js";
import { outdatedCommand, type OutdatedOptions } from "./commands/outdated.js";
import { updateCommand, type UpdateOptions } from "./commands/update.js";
import { loginCommand, type LoginOptions } from "./commands/login.js";
import { logoutCommand } from "./commands/logout.js";
import { packCommand, type PackCommandOptions } from "./commands/pack.js";
import { publishCommand, type PublishCommandOptions } from "./commands/publish.js";
import { yankCommand, type YankCommandOptions } from "./commands/yank.js";
import { doctorCommand, type DoctorOptions } from "./commands/doctor.js";
import { getBanner, getVersion } from "./lib/banner.js";
import { PRODUCT_NAME } from "./lib/config.js";

const program = new Command();

let debugMode = false;

program
  .name(PRODUCT_NAME)
  .description("A package manager for AI agent skills")
  .version(getVersion())
  .addHelpText("before", `${getBanner()}\n`)
  .option("--debug", "show full stack traces on error")
  .option("--dir <path>", "change the skills install directory (default: .skills)")
  .hook("preAction", (_thisCommand) => {
    const opts = program.opts<{ debug?: boolean; dir?: string }>();
    debugMode = !!opts.debug;
    if (opts.dir) {
      process.env.SKILLAPT_DIR = opts.dir;
    }
  });

program
  .command("init")
  .description("Scaffold skill package (SKILL.md, skill.json) or consumer skills.json")
  .option("--name <name>", "package name for the skill")
  .option("--skill", "scaffold skill.json and SKILL.md only")
  .option("--workspace", "scaffold skills.json only")
  .action(
    wrap(async (opts: { name?: string; skill?: boolean; workspace?: boolean }) => {
      await initCommand({
        name: opts.name,
        skillOnly: opts.skill,
        workspaceOnly: opts.workspace,
      });
    })
  );

program
  .command("install [source]")
  .description("Install a skill from the registry or GitHub, or install all from skills.json")
  .option("--frozen", "fail if skills.lock.json is missing or out of sync (for CI)")
  .option("--target <target>", "sync installed skill to AI agent directory (claude, cursor, codex)")
  .option("-g, --global", "install target skills globally to user home directory")
  .action(
    wrap(async (source?: string, opts?: { frozen?: boolean; target?: string; global?: boolean }) => {
      await installCommand(source, opts);
    })
  );

program
  .command("remove <name>")
  .description("Remove an installed skill")
  .action(wrap(removeCommand));

program
  .command("list")
  .description("Show installed skills")
  .option("--json", "output in JSON format")
  .action(
    wrap(async (opts: ListOptions) => {
      await listCommand(opts);
    })
  );

program
  .command("search <query>")
  .description("Search for skills in the registry")
  .option("--json", "output in JSON format")
  .option("--category <cat>", "filter by category")
  .option("--compat <runtime>", "filter by compatibility runtime")
  .option("--limit <count>", "number of items to return (default: 20)")
  .action(
    wrap(async (query: string, opts: SearchOptions) => {
      await searchCommand(query, opts);
    })
  );

program
  .command("info <name>")
  .description("Show detailed information about a registry skill")
  .option("--json", "output in JSON format")
  .action(
    wrap(async (name: string, opts: InfoOptions) => {
      await infoCommand(name, opts);
    })
  );

program
  .command("outdated")
  .description("Check for newer versions of installed skills")
  .option("--json", "output in JSON format")
  .action(
    wrap(async (opts: OutdatedOptions) => {
      await outdatedCommand(opts);
    })
  );

program
  .command("update [name]")
  .description("Update installed skills to their latest compatible versions")
  .option("--json", "output in JSON format")
  .action(
    wrap(async (name?: string, opts?: UpdateOptions) => {
      await updateCommand(name, opts);
    })
  );

program
  .command("login")
  .description("Authenticate with the skillapt registry via GitHub")
  .option("--token <token>", "provide API token directly")
  .action(
    wrap(async (opts: LoginOptions) => {
      await loginCommand(opts);
    })
  );

program
  .command("logout")
  .description("Remove stored credentials")
  .action(wrap(logoutCommand));

program
  .command("pack [dir]")
  .description("Validate skill files and create a .tar.gz archive")
  .option("--out <path>", "output directory for the .tar.gz file")
  .option("--json", "output in JSON format")
  .action(
    wrap(async (dir?: string, opts?: PackCommandOptions) => {
      await packCommand(dir, opts);
    })
  );

program
  .command("publish [target]")
  .description("Publish a skill package or tarball to the registry")
  .option("--registry <url>", "override registry URL")
  .option("--token <token>", "authentication token")
  .option("--keep-tarball", "keep generated tarball after publishing")
  .option("--json", "output in JSON format")
  .action(
    wrap(async (target?: string, opts?: PublishCommandOptions) => {
      await publishCommand(target, opts);
    })
  );

program
  .command("yank <spec> [version]")
  .description("Yank a published skill version from search and range resolution (e.g. name@1.0.0)")
  .option("--reason <reason>", "reason for yanking this version")
  .option("--registry <url>", "override registry URL")
  .option("--token <token>", "authentication token")
  .option("--json", "output in JSON format")
  .action(
    wrap(async (spec: string, versionOrOpts?: string | YankCommandOptions, maybeOpts?: YankCommandOptions) => {
      await yankCommand(spec, versionOrOpts, maybeOpts);
    })
  );

program
  .command("doctor")
  .description("Check Node.js version, registry reachability, authentication and environment")
  .option("--json", "output in JSON format")
  .action(
    wrap(async (opts: DoctorOptions) => {
      const ok = await doctorCommand(opts);
      if (!ok) {
        process.exit(1);
      }
    })
  );

program.parse();

/**
 * Wrap a command handler with centralized error handling.
 * Shows a clean error message and exits with code 1.
 * Only prints stack traces with --debug.
 */
function wrap<T extends unknown[]>(
  fn: (...args: T) => Promise<void>
): (...args: T) => Promise<void> {
  return async (...args: T) => {
    try {
      await fn(...args);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);
      console.error(`${pc.red("error:")} ${message}`);

      if (debugMode && err instanceof Error && err.stack) {
        console.error(`\n${pc.dim(err.stack)}`);
      }

      process.exit(1);
    }
  };
}
