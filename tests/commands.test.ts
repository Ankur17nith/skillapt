import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchCommand } from "../src/commands/search.js";
import { infoCommand } from "../src/commands/info.js";
import { RegistryClient } from "../src/lib/registry.js";

describe("search and info commands", () => {
  let logSpy: any;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("searchCommand --json outputs valid JSON string", async () => {
    vi.spyOn(RegistryClient.prototype, "searchSkills").mockResolvedValue({
      skills: [
        {
          name: "pdf-summarizer",
          latestVersion: "1.2.0",
          description: "Extracts text from PDF documents",
          license: "MIT",
          category: "documents",
          compatibility: ["claude"],
          downloads: 1420,
          verified: true,
          owner: { handle: "alex", avatarUrl: "" },
          updatedAt: "2026-11-01T00:00:00Z",
        },
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    await searchCommand("pdf", { json: true });
    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].name).toBe("pdf-summarizer");
  });

  it("infoCommand --json outputs full skill JSON", async () => {
    vi.spyOn(RegistryClient.prototype, "getSkill").mockResolvedValue({
      name: "pdf-summarizer",
      description: "Extracts text from PDF documents",
      license: "MIT",
      category: "documents",
      compatibility: ["claude"],
      owner: { handle: "alex", avatarUrl: "" },
      latestVersion: "1.2.0",
      downloads: 1420,
      versions: {
        "1.2.0": {
          version: "1.2.0",
          sha256: "hash120",
          size: 14250,
          tarballUrl: "http://example.com/1.2.0.tgz",
          dependencies: { "text-cleaner": "^1.0.0" },
          publishedAt: "2026-11-01T00:00:00Z",
          yanked: false,
          permissions: { network: false, shell: false, filesystem: "read" },
        },
      },
      createdAt: "2026-10-15T00:00:00Z",
      updatedAt: "2026-11-01T00:00:00Z",
    });

    await infoCommand("pdf-summarizer", { json: true });
    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.name).toBe("pdf-summarizer");
    expect(parsed.versions["1.2.0"].sha256).toBe("hash120");
  });
});
