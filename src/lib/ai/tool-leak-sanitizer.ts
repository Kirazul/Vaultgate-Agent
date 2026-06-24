import type { ContentBlock, Message } from "@/types";

const TOOL_NAME = String.raw`(?:AskUserQuestion|RecallSessions|ListProcesses|ApplyPatch|MultiModel|BashOutput|SwitchMode|MultiEdit|WebSearch|WebFetch|TodoWrite|Schedule|XSearch|Desktop|Kanban|Delete|Write|Skill|Task|Move|Read|Edit|Glob|Grep|Open|Bash|LS)`;
const TOOL_CALL_PREFIX = new RegExp(String.raw`^\s*(?:[-*]\s*)?(?:Tool\s+)?${TOOL_NAME}\s*(?:$|[({:=>])`, "i");
const TOOL_TRACE_LINE = new RegExp(String.raw`^\s*(?:[-*]\s*)?(?:(?:Tool|Function)\s+(?:call|result|output)?\s*[:#-]|(?:Tool\s+)?${TOOL_NAME}\s*(?:\(|\{|=>|:)\s*)`, "i");
const INLINE_TOOL_TRACE = new RegExp(String.raw`\s*(?:Tool\s+)?${TOOL_NAME}\s*(?:\([^\n]*?\)|\{[^\n]*?\})\s*=>.*$`, "i");
const ARTIFACT_PATH = /^(?:\[?[^\]]*\]?\()?((?:\.vaultgate\/)?(?:download|upload)\/(?:screenshots|agent-browser|[^\s)]+)\/\S+|workspace-file:[^\s)]+|[A-Za-z]:\\.*\\(?:\.vaultgate\\)?(?:download|upload)\\\S+)\)?$/i;

function isToolTraceLine(trimmed: string): boolean {
  if (!trimmed) return false;
  if (TOOL_TRACE_LINE.test(trimmed)) return true;
  if (TOOL_CALL_PREFIX.test(trimmed) && /(?:\{|\(|=>|\btool\b)/i.test(trimmed)) return true;
  if (/^```(?:json|tool|function|tools?)?\s*$/i.test(trimmed)) return false;
  return false;
}

function stripInlineToolTrace(line: string): string {
  if (!INLINE_TOOL_TRACE.test(line)) return line;
  return line.replace(INLINE_TOOL_TRACE, "").trimEnd();
}

export function sanitizeToolLeakText(text: string, options: { trim?: boolean } = {}): string {
  if (!text) return "";
  const trim = options.trim !== false;
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const kept: string[] = [];
  let skippedToolTrace = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (isToolTraceLine(trimmed)) {
      skippedToolTrace = true;
      continue;
    }
    if (skippedToolTrace && (trimmed === "" || ARTIFACT_PATH.test(trimmed))) continue;

    const stripped = stripInlineToolTrace(rawLine);
    if (!stripped.trim() && stripped !== rawLine) {
      skippedToolTrace = true;
      continue;
    }

    skippedToolTrace = false;
    kept.push(stripped);
  }

  const cleaned = kept.join("\n").replace(/\n{3,}/g, "\n\n");
  return trim ? cleaned.trim() : cleaned;
}

export function sanitizeToolLeakBlocks(blocks: ContentBlock[]): ContentBlock[] {
  return blocks
    .map((block) => (block.type === "text" ? { ...block, content: sanitizeToolLeakText(block.content) } : block))
    .filter((block) => block.type !== "text" || block.content.trim().length > 0);
}

export function sanitizeAssistantMessage(message: Message): Message {
  if (message.role !== "assistant") return message;
  return {
    ...message,
    content: sanitizeToolLeakText(message.content),
    blocks: sanitizeToolLeakBlocks(message.blocks),
  };
}

export function firstVisibleLine(text: string): string {
  return sanitizeToolLeakText(text)
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean)?.slice(0, 300) || "completed";
}
