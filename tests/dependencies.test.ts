import { describe, it, expect, vi } from "vitest";
import { DependencyResolver } from "../src/lib/dependencies.js";
import { RegistryClient, type SkillDetail } from "../src/lib/registry.js";

function makeDetail(name: string, versions: Record<string, { dependencies?: Record<string, string> }>): SkillDetail {
  const versionMap: SkillDetail["versions"] = {};
  for (const [ver, vObj] of Object.entries(versions)) {
    versionMap[ver] = {
      version: ver,
      sha256: `sha_${name}_${ver}`,
      size: 1000,
      tarballUrl: `https://registry.skillapt.dev/v1/skills/${name}/-/${ver}.tgz`,
      dependencies: vObj.dependencies ?? {},
      publishedAt: "2026-11-01T00:00:00Z",
      yanked: false,
      permissions: { network: false, shell: false, filesystem: "none" },
    };
  }
  return {
    name,
    description: `Test ${name}`,
    license: "MIT",
    category: "tools" as any,
    compatibility: ["claude"],
    owner: { handle: "alex", avatarUrl: "" },
    latestVersion: Object.keys(versions)[0] || "1.0.0",
    downloads: 10,
    versions: versionMap,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
  };
}

describe("DependencyResolver", () => {
  it("resolves nested dependencies in topological order", async () => {
    const mockRegistry: Record<string, SkillDetail> = {
      "app-skill": makeDetail("app-skill", {
        "1.0.0": { dependencies: { "lib-a": "^1.0.0", "lib-b": "^1.0.0" } },
      }),
      "lib-a": makeDetail("lib-a", {
        "1.1.0": { dependencies: { "core-utils": "^2.0.0" } },
      }),
      "lib-b": makeDetail("lib-b", {
        "1.0.0": { dependencies: {} },
      }),
      "core-utils": makeDetail("core-utils", {
        "2.1.0": { dependencies: {} },
      }),
    };

    const client = new RegistryClient();
    vi.spyOn(client, "getSkill").mockImplementation(async (name) => {
      const res = mockRegistry[name];
      if (!res) throw new Error(`Not found: ${name}`);
      return res;
    });

    const resolver = new DependencyResolver(client);
    const { installOrder, treeString } = await resolver.resolve("app-skill", "^1.0.0");

    const orderNames = installOrder.map((p) => p.name);
    // core-utils must come before lib-a
    expect(orderNames.indexOf("core-utils")).toBeLessThan(orderNames.indexOf("lib-a"));
    // lib-a and lib-b must come before app-skill
    expect(orderNames.indexOf("lib-a")).toBeLessThan(orderNames.indexOf("app-skill"));
    expect(orderNames.indexOf("lib-b")).toBeLessThan(orderNames.indexOf("app-skill"));

    expect(treeString).toContain("app-skill");
    expect(treeString).toContain("lib-a");
    expect(treeString).toContain("core-utils");
    expect(treeString).toContain("lib-b");
  });

  it("detects dependency cycles and aborts", async () => {
    const mockRegistry: Record<string, SkillDetail> = {
      "cycle-a": makeDetail("cycle-a", {
        "1.0.0": { dependencies: { "cycle-b": "^1.0.0" } },
      }),
      "cycle-b": makeDetail("cycle-b", {
        "1.0.0": { dependencies: { "cycle-a": "^1.0.0" } },
      }),
    };

    const client = new RegistryClient();
    vi.spyOn(client, "getSkill").mockImplementation(async (name) => {
      const res = mockRegistry[name];
      if (!res) throw new Error(`Not found: ${name}`);
      return res;
    });

    const resolver = new DependencyResolver(client);
    await expect(resolver.resolve("cycle-a")).rejects.toThrow(
      "Dependency cycle detected: cycle-a -> cycle-b -> cycle-a"
    );
  });

  it("detects version conflicts and provides informative message", async () => {
    const mockRegistry: Record<string, SkillDetail> = {
      "root-app": makeDetail("root-app", {
        "1.0.0": { dependencies: { "dep-x": "^1.0.0", "dep-y": "^1.0.0" } },
      }),
      "dep-x": makeDetail("dep-x", {
        "1.0.0": { dependencies: { "common-lib": "^1.0.0" } },
      }),
      "dep-y": makeDetail("dep-y", {
        "1.0.0": { dependencies: { "common-lib": "^2.0.0" } }, // incompatible range!
      }),
      "common-lib": makeDetail("common-lib", {
        "1.5.0": { dependencies: {} },
        "2.1.0": { dependencies: {} },
      }),
    };

    const client = new RegistryClient();
    vi.spyOn(client, "getSkill").mockImplementation(async (name) => {
      const res = mockRegistry[name];
      if (!res) throw new Error(`Not found: ${name}`);
      return res;
    });

    const resolver = new DependencyResolver(client);
    await expect(resolver.resolve("root-app")).rejects.toThrow(
      'Version conflict for dependency "common-lib"'
    );
  });

  it("unifies compatible ranges to a single shared version", async () => {
    const mockRegistry: Record<string, SkillDetail> = {
      "root-app": makeDetail("root-app", {
        "1.0.0": { dependencies: { "dep-x": "^1.0.0", "dep-y": "^1.0.0" } },
      }),
      "dep-x": makeDetail("dep-x", {
        "1.0.0": { dependencies: { "shared-lib": "^1.0.0" } },
      }),
      "dep-y": makeDetail("dep-y", {
        "1.0.0": { dependencies: { "shared-lib": ">=1.2.0 <2.0.0" } },
      }),
      "shared-lib": makeDetail("shared-lib", {
        "1.0.0": { dependencies: {} },
        "1.2.5": { dependencies: {} },
      }),
    };

    const client = new RegistryClient();
    vi.spyOn(client, "getSkill").mockImplementation(async (name) => {
      const res = mockRegistry[name];
      if (!res) throw new Error(`Not found: ${name}`);
      return res;
    });

    const resolver = new DependencyResolver(client);
    const result = await resolver.resolve("root-app");
    const shared = result.packages.get("shared-lib");
    expect(shared).toBeDefined();
    expect(shared?.version).toBe("1.2.5");
  });
});
