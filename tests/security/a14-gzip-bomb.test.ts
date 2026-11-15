import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { extractSkill } from "../../src/lib/extract.js";

function streamOf(buf: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(buf);
      controller.close();
    },
  });
}

describe("A-14: gzip decompression bomb", () => {
  it("rejects a tiny gzip that inflates far beyond the uncompressed limit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skillapt-sec-a14-"));
    try {
      // ~64 MB of zeros compresses to a few tens of KB.
      const bomb = gzipSync(Buffer.alloc(64 * 1024 * 1024));
      expect(bomb.byteLength).toBeLessThan(5 * 1024 * 1024);
      await expect(
        extractSkill({ tarballStream: streamOf(bomb), name: "bomb-skill", skillsDir: dir })
      ).rejects.toThrow(/uncompressed size exceeds/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects input that is not gzip", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skillapt-sec-a14-"));
    try {
      await expect(
        extractSkill({
          tarballStream: streamOf(Buffer.from("not a tarball at all")),
          name: "plain-skill",
          skillsDir: dir,
        })
      ).rejects.toThrow(/gzip/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
