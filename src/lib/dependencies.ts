import semver from "semver";
import pc from "picocolors";
import type { RegistryClient, SkillDetail, SkillVersionSummary } from "./registry.js";
import { resolveSkillVersion } from "./semver.js";

export interface PackageRequirement {
  from: string;
  range: string;
}

export interface ResolvedPackage {
  name: string;
  version: string;
  sha256: string;
  tarballUrl: string;
  dependencies: Record<string, string>;
  dependenciesResolved: string[]; // names of child packages
}

export interface DependencyTreeResult {
  rootName: string;
  packages: Map<string, ResolvedPackage>;
  installOrder: ResolvedPackage[];
  treeString: string;
}

export class DependencyResolver {
  private client: RegistryClient;
  private skillDetailsCache = new Map<string, SkillDetail>();

  constructor(client: RegistryClient) {
    this.client = client;
  }

  /**
   * Recursively resolve a skill and all its dependencies.
   * Detects cycles and version conflicts with clear, helpful messages.
   */
  async resolve(
    rootName: string,
    rootRange?: string | null
  ): Promise<DependencyTreeResult> {
    const packages = new Map<string, ResolvedPackage>();
    const constraints = new Map<string, PackageRequirement[]>();
    const currentStack: string[] = [];

    await this.resolveNode(
      rootName,
      rootRange ?? "*",
      "root",
      packages,
      constraints,
      currentStack
    );

    // Compute deterministic topological sort (dependencies before dependents)
    const installOrder = this.topologicalSort(packages);
    const treeString = this.formatTree(rootName, packages);

    return {
      rootName,
      packages,
      installOrder,
      treeString,
    };
  }

  private async resolveNode(
    name: string,
    requestedRange: string,
    requestedBy: string,
    packages: Map<string, ResolvedPackage>,
    constraints: Map<string, PackageRequirement[]>,
    currentStack: string[]
  ): Promise<void> {
    // 1. Cycle Detection
    if (currentStack.includes(name)) {
      const cyclePath = [...currentStack, name].join(" -> ");
      throw new Error(`Dependency cycle detected: ${cyclePath}. Installation aborted.`);
    }

    // 2. Track range requirement
    const existingReqs = constraints.get(name) ?? [];
    existingReqs.push({ from: requestedBy, range: requestedRange });
    constraints.set(name, existingReqs);

    // 3. Check if already resolved in this tree
    const alreadyResolved = packages.get(name);
    if (alreadyResolved) {
      // Verify that the already-resolved version satisfies the new range
      if (!semver.satisfies(alreadyResolved.version, requestedRange)) {
        // Try to re-resolve a version that satisfies ALL constraints
        const skillDetail = await this.getSkillDetail(name);
        const allRanges = constraints.get(name) || [];
        const commonVersion = this.findCommonVersion(name, skillDetail, allRanges);

        if (!commonVersion) {
          const reqA = allRanges[0];
          const reqB = allRanges[allRanges.length - 1];
          throw new Error(
            `Version conflict for dependency "${name}": "${reqA.from}" requires "${reqA.range}", but "${reqB.from}" requires "${reqB.range}". No single version satisfies both requirements.`
          );
        }

        // Update to common version
        alreadyResolved.version = commonVersion.version;
        alreadyResolved.sha256 = commonVersion.sha256;
        alreadyResolved.tarballUrl = commonVersion.tarballUrl;
        alreadyResolved.dependencies = commonVersion.dependencies ?? {};
      }
      return;
    }

    // 4. Fetch detail and resolve best version
    const skillDetail = await this.getSkillDetail(name);
    const versionSummary = resolveSkillVersion(skillDetail, requestedRange);

    const resolvedPkg: ResolvedPackage = {
      name,
      version: versionSummary.version,
      sha256: versionSummary.sha256,
      tarballUrl: versionSummary.tarballUrl,
      dependencies: versionSummary.dependencies ?? {},
      dependenciesResolved: Object.keys(versionSummary.dependencies ?? {}),
    };

    packages.set(name, resolvedPkg);

    // 5. Recursively resolve child dependencies
    currentStack.push(name);
    try {
      const childDeps = Object.entries(resolvedPkg.dependencies);
      for (const [depName, depRange] of childDeps) {
        await this.resolveNode(
          depName,
          depRange,
          name,
          packages,
          constraints,
          currentStack
        );
      }
    } finally {
      currentStack.pop();
    }
  }

  private async getSkillDetail(name: string): Promise<SkillDetail> {
    if (this.skillDetailsCache.has(name)) {
      return this.skillDetailsCache.get(name)!;
    }
    const detail = await this.client.getSkill(name);
    this.skillDetailsCache.set(name, detail);
    return detail;
  }

  private findCommonVersion(
    name: string,
    skill: SkillDetail,
    requirements: PackageRequirement[]
  ): SkillVersionSummary | null {
    const versions = Object.keys(skill.versions || {}).filter(
      (v) => !skill.versions[v]?.yanked
    );

    // Filter versions that satisfy ALL requirements
    const matching = versions.filter((v) =>
      requirements.every((req) => semver.satisfies(v, req.range === "latest" ? "*" : req.range))
    );

    if (matching.length === 0) {
      return null;
    }

    // Pick highest satisfying
    const sorted = matching.sort(semver.rcompare);
    return skill.versions[sorted[0]] ?? null;
  }

  /**
   * Perform topological sorting so dependencies are installed before dependents.
   */
  private topologicalSort(packages: Map<string, ResolvedPackage>): ResolvedPackage[] {
    const visited = new Set<string>();
    const order: ResolvedPackage[] = [];

    const visit = (name: string) => {
      if (visited.has(name)) return;
      visited.add(name);

      const pkg = packages.get(name);
      if (!pkg) return;

      // Deterministic sorted traversal of dependencies
      const deps = [...pkg.dependenciesResolved].sort();
      for (const dep of deps) {
        visit(dep);
      }

      order.push(pkg);
    };

    // Sort package names alphabetically for deterministic output
    const allNames = [...packages.keys()].sort();
    for (const name of allNames) {
      visit(name);
    }

    return order;
  }

  /**
   * Format visual tree of installed skills.
   */
  formatTree(rootName: string, packages: Map<string, ResolvedPackage>): string {
    const lines: string[] = [];
    const rootPkg = packages.get(rootName);
    if (!rootPkg) return "";

    lines.push(`${pc.bold(rootPkg.name)} ${pc.dim(`@${rootPkg.version}`)}`);

    const visitedInBranch = new Set<string>();
    visitedInBranch.add(rootName);

    const buildSubtree = (pkgName: string, prefix: string) => {
      const pkg = packages.get(pkgName);
      if (!pkg) return;

      const deps = [...pkg.dependenciesResolved].sort();
      deps.forEach((depName, idx) => {
        const isLast = idx === deps.length - 1;
        const branch = isLast ? "└─ " : "├─ ";
        const childPkg = packages.get(depName);
        const versionStr = childPkg ? `@${childPkg.version}` : "";

        lines.push(`${prefix}${branch}${depName} ${pc.dim(versionStr)}`);

        if (!visitedInBranch.has(depName)) {
          visitedInBranch.add(depName);
          const nextPrefix = prefix + (isLast ? "   " : "│  ");
          buildSubtree(depName, nextPrefix);
        }
      });
    };

    buildSubtree(rootName, "");
    return lines.join("\n");
  }
}
