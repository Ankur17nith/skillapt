import pc from "picocolors";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { getRegistryUrl } from "../lib/config.js";
import { openBrowser, verifyToken, setStoredToken } from "../lib/auth.js";
import { getBanner } from "../lib/banner.js";

export interface LoginOptions {
  token?: string;
  tokenStdin?: boolean;
}

export async function loginCommand(options: LoginOptions = {}): Promise<void> {
  const registryUrl = getRegistryUrl();
  let token: string | undefined;

  if (options.tokenStdin) {
    let buf = "";
    for await (const chunk of process.stdin) {
      buf += chunk;
    }
    token = buf.trim();
  } else if (options.token) {
    console.warn(
      pc.yellow(
        "Warning: Passing --token on the command line may leak secrets to shell history and process listings. Consider using --token-stdin or SKILLAPT_TOKEN instead."
      )
    );
    token = options.token.trim();
  }

  if (!token) {
    const authUrl = `${registryUrl}/auth/github`;
    console.log(`${getBanner()}`);
    console.log(pc.cyan(`Opening browser for authentication at ${authUrl}...`));

    const opened = await openBrowser(authUrl);
    if (!opened) {
      console.log(pc.dim(`Could not launch browser automatically. Please open:\n  ${pc.underline(authUrl)}`));
    }

    console.log(`\nOnce logged in, copy your API token from the dashboard and paste it below:`);

    if (!process.stdin.isTTY) {
      throw new Error(
        "Standard input is not a terminal. Provide a token using 'skillapt login --token-stdin' or set SKILLAPT_TOKEN."
      );
    }

    const rl = createInterface({ input, output });
    try {
      const answer = await rl.question(pc.bold("Paste API Token: "));
      token = answer.trim();
    } finally {
      rl.close();
    }
  }

  if (!token) {
    throw new Error("No token provided. Login aborted.");
  }

  console.log(pc.dim("Verifying token with registry..."));
  const user = await verifyToken(token);

  await setStoredToken(token);

  console.log(
    `${pc.green("✓")} Successfully logged in as ${pc.bold(`@${user.handle}`)}${user.name ? ` (${user.name})` : ""}.`
  );
  console.log(pc.dim(`Token saved securely to ~/.config/skillapt/config.json with file mode 0600.`));
}
