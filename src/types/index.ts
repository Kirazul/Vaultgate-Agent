// ============================================================
// Shared domain + protocol types (used by client and server).
// Keep this file free of any runtime imports so it can be
// imported from anywhere without pulling in Node or browser code.
// ============================================================

export type Role = "user" | "assistant" | "system" | "tool";

/**
 * Operating modes. The mode orchestrator (src/lib/modes.ts + the prompt
 * assembler) is driven entirely by this union — adding a mode is data, not
 * scattered conditionals.
 *  - "agent": full autonomous builder and operator workflow.
 *  - "code":  VaultGate Code — precise, repo-focused software-engineering agent.
 *  - "chat":  plain conversational assistant, tools used sparingly.
 */
export type ChatMode = "agent" | "code" | "chat";

export type MessageStatus = "streaming" | "complete" | "error" | "cancelled";

// ── Tool calling (used from Phase 2 onward, defined now so the
//    content-block model is stable) ──────────────────────────
export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string of arguments (may be partial while streaming). */
  arguments: string;
  startedAt?: number;
}

export interface ToolResult {
  toolCallId: string;
  status: "running" | "completed" | "error";
  content: string;
  durationMs?: number;
}

export type ContentBlockType = "text" | "reasoning" | "tool_calls";

/**
 * A message body is an ordered list of blocks. Text and reasoning
 * carry markdown in `content`; tool blocks carry calls + results.
 */
export interface ContentBlock {
  type: ContentBlockType;
  content: string;
  /** Epoch ms when this block started accumulating (for live timers). */
  startedAt?: number;
  durationMs?: number;
  toolCalls?: ToolCall[];
  results?: ToolResult[];
}

export interface Message {
  id: string;
  chatId: string;
  role: Role;
  /** Flattened plain-text answer (for copy, persistence, titles). */
  content: string;
  blocks: ContentBlock[];
  status: MessageStatus;
  model?: string;
  createdAt: number;
  durationMs?: number;
}

export interface QueuedMessage {
  id: string;
  chatId: string;
  content: string;
  createdAt: number;
}

// ── Projects (folder-based workspaces) ──────────────────────
export interface Project {
  id: string;
  name: string;
  /** Absolute path to the project folder on disk. */
  path: string;
  createdAt: number;
  updatedAt: number;
}

export interface Chat {
  id: string;
  title: string;
  model: string;
  parentId?: string;
  type?: string;
  /** Project this chat belongs to (null for legacy unassigned chats). */
  projectId?: string;
  /** Locked workspace path for chats that were started from a project folder. */
  workspacePath?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChatWithMessages extends Chat {
  messages: Message[];
}

// ── Provider settings ───────────────────────────────────────
/** Legacy single-provider view (still used by the chat model selector). */
export interface ProviderSettings {
  endpoint: string;
  /** Whether an API key is stored server-side (the key itself is never sent to the client). */
  keySet: boolean;
  model: string;
}

/** A capability a model can be assigned to. `chat` is the main agent model. */
export type Capability = "chat" | "vision" | "image";

export const CAPABILITIES: Capability[] = ["chat", "vision", "image"];

/** One OpenAI-compatible endpoint. The API key never leaves the server — the
 * client only learns whether one is set (`keySet`). */
export interface ProviderSummary {
  id: string;
  name: string;
  endpoint: string;
  keySet: boolean;
  /** Models discovered/cached for this provider (for the picker). */
  models: string[];
  /** Optional model metadata from the public model catalog. */
  modelInfo?: Record<string, ModelInfoSummary>;
}

export interface ModelInfoSummary {
  id: string;
  name: string;
  family?: string;
  status: "alpha" | "beta" | "deprecated" | "active";
  limit: {
    context: number;
    input?: number;
    output: number;
  };
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  capabilities: {
    tools: boolean;
    reasoning: boolean;
    attachment: boolean;
    temperature: boolean;
    input: string[];
    output: string[];
  };
}

/** Which (provider, model) fulfills a capability. */
export interface RoleAssignment {
  providerId: string;
  model: string;
}

/** The full provider registry as sent to the client (keys masked). */
export interface ProvidersSettings {
  providers: ProviderSummary[];
  roles: Partial<Record<Capability, RoleAssignment>>;
}

// ── Features registry (Inventory → Features tab) ──────────
export type FeatureCategory =
  | "browser"
  | "desktop"
  | "code"
  | "research"
  | "planning"
  | "agents"
  | "multimodal"
  | "control";

export interface Feature {
  id: string;
  name: string;
  description: string;
  category: FeatureCategory;
  icon: string;
  modes: ChatMode[];
  status: "active" | "available" | "unavailable";
}

export interface ChatFeatures {
  deepThink: boolean;
  webSearch: boolean;
  /** Let the agent proactively recover from routine build/config/runtime failures. */
  autoImprove: boolean;
  /** Code mode: require an approved implementation plan before writing code. */
  planFirst: boolean;
}

// ── Execution approval policy ────────────────────────────────
export type PermissionMode = "auto-safe" | "ask" | "auto-approve" | "read-only";

export interface ApprovalSettings {
  /**
   * auto-safe: allow ordinary local work, ask for high-risk actions.
   * ask: ask before every mutating/external action.
   * auto-approve: run everything except hard-blocked catastrophic actions.
   * read-only: block writes, shell mutations, UI actions, and external effects.
   */
  mode: PermissionMode;
  /** Ask before unknown MCP tools unless they clearly look read-only. */
  askForUnknownMcp: boolean;
  /** Ask before visible desktop/browser actions that may affect outside state. */
  askForExternalActions: boolean;
  /** Always block catastrophic commands even in auto-approve mode. */
  hardBlockDangerous: boolean;
}

// ── Interactive clarifying questions (AskUserQuestion tool) ──
export interface QuestionOption {
  label: string;
  description?: string;
}

export interface PendingQuestion {
  chatId: string;
  id: string;
  question: string;
  header?: string;
  options: QuestionOption[];
}

// ── Implementation plan approval (Plan tool, Code mode) ──────
export interface PendingPlan {
  chatId: string;
  id: string;
  title: string;
  /** The plan body as markdown, rendered as an approval card in chat. */
  plan: string;
  /** Workspace-relative path of the saved plan file, if written. */
  file?: string;
}

// ── Token usage tracking ────────────────────────────────────
export interface UsageData {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens: number;
  cost?: number;
  /**
   * How full the model's context window is RIGHT NOW — the prompt size of the
   * most recent LLM request (input + cached input). Unlike `totalTokens`, this
   * is NOT summed across the turn's tool round-trips, so it maps directly onto
   * the model's context limit for an honest "X% full" reading.
   */
  contextTokens?: number;
}

// ── SSE protocol (server → client) ──────────────────────────
// A single, explicit event union. The server emits these as
// `data: <json>\n\n` frames; `[DONE]` terminates the stream.
export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_call"; id: string; name: string; arguments: string }
  | { type: "tool_result"; id: string; status: ToolResult["status"]; content: string }
  | { type: "question"; id: string; question: string; header?: string; options: QuestionOption[] }
  | { type: "plan"; id: string; title: string; plan: string; file?: string }
  | { type: "terminal"; id?: string; chunk: string }
  | { type: "retry"; attempt: number; maxAttempts: number; delaySeconds: number; message: string }
  | { type: "usage"; usage: UsageData }
  | { type: "title"; title: string }
  | { type: "mode"; mode: ChatMode }
  | { type: "error"; message: string }
  | { type: "done" };

// ── Chat request (client → server) ──────────────────────────
export interface AgentParams {
  temperature?: number;
  maxIterations?: number;
  subAgentMaxIterations?: number;
  maxContextChars?: number;
  maxContextTokens?: number;
  providerRetryCount?: number;
  providerRetryDelayMs?: number;
}

export interface ChatRequest {
  chatId: string;
  messages: Array<{ role: Role; content: string }>;
  model: string;
  features?: Partial<ChatFeatures>;
  mode?: ChatMode;
  /** When true (Auto), the model may SwitchMode freely; when false, the mode is locked. */
  auto?: boolean;
  /** Project ID for workspace context. */
  projectId?: string;
  /** Agent tuning parameters from Settings. */
  agentParams?: AgentParams;
  /** Runtime approval policy from Settings. */
  approval?: ApprovalSettings;
}
