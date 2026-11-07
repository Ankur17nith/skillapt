import { Command } from "commander";
import pc from "picocolors";
import { initCommand } from "./commands/init.js";
import { installCommand } from "./commands/install.js";
import { removeCommand } from "./commands/remove.js";
import { listCommand } from "./commands/list.js";
import { getBanner, getVersion } from "./lib/banner.js";

const program = new Command();

let debugMode = false;

program
  .name("skillpm")
  .description("A package manager for AI agent skills")
  .version(getVersion())
  .addHelpText("before", `${getBanner()}\n`)
  .option("--debug", "show full stack traces on error")
  .option("--dir <path>", "change the skills install directory (default: .skills)")
  .hook("preAction", (_thisCommand) => {
    const opts = program.opts<{ debug?: boolean; dir?: string }>();
    debugMode = !!opts.debug;
    if (opts.dir) {
      process.env.SKILLPM_DIR = opts.dir;
    }
  });

program
  .command("init")
  .description("Create a skills.json in the current folder")
  .action(wrap(initCommand));

program
  .command("install [source]")
  .description("Install a skill from the registry or GitHub, or install all from skills.json")
  .option("--frozen", "fail if skills.lock.json is missing or out of sync (for CI)")
  .action(
    wrap(async (source?: string, opts?: { frozen?: boolean }) => {
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
  .action(wrap(listCommand));

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
