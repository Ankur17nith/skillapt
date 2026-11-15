import { describe, it, expect, vi } from "vitest";
import { DependencyResolver } from "../../src/lib/dependencies.js";
import { RegistryClient, type SkillDetail } from "../../src/lib/registry.js";

function makeDetail(
  name: string,
  versions: Record<string, { dependencies?: Record<string, string> }>
): SkillDetail {
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

describe("A-08: Dependency resolver safety (cycles, depth, diamonds)", () => {
  it("terminates safely and throws on circular dependency graphs", async () => {
    const mockRegistry: Record<string, SkillDetail> = {
      "pkg-a": makeDetail("pkg-a", {
        "1.0.0": { dependencies: { "pkg-b": "^1.0.0" } },
      }),
      "pkg-b": makeDetail("pkg-b", {
        "1.0.0": { dependencies: { "pkg-a": "^1.0.0" } },
      }),
    };

    const client = new RegistryClient();
    vi.spyOn(client, "getSkill").mockImplementation(async (name) => {
      const res = mockRegistry[name];
      if (!res) throw new Error(`Not found: ${name}`);
      return res;
    });

    const resolver = new DependencyResolver(client);
    await expect(resolver.resolve("pkg-a", "^1.0.0")).rejects.toThrow(/dependency cycle detected/i);
  });

  it("enforces maximum dependency depth limit of 10 levels", async () => {
    const mockRegistry: Record<string, SkillDetail> = {};
    for (let i = 0; i <= 11; i++) {
      const current = `level-${i}`;
      const next = `level-${i + 1}`;
      mockRegistry[current] = makeDetail(current, {
        "1.0.0": { dependencies: i < 11 ? { [next]: "1.0.0" } : {} },
      });
    }

    const client = new RegistryClient();
    vi.spyOn(client, "getSkill").mockImplementation(async (name) => {
      const res = mockRegistry[name];
      if (!res) throw new Error(`Not found: ${name}`);
      return res;
    });

    const resolver = new DependencyResolver(client);
    await expect(resolver.resolve("level-0", "1.0.0")).rejects.toThrow(
      /exceeded maximum depth limit of 10 levels/i
    );
  });

  it("resolves diamond dependency topologies to a unified compatible version", async () => {
    const mockRegistry: Record<string, SkillDetail> = {
      root: makeDetail("root", {
        "1.0.0": { dependencies: { "mid-a": "^1.0.0", "mid-b": "^1.0.0" } },
      }),
      "mid-a": makeDetail("mid-a", {
        "1.0.0": { dependencies: { shared: "^1.0.0" } },
      }),
      "mid-b": makeDetail("mid-b", {
        "1.0.0": { dependencies: { shared: ">=1.2.0 <2.0.0" } },
      }),
      shared: makeDetail("shared", {
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
    const result = await resolver.resolve("root");
    expect(result.packages.get("shared")?.version).toBe("1.2.5");
  });

  it("caps the total number of resolved packages to stop install bombs", async () => {
    const deps: Record<string, string> = {};
    const mockRegistry: Record<string, SkillDetail> = {};
    // 3 layers of fan-out would be unbounded without a cap; 120 siblings exceeds it directly.
    for (let i = 0; i < 120; i++) {
      deps[`leaf-${i}`] = "1.0.0";
      mockRegistry[`leaf-${i}`] = makeDetail(`leaf-${i}`, { "1.0.0": {} });
    }
    mockRegistry["bomb-root"] = makeDetail("bomb-root", { "1.0.0": { dependencies: deps } });

    const client = new RegistryClient();
    vi.spyOn(client, "getSkill").mockImplementation(async (name) => {
      const res = mockRegistry[name];
      if (!res) throw new Error(`Not found: ${name}`);
      return res;
    });

    const resolver = new DependencyResolver(client);
    await expect(resolver.resolve("bomb-root", "1.0.0")).rejects.toThrow(/exceeds the limit/i);
  });
});
