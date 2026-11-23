import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchCommand } from "../src/commands/search.js";
import { categoriesCommand } from "../src/commands/categories.js";
import { RegistryClient } from "../src/lib/registry.js";

const skill = (over = {}) => ({
  name: "@alice/pdf-tools",
  latestVersion: "0.0.0",
  description: "Extract text and tables from PDF files",
  license: "MIT",
  category: "documents",
  compatibility: ["claude"],
  downloads: 3,
  verified: false,
  claimStatus: "unclaimed",
  installCommand: "npx skillapt install @alice/pdf-tools",
  owner: { handle: "skillapt-crawler", avatarUrl: "" },
  updatedAt: "2026-11-01T00:00:00Z",
  ...over,
});

describe("agent-friendly search and categories", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());
  const printed = () => logSpy.mock.calls.map((c) => String(c[0])).join("\n");

  it("prints plain text with an install line and trust label", async () => {
    vi.spyOn(RegistryClient.prototype, "searchSkills").mockResolvedValue({
      skills: [skill()],
      pagination: { page: 1, limit: 20, total: 5, totalPages: 1 },
    } as never);
    await searchCommand("pdf", { plain: true });
    const out = printed();
    expect(out).toContain("@alice/pdf-tools@0.0.0 [documents, unclaimed]");
    expect(out).toContain("install: npx skillapt install @alice/pdf-tools");
    expect(out).toContain("Showing 1 of 5");
  });

  it("allows a category-only search and passes the category through", async () => {
    const spy = vi.spyOn(RegistryClient.prototype, "searchSkills").mockResolvedValue({
      skills: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    } as never);
    await searchCommand(undefined, { category: "security", plain: true });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ q: "", category: "security" }));
    expect(printed()).toContain("category security");
  });

  it("requires a query or a category", async () => {
    await expect(searchCommand("  ", {})).rejects.toThrow(/query or --category/);
  });

  it("lists categories as plain text", async () => {
    vi.spyOn(RegistryClient.prototype, "getCategories").mockResolvedValue([
      { id: "security", label: "Security", description: "Audit code", count: 7 },
    ]);
    await categoriesCommand({ plain: true });
    expect(printed()).toContain("security (7): Audit code");
    expect(printed()).toContain("skillapt search --category <id>");
  });
});
