import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readLockfile,
  writeLockfile,
  addLockEntry,
  removeLockEntry,
} from "../src/lib/lockfile.js";

describe("lockfile", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "skillpm-lock-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns empty lockfile when file is missing", async () => {
    const lf = await readLockfile(dir);
    expect(lf).toEqual({ skills: {} });
  });

  it("reads a valid lockfile", async () => {
    const data = {
      skills: {
        "my-skill": { source: "user/repo", sha: "abc123def456" },
      },
    };
    await writeLockfile(data, dir);

    const lf = await readLockfile(dir);
    expect(lf.skills["my-skill"]?.sha).toBe("abc123def456");
  });

  it("writes lockfile with correct formatting", async () => {
    await writeLockfile(
      { skills: { a: { source: "x/y", sha: "aaa" } } },
      dir
    );
    const raw = await readFile(join(dir, "skills.lock.json"), "utf-8");
    expect(raw).toContain('"skills"');
    expect(raw.endsWith("\n")).toBe(true);
  });

  it("addLockEntry adds a new entry", () => {
    const lf = addLockEntry(
      { skills: {} },
      "test",
      { source: "a/b", sha: "abc" }
    );
    expect(lf.skills["test"]).toEqual({ source: "a/b", sha: "abc" });
  });

  it("addLockEntry updates existing entry", () => {
    const lf1 = addLockEntry(
      { skills: {} },
      "test",
      { source: "a/b", sha: "v1" }
    );
    const lf2 = addLockEntry(lf1, "test", { source: "a/b", sha: "v2" });
    expect(lf2.skills["test"]?.sha).toBe("v2");
  });

  it("removeLockEntry removes an entry", () => {
    const lf = addLockEntry(
      { skills: {} },
      "test",
      { source: "a/b", sha: "abc" }
    );
    const result = removeLockEntry(lf, "test");
    expect(result.skills["test"]).toBeUndefined();
  });

  it("removeLockEntry is a no-op for missing entry", () => {
    const result = removeLockEntry({ skills: {} }, "nope");
    expect(result.skills).toEqual({});
  });
});
