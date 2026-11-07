import { describe, it, expect } from "vitest";
import { resolveSkillVersion } from "../src/lib/semver.js";
import type { SkillDetail } from "../src/lib/registry.js";

const mockSkill: SkillDetail = {
  name: "pdf-summarizer",
  description: "Test skill",
  license: "MIT",
  category: "documents",
  compatibility: ["claude"],
  owner: { handle: "alex", avatarUrl: "http://example.com/avatar.png" },
  latestVersion: "1.2.0",
  downloads: 100,
  versions: {
    "1.0.0": {
      version: "1.0.0",
      sha256: "hash100",
      size: 1000,
      tarballUrl: "http://example.com/1.0.0.tgz",
      dependencies: {},
      publishedAt: "2026-10-01T00:00:00Z",
      yanked: false,
      permissions: { network: false, shell: false, filesystem: "none" },
    },
    "1.1.0": {
      version: "1.1.0",
      sha256: "hash110",
      size: 1100,
      tarballUrl: "http://example.com/1.1.0.tgz",
      dependencies: {},
      publishedAt: "2026-10-15T00:00:00Z",
      yanked: false,
      permissions: { network: false, shell: false, filesystem: "none" },
    },
    "1.2.0": {
      version: "1.2.0",
      sha256: "hash120",
      size: 1200,
      tarballUrl: "http://example.com/1.2.0.tgz",
      dependencies: {},
      publishedAt: "2026-11-01T00:00:00Z",
      yanked: true, // YANKED!
      permissions: { network: false, shell: false, filesystem: "none" },
    },
  },
};

describe("resolveSkillVersion", () => {
  it("resolves highest non-yanked version when no range specified", () => {
    const resolved = resolveSkillVersion(mockSkill, null);
    expect(resolved.version).toBe("1.1.0"); // 1.2.0 is yanked, so 1.1.0 is picked
  });

  it("skips yanked versions for caret range (^1.0.0)", () => {
    const resolved = resolveSkillVersion(mockSkill, "^1.0.0");
    expect(resolved.version).toBe("1.1.0");
  });

  it("permits exact pinned version even if yanked", () => {
    const resolved = resolveSkillVersion(mockSkill, "1.2.0");
    expect(resolved.version).toBe("1.2.0");
  });

  it("throws clear error when range cannot be satisfied", () => {
    expect(() => resolveSkillVersion(mockSkill, ">=2.0.0")).toThrow(
      'No version of "pdf-summarizer" satisfies range ">=2.0.0"'
    );
  });

  it("throws when skill has no versions published", () => {
    const emptySkill = { ...mockSkill, versions: {} };
    expect(() => resolveSkillVersion(emptySkill, "*")).toThrow(
      'Skill "pdf-summarizer" has no published versions.'
    );
  });
});
