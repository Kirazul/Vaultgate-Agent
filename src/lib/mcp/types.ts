// MCP type definitions — matches the Model Context Protocol spec.
// Covers stdio and streamable-HTTP server types.

export type McpTransport = "stdio" | "sse" | "http";

export interface McpStdioServerConfig {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpHttpServerConfig {
  type: "sse" | "http";
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;

export interface McpServerEntry {
  name: string;
  config: McpServerConfig;
  enabled: boolean;
}

export type McpServerStatus = "connected" | "connecting" | "failed" | "disabled";

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  serverName: string;
}

export interface McpResourceDef {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  serverName: string;
}

export interface McpServerState {
  name: string;
  status: McpServerStatus;
  config: McpServerConfig;
  tools: McpToolDef[];
  resources: McpResourceDef[];
  error?: string;
}

export interface McpConfigFile {
  mcpServers: Record<string, McpServerConfig & { enabled?: boolean }>;
}
