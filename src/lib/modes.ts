import { Bot, Terminal, MessageCircle, type LucideIcon } from "lucide-react";
import type { ChatMode } from "@/types";

/**
 * Mode orchestrator — single source of truth for every mode.
 *
 * The composer switcher, the transformation overlay, per-mode theming, and
 * (by id) the server prompt assembler all read from here. Adding a new mode is
 * a single entry in MODES + MODE_ORDER — no hardcoded conditionals to chase.
 */
export interface ModeDef {
  id: ChatMode;
  /** Full product name. */
  label: string;
  /** Compact label for the switcher pill. */
  short: string;
  /** One-line description shown in menus/tooltips. */
  description: string;
  /** Subtitle flashed during the transformation overlay. */
  tagline: string;
  icon: LucideIcon;
  /** Accent hex — also drives the transition glow. Mirrors the CSS [data-mode] accent. */
  accent: string;
}

export const MODES: Record<ChatMode, ModeDef> = {
  agent: {
    id: "agent",
    label: "Agent",
    short: "Agent",
    description: "Autonomous builder — plans, runs tools, and ships full projects.",
    tagline: "Autonomous build agent",
    icon: Bot,
    accent: "#007acc",
  },
  code: {
    id: "code",
    label: "VaultGate Code",
    short: "Code",
    description: "Precise software engineering — works in your codebase with surgical edits.",
    tagline: "Precision engineering mode",
    icon: Terminal,
    accent: "#d97757",
  },
  chat: {
    id: "chat",
    label: "Chat",
    short: "Chat",
    description: "Direct conversation — answers and reasoning, tools only when asked.",
    tagline: "Conversational assistant",
    icon: MessageCircle,
    accent: "#8b5cf6",
  },
};

export const MODE_ORDER: ChatMode[] = ["agent", "code", "chat"];
export const DEFAULT_MODE: ChatMode = "chat";

export function isChatMode(value: unknown): value is ChatMode {
  return value === "agent" || value === "code" || value === "chat";
}

export function modeDef(mode: ChatMode): ModeDef {
  return MODES[mode] ?? MODES[DEFAULT_MODE];
}
