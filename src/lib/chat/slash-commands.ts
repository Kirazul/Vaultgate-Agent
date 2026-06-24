export type SlashCommandCategory = "Flow" | "Workspace" | "Session" | "Settings" | "Info";

export interface SlashCommandDef {
  name: string;
  aliases?: string[];
  category: SlashCommandCategory;
  description: string;
  argumentHint?: string;
}

export interface ParsedSlashCommand {
  raw: string;
  name: string;
  arg: string;
  command: SlashCommandDef | null;
}

export const SLASH_COMMANDS: SlashCommandDef[] = [
  { name: "btw", category: "Flow", argumentHint: "<question>", description: "Ask a side question without interrupting the main run." },
  { name: "background", aliases: ["bg"], category: "Flow", argumentHint: "<prompt>", description: "Run a prompt in a background sub-agent." },
  { name: "queue", aliases: ["q"], category: "Flow", argumentHint: "<prompt>", description: "Queue a prompt after the current turn." },
  { name: "steer", category: "Flow", argumentHint: "<note>", description: "Inject a mid-run steering note after the next tool result." },
  { name: "retry", category: "Flow", description: "Retry the last assistant response from its user prompt." },
  { name: "plan", category: "Flow", argumentHint: "<goal>", description: "Force a plan-first request for this task." },
  { name: "rewind", aliases: ["checkpoint"], category: "Workspace", argumentHint: "[number]", description: "List or restore prior conversation/workspace checkpoints." },
  { name: "status", category: "Session", description: "Show local chat status, queue, mode, and recent activity." },
  { name: "title", category: "Session", argumentHint: "<name>", description: "Rename the current chat." },
  { name: "copy", category: "Session", argumentHint: "[number]", description: "Copy the latest assistant answer, or the Nth latest." },
  { name: "clear-queue", category: "Session", description: "Remove all queued follow-up prompts." },
  { name: "stop", category: "Session", description: "Stop the current turn without clearing queued prompts." },
  { name: "mode", category: "Settings", argumentHint: "agent|code|chat|auto", description: "Switch chat mode or re-enable Auto mode." },
  { name: "think", category: "Settings", argumentHint: "on|off|status", description: "Toggle Deep Think for future turns." },
  { name: "permissions", aliases: ["approval"], category: "Settings", argumentHint: "auto-safe|ask|auto-approve|read-only|status", description: "Set or inspect tool approval behavior." },
  { name: "compact", category: "Session", description: "Trigger context compaction for the next agent turn." },
  { name: "stats", category: "Info", description: "Show session statistics (messages, tools, files, time)." },
  { name: "export", category: "Session", description: "Copy the full conversation as markdown to clipboard." },
  { name: "doctor", category: "Info", description: "Run diagnostics on provider connection, workspace, and settings." },
  { name: "settings", aliases: ["config"], category: "Settings", description: "Open the Settings dialog." },
  { name: "inventory", category: "Settings", description: "Open the Inventory dialog (features, skills, MCP)." },
  { name: "help", aliases: ["commands"], category: "Info", description: "Show available slash commands." },
];

export function parseSlashCommand(input: string): ParsedSlashCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  const match = /^\/([A-Za-z0-9_-]+)(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (!match) return null;
  const name = match[1].toLowerCase();
  return { raw: trimmed, name, arg: (match[2] ?? "").trim(), command: findSlashCommand(name) };
}

export function findSlashCommand(nameOrAlias: string): SlashCommandDef | null {
  const key = nameOrAlias.toLowerCase();
  return SLASH_COMMANDS.find((command) => command.name === key || command.aliases?.includes(key)) ?? null;
}

export function slashCommandSuggestions(query: string, limit = 12): SlashCommandDef[] {
  const q = query.toLowerCase().replace(/^\//, "");
  const scored = SLASH_COMMANDS.map((command, index) => ({ command, index, score: slashScore(command, q) })).filter((item) => item.score > 0);
  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((item) => item.command);
}

export function formatSlashCommand(command: SlashCommandDef): string {
  return `/${command.name}${command.argumentHint ? ` ${command.argumentHint}` : ""}`;
}

export function formatSlashHelp(): string {
  const categories: SlashCommandCategory[] = ["Flow", "Workspace", "Session", "Settings", "Info"];
  const lines = ["VaultGate slash commands", ""];
  for (const category of categories) {
    const commands = SLASH_COMMANDS.filter((command) => command.category === category);
    if (commands.length === 0) continue;
    lines.push(`**${category}**`);
    for (const command of commands) {
      const alias = command.aliases?.length ? ` (${command.aliases.map((item) => `/${item}`).join(", ")})` : "";
      lines.push(`- \`${formatSlashCommand(command)}\`${alias} - ${command.description}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

function slashScore(command: SlashCommandDef, query: string): number {
  if (!query) return 1;
  const names = [command.name, ...(command.aliases ?? [])];
  if (names.some((name) => name === query)) return 100;
  if (names.some((name) => name.startsWith(query))) return 80 - Math.min(query.length, 20);
  if (command.description.toLowerCase().includes(query)) return 30;
  if (names.some((name) => fuzzyIncludes(name, query))) return 20;
  return 0;
}

function fuzzyIncludes(value: string, query: string): boolean {
  let i = 0;
  for (const char of value.toLowerCase()) {
    if (char === query[i]) i++;
    if (i === query.length) return true;
  }
  return false;
}
