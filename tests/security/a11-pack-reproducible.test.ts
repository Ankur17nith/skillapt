import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packCommand } from "../../src/commands/pack.js";
import { parseFrontmatter } from "../../src/lib/validation.js";

describe("A-11: Pack reproducibility, exclusions, and YAML block scalars", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "skillapt-sec-a11-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("produces deterministic, bit-for-bit identical tarball sha256 checksums", async () => {
    const pkgDir = join(tmpDir, "my-skill");
    await mkdir(pkgDir, { recursive: true });

    await writeFile(
      join(pkgDir, "skill.json"),
      JSON.stringify({
        name: "repro-skill",
        version: "1.0.0",
        description: "Deterministic packaging test skill",
        license: "Apache-2.0",
        category: "coding",
        compatibility: ["claude"],
        permissions: { network: false, shell: false, filesystem: "none" },
      })
    );

    await writeFile(
      join(pkgDir, "SKILL.md"),
      `---\nname: repro-skill\ndescription: "Deterministic build test"\n---\n# Repro`
    );

    await writeFile(join(pkgDir, "helper.ts"), "export const a = 1;\n");

    const outDir = join(tmpDir, "dist");
    const res1 = await packCommand(pkgDir, { outDir });
    const res2 = await packCommand(pkgDir, { outDir });

    expect(res1.sha256).toBe(res2.sha256);
    expect(res1.sha256).toHaveLength(64);
  });

  it("correctly parses YAML frontmatter with block scalars (> and |)", () => {
    const folded = parseFrontmatter(`---
name: folded-skill
description: >
  This is a multiline
  folded string description
  for testing.
---
# Folded`);
    expect(folded.name).toBe("folded-skill");
    expect(folded.description).toContain("This is a multiline folded string description for testing.");

    const literal = parseFrontmatter(`---
name: literal-skill
description: |
  Line 1
  Line 2
---
# Literal`);
    expect(literal.name).toBe("literal-skill");
    expect(literal.description).toContain("Line 1\nLine 2");
  });
});
