// MCP client manager (server-only).
// Spawns/connects MCP servers, discovers tools/resources, executes tool calls.
// Uses memoized connections, tool wrapping, and auto-reconnect.
import "server-only";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getMcpServers } from "./config";
import type {
  McpServerConfig,
  McpServerEntry,
  McpServerState,
  McpToolDef,
  McpResourceDef,
} from "./types";

interface ActiveConnection {
  client: Client;
  transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport;
  state: McpServerState;
  cleanup: () => Promise<void>;
}

const connections = new Map<string, ActiveConnection>();

function buildMcpToolName(serverName: string, toolName: string): string {
  return `mcp__${serverName}__${toolName}`;
}

export function parseMcpToolName(fullName: string): { serverName: string; toolName: string } | null {
  const match = fullName.match(/^mcp__([^_]+(?:__[^_]+)*)__([^_]+(?:__[^_]+)*)$/);
  if (!match) {
    const parts = fullName.replace(/^mcp__/, "").split("__");
    if (parts.length >= 2) return { serverName: parts[0], toolName: parts.slice(1).join("__") };
    return null;
  }
  return { serverName: match[1], toolName: match[2] };
}

async function createTransport(config: McpServerConfig) {
  const type = config.type ?? "stdio";

  if (type === "stdio") {
    const stdio = config as { command: string; args?: string[]; env?: Record<string, string> };
    return new StdioClientTransport({
      command: stdio.command,
      args: stdio.args ?? [],
      env: { ...process.env, ...(stdio.env ?? {}) } as Record<string, string>,
    });
  }

  if (type === "sse") {
    const remote = config as { url: string; headers?: Record<string, string> };
    return new SSEClientTransport(new URL(remote.url));
  }

  if (type === "http") {
    const remote = config as { url: string; headers?: Record<string, string> };
    return new StreamableHTTPClientTransport(new URL(remote.url));
  }

  throw new Error(`Unsupported MCP transport: ${type}`);
}

async function connectServer(entry: McpServerEntry): Promise<ActiveConnection> {
  const state: McpServerState = {
    name: entry.name,
    status: "connecting",
    config: entry.config,
    tools: [],
    resources: [],
  };

  const transport = await createTransport(entry.config);
  const client = new Client({ name: "vaultgate", version: "1.0.0" }, { capabilities: {} });

  try {
    await client.connect(transport);
    state.status = "connected";
  } catch (err) {
    state.status = "failed";
    const msg = err instanceof Error ? err.message : String(err);
    const type = entry.config.type ?? "stdio";
    const hint = type === "stdio"
      ? ` Check that "${(entry.config as { command: string }).command}" is installed and on PATH.`
      : ` Check that the server at "${(entry.config as { url: string }).url}" is running and reachable.`;
    state.error = `${msg}${hint}`;
    return { client, transport, state, cleanup: () => client.close() };
  }

  // Discover tools
  try {
    const toolsResult = await client.listTools();
    state.tools = (toolsResult.tools ?? []).map((t) => ({
      name: buildMcpToolName(entry.name, t.name),
      description: t.description ?? "",
      inputSchema: t.inputSchema as Record<string, unknown> | undefined,
      serverName: entry.name,
    }));
  } catch { /* server may not support tools */ }

  // Discover resources
  try {
    const resourcesResult = await client.listResources();
    state.resources = (resourcesResult.resources ?? []).map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
      serverName: entry.name,
    }));
  } catch { /* server may not support resources */ }

  return {
    client,
    transport,
    state,
    cleanup: async () => {
      try { await client.close(); } catch { /* ignore */ }
    },
  };
}

export async function connectAllServers(): Promise<McpServerState[]> {
  const entries = await getMcpServers();
  const results: McpServerState[] = [];

  for (const entry of entries) {
    if (!entry.enabled) {
      results.push({
        name: entry.name,
        status: "disabled",
        config: entry.config,
        tools: [],
        resources: [],
      });
      continue;
    }

    // Reuse existing healthy connection
    const existing = connections.get(entry.name);
    if (existing && existing.state.status === "connected") {
      results.push(existing.state);
      continue;
    }

    try {
      const conn = await connectServer(entry);
      connections.set(entry.name, conn);
      results.push(conn.state);
    } catch (err) {
      results.push({
        name: entry.name,
        status: "failed",
        config: entry.config,
        tools: [],
        resources: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

export async function disconnectServer(name: string): Promise<void> {
  const conn = connections.get(name);
  if (conn) {
    await conn.cleanup();
    connections.delete(name);
  }
}

export async function disconnectAll(): Promise<void> {
  for (const [name, conn] of connections) {
    await conn.cleanup();
    connections.delete(name);
  }
}

export async function reconnectServer(name: string): Promise<McpServerState> {
  await disconnectServer(name);
  const entries = await getMcpServers();
  const entry = entries.find((e) => e.name === name);
  if (!entry) throw new Error(`MCP server "${name}" not found.`);
  if (!entry.enabled) return { name, status: "disabled", config: entry.config, tools: [], resources: [] };
  const conn = await connectServer(entry);
  connections.set(name, conn);
  return conn.state;
}

export function getServerStates(): McpServerState[] {
  return Array.from(connections.values()).map((c) => c.state);
}

export function getAllMcpTools(): McpToolDef[] {
  const tools: McpToolDef[] = [];
  for (const conn of connections.values()) {
    if (conn.state.status === "connected") tools.push(...conn.state.tools);
  }
  return tools;
}

export function getAllMcpResources(): McpResourceDef[] {
  const resources: McpResourceDef[] = [];
  for (const conn of connections.values()) {
    if (conn.state.status === "connected") resources.push(...conn.state.resources);
  }
  return resources;
}

export async function callMcpTool(
  fullToolName: string,
  args: Record<string, unknown>,
): Promise<{ content: string; isError?: boolean }> {
  const parsed = parseMcpToolName(fullToolName);
  if (!parsed) return { content: `Unknown MCP tool: ${fullToolName}`, isError: true };

  const conn = connections.get(parsed.serverName);
  if (!conn || conn.state.status !== "connected") {
    return { content: `MCP server "${parsed.serverName}" is not connected.`, isError: true };
  }

  try {
    const result = await conn.client.callTool({ name: parsed.toolName, arguments: args });
    const textParts = (result.content as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text!);
    return {
      content: textParts.join("\n") || JSON.stringify(result.content),
      isError: result.isError === true,
    };
  } catch (err) {
    return {
      content: `MCP tool call failed: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    };
  }
}

export async function readMcpResource(
  serverName: string,
  uri: string,
): Promise<{ content: string; mimeType?: string }> {
  const conn = connections.get(serverName);
  if (!conn || conn.state.status !== "connected") {
    throw new Error(`MCP server "${serverName}" is not connected.`);
  }

  const result = await conn.client.readResource({ uri });
  const contents = result.contents ?? [];
  const text = contents.map((c) => ("text" in c ? c.text : `[binary: ${c.uri}]`)).join("\n");
  return { content: text, mimeType: contents[0]?.mimeType };
}
