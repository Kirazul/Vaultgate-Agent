// MCP server management API (server-only).
// CRUD for MCP servers, connection management, tool/resource discovery.
import { getMcpServers, addMcpServer, removeMcpServer, toggleMcpServer, updateMcpServer } from "@/lib/mcp/config";
import { connectAllServers, disconnectServer, reconnectServer, getServerStates, getAllMcpTools, getAllMcpResources, callMcpTool, readMcpResource } from "@/lib/mcp/client";
import type { McpServerConfig } from "@/lib/mcp/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

function error(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action");

  if (action === "servers") {
    const servers = await getMcpServers();
    return json({ servers });
  }

  if (action === "status") {
    const states = getServerStates();
    return json({ servers: states });
  }

  if (action === "tools") {
    const tools = getAllMcpTools();
    return json({ tools });
  }

  if (action === "resources") {
    const resources = getAllMcpResources();
    return json({ resources });
  }

  if (action === "connect") {
    const states = await connectAllServers();
    return json({ servers: states });
  }

  // Default: return config + live status
  const servers = await getMcpServers();
  const states = getServerStates();
  const tools = getAllMcpTools();
  return json({ servers, states, tools });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return error("Invalid JSON body.");
  }

  const action = body.action as string;

  if (action === "add") {
    const name = body.name as string;
    const config = body.config as McpServerConfig;
    if (!name || !config) return error("Missing name or config.");
    try {
      const servers = await addMcpServer(name, config, body.enabled !== false);
      return json({ servers });
    } catch (err) {
      return error(err instanceof Error ? err.message : String(err));
    }
  }

  if (action === "remove") {
    const name = body.name as string;
    if (!name) return error("Missing server name.");
    try {
      await disconnectServer(name);
      const servers = await removeMcpServer(name);
      return json({ servers });
    } catch (err) {
      return error(err instanceof Error ? err.message : String(err));
    }
  }

  if (action === "toggle") {
    const name = body.name as string;
    const enabled = body.enabled as boolean;
    if (!name || typeof enabled !== "boolean") return error("Missing name or enabled flag.");
    try {
      if (!enabled) await disconnectServer(name);
      const servers = await toggleMcpServer(name, enabled);
      return json({ servers });
    } catch (err) {
      return error(err instanceof Error ? err.message : String(err));
    }
  }

  if (action === "update") {
    const name = body.name as string;
    const config = body.config as McpServerConfig;
    if (!name || !config) return error("Missing name or config.");
    try {
      await disconnectServer(name);
      const servers = await updateMcpServer(name, config);
      return json({ servers });
    } catch (err) {
      return error(err instanceof Error ? err.message : String(err));
    }
  }

  if (action === "connect") {
    const states = await connectAllServers();
    return json({ servers: states });
  }

  if (action === "reconnect") {
    const name = body.name as string;
    if (!name) return error("Missing server name.");
    try {
      const state = await reconnectServer(name);
      return json({ server: state });
    } catch (err) {
      return error(err instanceof Error ? err.message : String(err));
    }
  }

  if (action === "call_tool") {
    const toolName = body.toolName as string;
    const args = (body.arguments ?? {}) as Record<string, unknown>;
    if (!toolName) return error("Missing toolName.");
    const result = await callMcpTool(toolName, args);
    return json(result);
  }

  if (action === "read_resource") {
    const serverName = body.serverName as string;
    const uri = body.uri as string;
    if (!serverName || !uri) return error("Missing serverName or uri.");
    try {
      const result = await readMcpResource(serverName, uri);
      return json(result);
    } catch (err) {
      return error(err instanceof Error ? err.message : String(err));
    }
  }

  return error(`Unknown action: ${action}`);
}
