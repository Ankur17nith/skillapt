import { describe, it, expect, vi } from "vitest";
import { handleMessage, callTool, MCP_TOOLS } from "../src/commands/mcp.js";

const client = {
  searchSkills: vi.fn().mockResolvedValue({
    skills: [
      {
        name: "@alice/pdf-tools",
        category: "documents",
        description: "Extract text from PDFs",
        verified: false,
        claimStatus: "unclaimed",
        installCommand: "npx skillapt install @alice/pdf-tools",
      },
    ],
    pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
  }),
  getCategories: vi.fn().mockResolvedValue([{ id: "documents", label: "Documents", description: "Files", count: 2 }]),
  getSkill: vi.fn().mockRejectedValue(new Error("Skill 'nope' does not exist.")),
};

describe("mcp server", () => {
  it("initializes and lists tools", async () => {
    const init = await handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize" }, client as never);
    expect((init as any).result.capabilities.tools).toEqual({});
    const list = await handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, client as never);
    expect((list as any).result.tools.map((t: any) => t.name)).toEqual(MCP_TOOLS.map((t) => t.name));
  });

  it("ignores notifications and rejects unknown methods", async () => {
    expect(await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, client as never)).toBeNull();
    const res = await handleMessage({ jsonrpc: "2.0", id: 3, method: "nope" }, client as never);
    expect((res as any).error.code).toBe(-32601);
  });

  it("searches with an install command in the result", async () => {
    const res = await callTool(client as never, "search_skills", { query: "pdf", limit: 100 });
    expect(res.content[0].text).toContain("install: npx skillapt install @alice/pdf-tools");
    expect(client.searchSkills).toHaveBeenCalledWith({ q: "pdf", category: undefined, limit: 25 });
  });

  it("reports tool errors instead of throwing", async () => {
    expect((await callTool(client as never, "search_skills", { query: " " })).isError).toBe(true);
    expect((await callTool(client as never, "get_skill", { name: "nope" })).isError).toBe(true);
    expect((await callTool(client as never, "bogus")).isError).toBe(true);
    expect((await callTool(client as never, "list_categories")).content[0].text).toContain("documents (2)");
  });
});
