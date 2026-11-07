import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readLockfile,
  writeLockfile,
  addLockEntry,
  removeLockEntry,
  checkLockfileSync,
} from "../src/lib/lockfile.js";

describe("lockfile v2", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "skillapt-lock-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns empty v2 lockfile when file is missing", async () => {
    const lf = await readLockfile(dir);
    expect(lf.lockfileVersion).toBe(2);
    expect(lf.skills).toEqual({});
  });

  it("reads and writes v2 lockfile with registry metadata", async () => {
    const data = {
      lockfileVersion: 2,
      skills: {
        "pdf-summarizer": {
          source: "registry",
          version: "1.2.0",
          resolved: "https://registry.skillapt.dev/v1/skills/pdf-summarizer/-/1.2.0.tgz",
          sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          dependencies: {
            "text-cleaner": "^1.0.0",
          },
        },
      },
    };
    await writeLockfile(data, dir);

    const lf = await readLockfile(dir);
    expect(lf.lockfileVersion).toBe(2);
    expect(lf.skills["pdf-summarizer"]?.version).toBe("1.2.0");
    expect(lf.skills["pdf-summarizer"]?.sha256).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    expect(lf.skills["pdf-summarizer"]?.dependencies?.["text-cleaner"]).toBe("^1.0.0");
  });

  it("addLockEntry sets lockfileVersion 2 and adds v2 entry", () => {
    const lf = addLockEntry(
      { lockfileVersion: 2, skills: {} },
      "test",
      {
        source: "registry",
        version: "1.0.0",
        sha256: "hash123",
        resolved: "http://example.com/test.tgz",
      }
    );
    expect(lf.lockfileVersion).toBe(2);
    expect(lf.skills["test"]?.version).toBe("1.0.0");
    expect(lf.skills["test"]?.sha256).toBe("hash123");
  });

  it("removeLockEntry removes an entry", () => {
    const lf = addLockEntry(
      { lockfileVersion: 2, skills: {} },
      "test",
      { source: "registry", version: "1.0.0" }
    );
    const result = removeLockEntry(lf, "test");
    expect(result.skills["test"]).toBeUndefined();
  });

  it("checkLockfileSync correctly detects missing packages", () => {
    const manifest = {
      skills: {
        "pkg-a": { source: "pkg-a" },
        "pkg-b": { source: "pkg-b" },
      },
    };
    const lockfile = {
      lockfileVersion: 2,
      skills: {
        "pkg-a": { source: "pkg-a", version: "1.0.0" },
      },
    };

    const res = checkLockfileSync(manifest, lockfile);
    expect(res.inSync).toBe(false);
    expect(res.missing).toEqual(["pkg-b"]);
  });

  it("checkLockfileSync returns inSync true when all packages match", () => {
    const manifest = {
      skills: {
        "pkg-a": { source: "pkg-a" },
      },
    };
    const lockfile = {
      lockfileVersion: 2,
      skills: {
        "pkg-a": { source: "pkg-a", version: "1.0.0" },
      },
    };

    const res = checkLockfileSync(manifest, lockfile);
    expect(res.inSync).toBe(true);
    expect(res.missing).toEqual([]);
  });
});
