import { access, constants, mkdir } from "node:fs/promises";
import pc from "picocolors";
import semver from "semver";
import { getRegistryUrl, getSkillsDir } from "../lib/config.js";
import { getAuthToken } from "../lib/auth.js";
import { RegistryClient, type HealthStatus, type User } from "../lib/registry.js";

export interface DoctorOptions {
  json?: boolean;
}

export interface CheckResult {
  name: string;
  ok: boolean;
  message: string;
  details?: unknown;
}

export async function doctorCommand(options: DoctorOptions = {}): Promise<boolean> {
  const checks: CheckResult[] = [];

  // 1. Check Node.js version
  const currentVersion = process.version;
  const satisfiesNode = semver.gte(currentVersion, "20.0.0");
  checks.push({
    name: "Node.js runtime",
    ok: satisfiesNode,
    message: satisfiesNode
      ? `${currentVersion} (satisfies >= 20.0.0)`
      : `${currentVersion} (requires >= 20.0.0)`,
  });

  // 2. Check Registry Reachability
  const registryUrl = getRegistryUrl();
  const client = new RegistryClient();
  let registryHealth: HealthStatus | null = null;
  let registryOk = false;
  let registryMsg = "";

  try {
    registryHealth = await client.getHealth();
    registryOk = true;
    registryMsg = `${registryUrl} (reachable, ${registryHealth.product} v${registryHealth.version})`;
  } catch (err: unknown) {
    registryOk = false;
    registryMsg = `${registryUrl} (unreachable: ${err instanceof Error ? err.message : String(err)})`;
  }

  checks.push({
    name: "Registry service",
    ok: registryOk,
    message: registryMsg,
    details: registryHealth,
  });

  // 3. Check Authentication & Token
  const token = await getAuthToken();
  let authOk = true;
  let authMsg = "";
  let userDetails: User | null = null;

  if (token) {
    try {
      userDetails = await client.getMe(token);
      authMsg = `Logged in as @${userDetails.handle} (${userDetails.name || userDetails.email})`;
      authOk = true;
    } catch (err: unknown) {
      authOk = false;
      authMsg = `Token configured but invalid (${err instanceof Error ? err.message : String(err)})`;
    }
  } else {
    authMsg = "Not logged in (anonymous mode: public downloads only)";
    authOk = true;
  }

  checks.push({
    name: "Authentication",
    ok: authOk,
    message: authMsg,
    details: userDetails,
  });

  // 4. Check Skills Directory
  const skillsDir = getSkillsDir();
  let dirOk = false;
  let dirMsg = "";

  try {
    await mkdir(skillsDir, { recursive: true });
    await access(skillsDir, constants.R_OK | constants.W_OK);
    dirOk = true;
    dirMsg = `${skillsDir} (writable)`;
  } catch (err: unknown) {
    dirOk = false;
    dirMsg = `${skillsDir} (cannot access or write: ${err instanceof Error ? err.message : String(err)})`;
  }

  checks.push({
    name: "Skills directory",
    ok: dirOk,
    message: dirMsg,
  });

  const allPassed = checks.every((c) => c.ok);

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          allPassed,
          checks,
        },
        null,
        2
      )
    );
  } else {
    console.log(pc.bold("\nskillapt doctor\n"));
    for (const check of checks) {
      const icon = check.ok ? pc.green("✓") : pc.red("✗");
      const label = pc.bold(check.name);
      console.log(`${icon} ${label}: ${check.message}`);
    }
    console.log();
    if (allPassed) {
      console.log(pc.green("All diagnostic checks passed. System is ready.\n"));
    } else {
      console.log(pc.red("One or more diagnostic checks failed.\n"));
    }
  }

  if (!allPassed) {
    process.exitCode = 1;
  }

  return allPassed;
}
