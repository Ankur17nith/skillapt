import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readManifest,
  writeManifest,
  addSkill,
  removeSkill,
} from "../src/lib/manifest.js";

describe("manifest", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "skillpm-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns empty manifest when file is missing", async () => {
    const m = await readManifest(dir);
    expect(m).toEqual({ skills: {} });
  });

  it("reads a valid skills.json", async () => {
    const data = {
      skills: {
        "my-skill": { source: "user/repo", ref: "main" },
      },
    };
    await writeManifest(data, dir);

    const m = await readManifest(dir);
    expect(m.skills["my-skill"]?.source).toBe("user/repo");
  });

  it("throws on invalid JSON", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(dir, "skills.json"), "not json", "utf-8");

    await expect(readManifest(dir)).rejects.toThrow("invalid JSON");
  });

  it("throws on invalid schema", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(dir, "skills.json"),
      JSON.stringify({ skills: "oops" }),
      "utf-8"
    );

    await expect(readManifest(dir)).rejects.toThrow("Invalid skills.json");
  });

  it("writes manifest with correct formatting", async () => {
    await writeManifest({ skills: { a: { source: "x/y" } } }, dir);
    const raw = await readFile(join(dir, "skills.json"), "utf-8");
    expect(raw).toContain('"skills"');
    expect(raw.endsWith("\n")).toBe(true);
  });

  it("addSkill adds a new entry", () => {
    const m = addSkill({ skills: {} }, "test", { source: "a/b", ref: "main" });
    expect(m.skills["test"]).toEqual({ source: "a/b", ref: "main" });
  });

  it("addSkill updates existing entry", () => {
    const m1 = addSkill({ skills: {} }, "test", { source: "a/b", ref: "v1" });
    const m2 = addSkill(m1, "test", { source: "a/b", ref: "v2" });
    expect(m2.skills["test"]?.ref).toBe("v2");
  });

  it("removeSkill removes an existing entry", () => {
    const m = addSkill({ skills: {} }, "test", { source: "a/b" });
    const { manifest, removed } = removeSkill(m, "test");
    expect(removed).toBe(true);
    expect(manifest.skills["test"]).toBeUndefined();
  });

  it("removeSkill returns false for missing entry", () => {
    const { manifest, removed } = removeSkill({ skills: {} }, "nope");
    expect(removed).toBe(false);
    expect(manifest.skills).toEqual({});
  });
});
