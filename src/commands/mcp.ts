import { createInterface } from "node:readline";
import { RegistryClient } from "../lib/registry.js";

/**
 * A minimal Model Context Protocol server over stdio (JSON-RPC, one message per line).
 * It is read-only: agents can search the registry and get the install command,
 * and then run `skillapt install` themselves under their own permission rules.
 */

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const PROTOCOL_VERSION = "2024-11-05";

export const MCP_TOOLS = [
  {
    name: "search_skills",
    description:
      "Search the skillapt registry for agent skills using plain words describing what you need (for example 'summarize a pdf'). Returns ranked results, each with an install command.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What you need, in plain words." },
        category: { type: "string", description: "Optional category id from list_categories." },
        limit: { type: "number", description: "Maximum results (default 10, max 25)." },
      },
      required: ["query"],
    },
  },
  {
    name: "list_categories",
    description: "List skill categories and what each is for, to narrow a search.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_skill",
    description: "Get details, ownership and the install command for one skill by name.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Skill name, for example @owner/skill." } },
      required: ["name"],
    },
  },
];

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (t: string, isError = false): ToolResult => ({ content: [{ type: "text", text: t }], ...(isError ? { isError } : {}) });

export async function callTool(
  client: Pick<RegistryClient, "searchSkills" | "getCategories" | "getSkill">,
  name: string,
  args: Record<string, unknown> = {}
): Promise<ToolResult> {
  try {
    if (name === "search_skills") {
      const query = String(args.query ?? "").trim();
      if (!query) return text("Provide a non-empty query.", true);
      const limit = Math.min(25, Math.max(1, Number(args.limit) || 10));
      const category = typeof args.category === "string" && args.category ? args.category : undefined;
      const res = await client.searchSkills({ q: query, category, limit });
      if (res.skills.length === 0) return text(`No skills found for "${query}". Try other words or list_categories.`);
      const lines = res.skills.map((s, i) => {
        const trust = s.verified ? "verified" : s.claimStatus === "unclaimed" ? "unclaimed" : "community";
        return `${i + 1}. ${s.name} [${s.category}, ${trust}]\n   ${s.description}\n   install: ${s.installCommand ?? `npx skillapt install ${s.name}`}`;
      });
      return text(lines.join("\n\n"));
    }
    if (name === "list_categories") {
      const cats = await client.getCategories();
      return text(cats.map((c) => `${c.id} (${c.count}): ${c.description}`).join("\n"));
    }
    if (name === "get_skill") {
      const skillName = String(args.name ?? "").trim();
      if (!skillName) return text("Provide a skill name.", true);
      const s = await client.getSkill(skillName);
      const ownership = s.claimStatus === "unclaimed" ? "unclaimed (indexed from a public repository)" : `published by ${s.owner?.handle ?? "unknown"}`;
      return text(
        [
          `${s.name}@${s.latestVersion}`,
          s.description,
          `category: ${s.category}`,
          `license: ${s.license}`,
          `ownership: ${ownership}`,
          s.sourceUrl ? `source: ${s.sourceUrl}` : "",
          `install: npx skillapt install ${s.name}`,
        ]
          .filter(Boolean)
          .join("\n")
      );
    }
    return text(`Unknown tool: ${name}`, true);
  } catch (err) {
    return text(err instanceof Error ? err.message : String(err), true);
  }
}

/** Handle one JSON-RPC message; returns the response, or null for notifications. */
export async function handleMessage(
  msg: JsonRpcRequest,
  client: Pick<RegistryClient, "searchSkills" | "getCategories" | "getSkill">
): Promise<Record<string, unknown> | null> {
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id ?? null, result });
  const error = (code: number, message: string) => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });

  if (msg.id === undefined) return null; // notification, e.g. notifications/initialized
  switch (msg.method) {
    case "initialize":
      return reply({
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "skillapt", version: "1.0.0" },
        instructions:
          "Use search_skills to find an agent skill for a task, then run the returned install command in a shell.",
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: MCP_TOOLS });
    case "tools/call": {
      const params = msg.params ?? {};
      return reply(await callTool(client, String(params.name ?? ""), (params.arguments as Record<string, unknown>) ?? {}));
    }
    default:
      return error(-32601, `Method not found: ${msg.method}`);
  }
}

export async function mcpCommand(): Promise<void> {
  const client = new RegistryClient();
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let response: Record<string, unknown> | null;
    try {
      response = await handleMessage(JSON.parse(line) as JsonRpcRequest, client);
    } catch {
      response = { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } };
    }
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}
