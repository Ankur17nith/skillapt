import pc from "picocolors";
import { clearStoredToken } from "../lib/auth.js";

export async function logoutCommand(): Promise<void> {
  await clearStoredToken();
  console.log(`${pc.green("✓")} Successfully logged out. Removed credentials from ~/.config/skillapt/config.json.`);
}
