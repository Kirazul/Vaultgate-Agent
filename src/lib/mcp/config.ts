// MCP server configuration persistence (server-only).
// Stores MCP server configs in SQLite settings table.
// Uses our DB instead of a JSON file.
import "server-only";
import { get, run } from "@/lib/db/client";
import type { McpServerConfig, McpServerEntry } from "./types";

const SETTINGS_KEY = "mcp_servers";

export async function getMcpServers(): Promise<McpServerEntry[]> {
  const row = await get<{ value: string }>("SELECT value FROM settings WHERE key = ?", [SETTINGS_KEY]);
  if (!row?.value) return [];
  try {
    const parsed = JSON.parse(row.value) as McpServerEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveMcpServers(servers: McpServerEntry[]): Promise<void> {
  await run(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [SETTINGS_KEY, JSON.stringify(servers)],
  );
}

export async function addMcpServer(name: string, config: McpServerConfig, enabled = true): Promise<McpServerEntry[]> {
  if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error("Invalid server name. Use only letters, numbers, hyphens, and underscores.");
  }
  const servers = await getMcpServers();
  if (servers.some((s) => s.name === name)) {
    throw new Error(`MCP server "${name}" already exists.`);
  }
  servers.push({ name, config, enabled });
  await saveMcpServers(servers);
  return servers;
}

export async function removeMcpServer(name: string): Promise<McpServerEntry[]> {
  const servers = await getMcpServers();
  const filtered = servers.filter((s) => s.name !== name);
  if (filtered.length === servers.length) throw new Error(`MCP server "${name}" not found.`);
  await saveMcpServers(filtered);
  return filtered;
}

export async function toggleMcpServer(name: string, enabled: boolean): Promise<McpServerEntry[]> {
  const servers = await getMcpServers();
  const server = servers.find((s) => s.name === name);
  if (!server) throw new Error(`MCP server "${name}" not found.`);
  server.enabled = enabled;
  await saveMcpServers(servers);
  return servers;
}

export async function updateMcpServer(name: string, config: McpServerConfig): Promise<McpServerEntry[]> {
  const servers = await getMcpServers();
  const server = servers.find((s) => s.name === name);
  if (!server) throw new Error(`MCP server "${name}" not found.`);
  server.config = config;
  await saveMcpServers(servers);
  return servers;
}
