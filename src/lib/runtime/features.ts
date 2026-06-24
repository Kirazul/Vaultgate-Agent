import "server-only";
import type { ChatMode, Feature, FeatureCategory } from "@/types";
import { AGENT_TOOLS, MODE_TOOLNAMES } from "@/lib/ai/tools/definitions";

interface ToolMeta {
  name: string;
  displayName: string;
  category: FeatureCategory;
  icon: string;
}

const TOOL_META: Record<string, ToolMeta> = {
  Open:            { name: "Open",            displayName: "Browser Control",       category: "browser",    icon: "globe" },
  Desktop:         { name: "Desktop",         displayName: "Desktop Control",       category: "desktop",    icon: "monitor" },
  Bash:            { name: "Bash",            displayName: "Terminal",              category: "code",       icon: "terminal" },
  BashOutput:      { name: "BashOutput",      displayName: "Background Output",     category: "code",       icon: "terminal" },
  ListProcesses:   { name: "ListProcesses",   displayName: "Process Manager",       category: "code",       icon: "activity" },
  Read:            { name: "Read",            displayName: "File Reader",           category: "code",       icon: "file-text" },
  Write:           { name: "Write",           displayName: "File Writer",           category: "code",       icon: "file-plus" },
  Edit:            { name: "Edit",            displayName: "File Editor",           category: "code",       icon: "pencil" },
  MultiEdit:       { name: "MultiEdit",       displayName: "Multi-File Editor",     category: "code",       icon: "pencil" },
  ApplyPatch:      { name: "ApplyPatch",      displayName: "Patch Applicator",      category: "code",       icon: "git-merge" },
  Delete:          { name: "Delete",          displayName: "File Delete",           category: "code",       icon: "trash-2" },
  Move:            { name: "Move",            displayName: "File Move/Rename",      category: "code",       icon: "move" },
  Glob:            { name: "Glob",            displayName: "File Search",           category: "code",       icon: "search" },
  Grep:            { name: "Grep",            displayName: "Content Search",        category: "code",       icon: "search" },
  LS:              { name: "LS",              displayName: "Directory Listing",      category: "code",       icon: "folder" },
  WebSearch:       { name: "WebSearch",       displayName: "Web Search",            category: "research",   icon: "search" },
  WebFetch:        { name: "WebFetch",        displayName: "Web Fetch",             category: "research",   icon: "download" },
  XSearch:         { name: "XSearch",         displayName: "X / Twitter Search",    category: "research",   icon: "at-sign" },
  RecallSessions:  { name: "RecallSessions",  displayName: "Session Memory",        category: "research",   icon: "history" },
  TodoWrite:       { name: "TodoWrite",       displayName: "Task List",             category: "planning",   icon: "check-square" },
  Kanban:          { name: "Kanban",          displayName: "Kanban Board",          category: "planning",   icon: "columns" },
  Plan:            { name: "Plan",            displayName: "Implementation Plan",   category: "planning",   icon: "clipboard" },
  Task:            { name: "Task",            displayName: "Sub-Agents",            category: "agents",     icon: "users" },
  Skill:           { name: "Skill",           displayName: "Skills Loader",         category: "agents",     icon: "puzzle" },
  MultiModel:      { name: "MultiModel",      displayName: "Multi-Model Consensus", category: "agents",     icon: "layers" },
  Schedule:        { name: "Schedule",        displayName: "Task Scheduler",        category: "agents",     icon: "clock" },
  Vision:          { name: "Vision",          displayName: "Vision Analysis",       category: "multimodal", icon: "eye" },
  ImageGenerate:   { name: "ImageGenerate",   displayName: "Image Generation",      category: "multimodal", icon: "image" },
  ImageEdit:       { name: "ImageEdit",       displayName: "Image Editing",         category: "multimodal", icon: "image" },
  Transcribe:      { name: "Transcribe",      displayName: "Speech-to-Text",        category: "multimodal", icon: "mic" },
  SwitchMode:      { name: "SwitchMode",      displayName: "Mode Switcher",         category: "control",    icon: "toggle-left" },
  AskUserQuestion: { name: "AskUserQuestion", displayName: "Ask User",              category: "control",    icon: "help-circle" },
};

const CATEGORY_LABELS: Record<FeatureCategory, string> = {
  browser:    "Browser Control",
  desktop:    "Desktop Control",
  code:       "Code & File Operations",
  research:   "Research & Web",
  planning:   "Planning & Tracking",
  agents:     "Agents & Delegation",
  multimodal: "Multimodal",
  control:    "Flow Control",
};

const modeSets: Record<string, Set<string>> = {};
for (const [mode, names] of Object.entries(MODE_TOOLNAMES)) {
  modeSets[mode] = new Set(names);
}

function modesForTool(toolName: string): ChatMode[] {
  const modes: ChatMode[] = [];
  for (const mode of ["agent", "code", "chat"] as ChatMode[]) {
    if (modeSets[mode]?.has(toolName)) modes.push(mode);
  }
  return modes;
}

function firstSentence(text: string): string {
  const match = text.match(/^(.+?\.)\s/);
  return match ? match[1] : text.slice(0, 120);
}

export function listFeatures(mode?: ChatMode): Feature[] {
  const activeSet = mode ? modeSets[mode] : undefined;
  const allToolNames = AGENT_TOOLS.map((t) => t.function.name);

  return allToolNames.map((toolName) => {
    const meta = TOOL_META[toolName];
    const toolDef = AGENT_TOOLS.find((t) => t.function.name === toolName);
    const desc = toolDef ? firstSentence(toolDef.function.description) : "";
    const modes = modesForTool(toolName);

    let status: Feature["status"] = "available";
    if (activeSet) {
      status = activeSet.has(toolName) ? "active" : modes.length > 0 ? "available" : "unavailable";
    }

    return {
      id: toolName,
      name: meta?.displayName ?? toolName,
      description: desc,
      category: meta?.category ?? "control",
      icon: meta?.icon ?? "box",
      modes,
      status,
    };
  });
}

export function featureInventoryText(mode: ChatMode): string {
  const features = listFeatures(mode).filter((f) => f.status === "active");

  const grouped = new Map<FeatureCategory, Feature[]>();
  for (const f of features) {
    const list = grouped.get(f.category) ?? [];
    list.push(f);
    grouped.set(f.category, list);
  }

  const lines: string[] = [];
  for (const [cat, items] of grouped) {
    const label = CATEGORY_LABELS[cat] ?? cat;
    const toolNames = items.map((i) => i.id).join(", ");
    const desc = items.length === 1 ? items[0].description : `${items.length} tools`;
    lines.push(`- ${label} (${toolNames}): ${desc}`);
  }

  return lines.length ? lines.join("\n") : "(no features available in this mode)";
}

export { CATEGORY_LABELS };
