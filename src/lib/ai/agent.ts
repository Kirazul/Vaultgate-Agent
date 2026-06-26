// ============================================================
// Agent loop (server-only). Iterative tool-calling over an
// OpenAI-compatible provider, emitting our StreamEvent protocol.
// Reasoning + answer deltas are forwarded in REAL TIME; tool
// calls are executed between turns and surfaced as cards.
// ============================================================
import "server-only";
import type { ApprovalSettings, ChatRequest, ChatMode, StreamEvent, ContentBlock, Message, ToolResult } from "@/types";
import { getProviderConfig } from "@/lib/config/settings";
import { deriveTitle } from "@/lib/utils";
import { AGENT_TOOLS, canonicalToolName, toolsForMode, isToolAllowed } from "./tools/definitions";
import { executeTool } from "./tools/execute";
import { buildSystemPrompt } from "./prompt";
import { upsertMessage } from "@/lib/db/repo";
import { sanitizeAssistantMessage, sanitizeToolLeakText } from "@/lib/ai/tool-leak-sanitizer";
import { drainTurnSteer } from "./turn-control";
import { connectAllServers, getAllMcpTools, callMcpTool } from "@/lib/mcp/client";
import type { McpToolDef } from "@/lib/mcp/types";
import { consumePermissionResponse, evaluateToolPermission, normalizeApprovalSettings, permissionQuestion } from "./permissions";
import { isPlanApprovalMessage, extractApprovedPlanPath, planImplementationDirective, isPlanRevisionMessage, planRevisionDirective } from "@/lib/chat/plan";

const DEFAULT_MAX_ITERATIONS = 128;
const DEFAULT_PROVIDER_RETRY_COUNT = Number(process.env.PROVIDER_RETRY_COUNT || 10);
const DEFAULT_PROVIDER_RETRY_DELAY_MS = Number(process.env.PROVIDER_RETRY_DELAY_MS || 5000);
const STREAM_KEEPALIVE_MS = Number(process.env.STREAM_KEEPALIVE_MS || 15000);
const SUB_AGENT_TIMEOUT_MS = Number(process.env.SUB_AGENT_TIMEOUT_MS || 15 * 60_000);
const encoder = new TextEncoder();

interface ProviderMessage {
  role: string;
  content: string;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export function streamAgent(req: ChatRequest): ReadableStream<Uint8Array> {
  const firstUser = req.messages.find((m) => m.role === "user")?.content ?? "";
  let abort: AbortController | null = null;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const keepAlive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`));
        } catch {
          clearInterval(keepAlive);
          closed = true;
        }
      }, Math.max(5000, STREAM_KEEPALIVE_MS));
      const emit = (event: StreamEvent) => {
        if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      const finish = () => {
        clearInterval(keepAlive);
        if (closed) return;
        closed = true;
        try {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const abortController = new AbortController();
      abort = abortController;

      void (async () => {
        const config = await getProviderConfig();
        if (!config.endpoint) {
          emit({ type: "error", message: "No API endpoint configured. Open Settings and add one." });
          return finish();
        }
        const model = req.model || config.model;
        if (!model) {
          emit({ type: "error", message: "No model selected. Fetch models in Settings and pick one." });
          return finish();
        }

        emit({ type: "title", title: deriveTitle(firstUser) });

        // Connect MCP servers and discover their tools.
        let mcpTools: McpToolDef[] = [];
        try {
          await connectAllServers();
          mcpTools = getAllMcpTools();
        } catch { /* MCP unavailable — continue without */ }

        // The active branch of the capability tree. In Auto mode the model can
        // move between branches via SwitchMode; when a mode is locked manually,
        // it stays put (SwitchMode withheld) and must tell the user if it can't.
        let currentMode: ChatMode = normalizeMode(req.mode);
        const canSwitch = req.auto === true;

        // Agent params from Settings (client → server via ChatRequest)
        const ap = req.agentParams ?? {};
        const approval = normalizeApprovalSettings(req.approval);
        const TEMPERATURE = ap.temperature ?? 1;
        const MAX_ITERS = ap.maxIterations ?? DEFAULT_MAX_ITERATIONS;
        const RETRY_COUNT = ap.providerRetryCount ?? DEFAULT_PROVIDER_RETRY_COUNT;
        const RETRY_DELAY = ap.providerRetryDelayMs ?? DEFAULT_PROVIDER_RETRY_DELAY_MS;
        const CTX_CHARS = ap.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS;
        const permissionResponse = consumePermissionResponse(req.chatId, req.messages.at(-1)?.content ?? "");
        const incomingMessages = req.messages.map((m, index) => {
          const isLast = index === req.messages.length - 1;
          let content = m.content;
          if (permissionResponse && isLast && m.role === "user") {
            content = permissionResponse.visibleText;
          } else if (isLast && m.role === "user" && isPlanApprovalMessage(m.content)) {
            // Plan-mode-exit attachment (Claude-Code parity): once the user
            // approves, the model's latest instruction must unambiguously put it
            // in implementation mode (so it never re-plans) and point straight at
            // the saved plan file (so it reads it in one shot, no searching).
            content = planImplementationDirective(extractApprovedPlanPath(m.content));
          } else if (isLast && m.role === "user" && isPlanRevisionMessage(m.content)) {
            // Mirror of the approval flow: the user-visible message stays short
            // ("Revise the plan.") and the verbose "redraft via the Plan tool,
            // don't implement yet" instruction is appended here for the model.
            const feedback = m.content.replace(/^revise the plan\.?\s*/i, "").trim();
            content = `${planRevisionDirective()}\n\nFeedback:\n${feedback}`;
          }
          return { role: m.role, content };
        });

        const messages: ProviderMessage[] = [
          { role: "system", content: buildSystemPrompt(req.chatId, req.features, currentMode, canSwitch) },
          ...incomingMessages,
        ];

        try {
          let answered = false;
          let emptyRetries = 0;
          const MAX_EMPTY_RETRIES = 3;

          for (let i = 0; i < MAX_ITERS; i++) {
            if (abortController.signal.aborted) break;

            await semanticCompact(messages, config.endpoint, config.apiKey, model, abortController.signal, CTX_CHARS);

            // Merge static tools with MCP-discovered tools (mcp__server__tool convention)
            const staticTools = toolsForMode(currentMode, canSwitch);
            const mcpToolDefs = mcpTools.map(mcpToolToOpenAI);
            const allTools = [...staticTools, ...mcpToolDefs];
            const turn = await callLLM(config.endpoint, config.apiKey, model, messages, emit, abortController.signal, "auto", allTools, { temperature: TEMPERATURE, retryCount: RETRY_COUNT, retryDelay: RETRY_DELAY });

            // Empty response recovery — multi-tier fallback:
            // If the model returns nothing (no text, no tools), nudge it.
            if (turn.toolCalls.length === 0 && !turn.content.trim()) {
              emptyRetries++;
              if (emptyRetries <= MAX_EMPTY_RETRIES) {
                messages.push({ role: "user", content: "Your response was empty. Continue working on the task — call tools or provide your answer." });
                continue;
              }
              emit({ type: "delta", text: "(The model returned an empty response after multiple attempts. Try sending your message again.)" });
              answered = true;
              break;
            }
            emptyRetries = 0;

            if (turn.toolCalls.length === 0) {
              if (!turn.streamedAnswer && turn.content) emit({ type: "delta", text: sanitizeToolLeakText(turn.content) });

              // Auto-continue if the model's output was
              // clearly truncated mid-sentence (hit max_tokens). The model
              // doesn't know it was cut off — we nudge it to resume.
              if (turn.content.length > 200 && !turn.content.trimEnd().match(/[.!?\n"'`)\]}]$/)) {
                messages.push({ role: "assistant", content: turn.content });
                messages.push({ role: "user", content: "Your response was cut off mid-sentence. Continue from where you left off." });
                continue;
              }

              answered = true;
              break;
            }

            // Record the assistant turn with its tool calls.
            messages.push({
              role: "assistant",
              content: turn.content,
              tool_calls: turn.toolCalls.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: t.arguments } })),
            });

            const calls = turn.toolCalls.map(prepareToolCall);
            for (const call of calls) {
              emit({ type: "tool_call", id: call.id, name: call.name, arguments: call.arguments });
            }
            if (calls.length > 0) await sleep(0, abortController.signal).catch(() => undefined);

            // Apply mode switches FIRST so any other calls this turn (and the
            // next turn) run under the new branch. Each SwitchMode call still
            // gets a tool result so the tool_call/result pairing stays valid.
            for (const call of calls) {
              if (canonicalToolName(call.name) !== "SwitchMode") continue;
              let resultText: string;
              if (!canSwitch) {
                resultText = `Mode is locked to ${currentMode} (Auto mode is off), so you cannot switch. If this task needs capabilities ${currentMode} lacks, tell the user plainly that you can't do it in ${currentMode} mode and that they can enable Auto mode or pick another mode — then stop. Do not attempt the blocked work.`;
              } else {
                const target = normalizeMode(String(call.parsed.mode || ""));
                if (target === currentMode) {
                  resultText = `Already in ${currentMode} mode — no switch needed. Continue with the available tools.`;
                } else {
                  currentMode = target;
                  messages[0] = { role: "system", content: buildSystemPrompt(req.chatId, req.features, currentMode, canSwitch) };
                  emit({ type: "mode", mode: currentMode });
                  resultText = `Switched to ${currentMode} mode. You now have ${currentMode} capabilities — continue the task with the now-available tools.`;
                }
              }
              emit({ type: "tool_result", id: call.id, status: "completed", content: resultText });
              messages.push({ role: "tool", content: resultText, tool_call_id: call.id });
            }

            const rest = calls.filter((c) => canonicalToolName(c.name) !== "SwitchMode");
            const toolResults = new Map<string, string>();
            for (const batch of toolExecutionBatches(rest)) {
              const results = await Promise.all(batch.map((call) => runGatedToolCall(call, currentMode, canSwitch, req.chatId, approval, req.agentParams, emit, abortController.signal)));
              let pausedForUser = false;
              for (const result of results) {
                messages.push({ role: "tool", content: result.content, tool_call_id: result.id });
                toolResults.set(result.id, result.content);
                if (result.paused) pausedForUser = true;
              }
              if (pausedForUser) {
                answered = true;
                break;
              }
              const steeringNotes = drainTurnSteer(req.chatId);
              if (steeringNotes.length > 0) {
                const note = steeringNotes.map((item, index) => `${index + 1}. ${item}`).join("\n");
                messages.push({ role: "user", content: `Mid-turn steering note from the user. Treat this as current intent and adjust the remaining work if it conflicts with earlier assumptions:\n${note}` });
                emit({ type: "reasoning", text: "User steering note received. Adjusting the current turn.\n" });
              }
            }
            if (answered) break;

            // If the agent presented an implementation plan, show it for approval
            // and end the turn — work resumes when the user approves.
            const plan = rest.find((c) => canonicalToolName(c.name) === "Plan" && String(c.parsed.plan || "").trim());
            if (plan) {
              emit(buildPlanEvent(plan, toolResults.get(plan.id)));
              answered = true;
              break;
            }

            // If the agent asked the user a question, present it and end the
            // turn — the user's selection arrives as their next message.
            const ask = rest.find((c) => canonicalToolName(c.name) === "AskUserQuestion");
            if (ask) {
              emit(buildQuestionEvent(ask));
              answered = true; // do not force a wrap-up; we are waiting on the user
              break;
            }
          }

          // Reached the step budget mid-work: force a tool-free wrap-up so the
          // user always gets a closing summary instead of a silent stop.
          if (!answered && !abortController.signal.aborted) {
            messages.push({
              role: "user",
              content:
                "You have used a large number of tool steps. If the task is essentially complete, summarize what you accomplished and how to verify it. If critical work remains unfinished, list exactly what's left so the user can continue with a follow-up message.",
            });
            const wrap = await callLLM(config.endpoint, config.apiKey, model, messages, emit, abortController.signal, "none");
            if (!wrap.streamedAnswer && wrap.content) emit({ type: "delta", text: sanitizeToolLeakText(wrap.content) });
          }
        } catch (err) {
          if (!abortController.signal.aborted) emit({ type: "error", message: err instanceof Error ? err.message : "Agent error" });
        }
        finish();
      })();
    },
    cancel() {
      abort?.abort();
    },
  });
}

interface TurnResult {
  content: string;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  streamedAnswer: boolean;
}

// ── Trajectory compaction ─────────────────────────────────────
// Long agentic turns accumulate many tool results; left unchecked they overflow
// the model's context window mid-task. We keep the
// system prompt and the most recent exchanges verbatim and elide the OLDEST,
// bulkiest tool outputs first (the model can re-run a tool if it needs detail).
const DEFAULT_MAX_CONTEXT_CHARS = Number(process.env.VAULTGATE_MAX_CONTEXT_CHARS || 180000);
const KEEP_RECENT_MESSAGES = 8;
const ELIDED_TOOL_HEAD = 400;

function conversationChars(messages: ProviderMessage[]): number {
  return messages.reduce((n, m) => n + (m.content ? m.content.length : 0), 0);
}

const SUMMARY_PREFIX = "[Summary of earlier tool results, condensed to save context]";
const FOLDED_STUB = "[folded into the earlier-results summary above]";

function elidableToolIndices(messages: ProviderMessage[]): number[] {
  const editableUntil = messages.length - KEEP_RECENT_MESSAGES;
  const idxs: number[] = [];
  for (let i = 1; i < editableUntil; i++) {
    const m = messages[i];
    if (
      m.role === "tool" &&
      m.content &&
      m.content.length > ELIDED_TOOL_HEAD + 120 &&
      !m.content.startsWith(SUMMARY_PREFIX) &&
      m.content !== FOLDED_STUB &&
      !m.content.includes("chars elided to stay within")
    ) {
      idxs.push(i);
    }
  }
  return idxs;
}

// Hard fallback: truncate the oldest bulky tool outputs (never throws, always
// gets the conversation under budget). Used when summarization isn't possible.
function compactConversation(messages: ProviderMessage[], maxChars = DEFAULT_MAX_CONTEXT_CHARS): void {
  let total = conversationChars(messages);
  if (total <= maxChars) return;
  for (const i of elidableToolIndices(messages)) {
    if (total <= maxChars) break;
    const m = messages[i];
    const original = m.content.length;
    m.content = `${m.content.slice(0, ELIDED_TOOL_HEAD)}\n… [${original} chars elided to stay within the context limit; re-run the tool if you need the full output.]`;
    total -= original - m.content.length;
  }
}

// Silent, non-streaming provider call (no client deltas) for internal summaries.
async function silentComplete(endpoint: string, apiKey: string, model: string, system: string, user: string, signal: AbortSignal): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(`${endpoint.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: user }], stream: false, temperature: 0.2 }),
  });
  if (!res.ok) throw new Error(`summary request failed: ${res.status}`);
  const json = (await res.json()) as Record<string, unknown>;
  const content = ((json.choices as Array<Record<string, unknown>>)?.[0]?.message as Record<string, unknown>)?.content;
  return typeof content === "string" ? content : "";
}

// Semantic compaction: replace the oldest bulky tool outputs with a dense
// model-written summary (preserving message structure so tool_call/result
// pairing stays valid). Always finishes with the truncation fallback so the
// conversation is guaranteed under budget even if summarization fails.
async function semanticCompact(messages: ProviderMessage[], endpoint: string, apiKey: string, model: string, signal: AbortSignal, maxChars = DEFAULT_MAX_CONTEXT_CHARS): Promise<void> {
  if (conversationChars(messages) <= maxChars) return;
  const idxs = elidableToolIndices(messages);
  if (idxs.length >= 2) {
    const blob = idxs.map((i) => messages[i].content).join("\n\n----\n\n").slice(0, 50000);
    try {
      const summary = await silentComplete(
        endpoint,
        apiKey,
        model,
        "You compress an AI agent's earlier tool outputs into a dense, factual summary. Preserve file paths, key results, commands run, errors, and decisions the agent will still need. Drop noise. Use terse bullet points; no preamble.",
        `Summarize these earlier tool results:\n\n${blob}`,
        signal,
      );
      if (summary.trim()) {
        messages[idxs[0]].content = `${SUMMARY_PREFIX}\n${summary.trim()}`;
        for (const i of idxs.slice(1)) messages[i].content = FOLDED_STUB;
      }
    } catch {
      /* summarization unavailable — truncation fallback below */
    }
  }
  compactConversation(messages, maxChars);
}

interface PreparedToolCall {
  id: string;
  name: string;
  arguments: string;
  parsed: Record<string, unknown>;
}

interface ToolExecutionResult {
  id: string;
  content: string;
  paused?: boolean;
}

type SubAgentRunStatus = "running" | "completed" | "error" | "cancelled" | "timeout";

interface SubAgentRun {
  id: string;
  parentChatId: string;
  title: string;
  type: SubAgentType;
  status: SubAgentRunStatus;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  result?: string;
  error?: string;
  abortController: AbortController;
}

const subAgentRuns = new Map<string, SubAgentRun>();

async function callLLM(
  endpoint: string,
  apiKey: string,
  model: string,
  messages: ProviderMessage[],
  emit: (e: StreamEvent) => void,
  signal: AbortSignal,
  toolChoice: "auto" | "none" = "auto",
  tools: Array<{ type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }> = AGENT_TOOLS,
  params: { temperature?: number; retryCount?: number; retryDelay?: number } = {},
): Promise<TurnResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const temperature = params.temperature ?? 1;
  const retryCount = params.retryCount ?? DEFAULT_PROVIDER_RETRY_COUNT;
  const retryDelay = params.retryDelay ?? DEFAULT_PROVIDER_RETRY_DELAY_MS;

  const body = JSON.stringify({
    model,
    messages,
    ...(toolChoice === "none" ? {} : { tools, tool_choice: "auto" }),
    stream: true,
    temperature,
  });

  let res: Response | null = null;
  for (let attempt = 1; attempt <= retryCount; attempt++) {
    try {
      res = await fetch(`${endpoint.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers,
        body,
        signal,
      });
    } catch (err) {
      if (signal.aborted || attempt === retryCount) throw err;
      emitRetry(emit, attempt, retryCount, retryDelay, "Provider connection failed. Retrying automatically.");
      await sleep(retryDelay, signal);
      continue;
    }

    if (res.ok) break;

    const text = await res.text().catch(() => "");
    if (isRetryableProviderResponse(res.status, text) && attempt < retryCount) {
      emitRetry(emit, attempt, retryCount, retryDelay, retryMessage(res.status, text));
      await sleep(retryDelay, signal);
      continue;
    }

    throw new Error(
      res.status === 401 || res.status === 403
        ? "Authentication failed — check your API key in Settings."
        : `Provider error ${res.status}: ${text.slice(0, 300)}`,
    );
  }

  if (!res?.ok) throw new Error("Provider retry attempts exhausted.");

  const ct = res.headers.get("content-type") || "";
  const toolAcc = new Map<string, { id: string; name: string; arguments: string }>();
  let content = "";
  let visibleContent = "";
  let streamedAnswer = false;

  // Non-streaming provider: parse once.
  if (!ct.includes("text/event-stream") || !res.body) {
    const json = (await res.json()) as Record<string, unknown>;
    const choice = (json.choices as Array<Record<string, unknown>>)?.[0];
    const message = (choice?.message as Record<string, unknown>) || {};
    content = sanitizeToolLeakText(typeof message.content === "string" ? message.content : "");
    const reasoning = readReasoning(message);
    if (reasoning) emit({ type: "reasoning", text: reasoning });
    const calls = (message.tool_calls as Array<Record<string, unknown>>) || [];
    calls.forEach((c, idx) => {
      const fn = (c.function as Record<string, unknown>) || {};
      toolAcc.set(`index:${idx}`, { id: String(c.id || `call_${idx}`), name: String(fn.name || ""), arguments: String(fn.arguments || "") });
    });
    if (content) {
      await emitBufferedText(content, emit, signal);
      streamedAnswer = true;
    }
    return { content, toolCalls: [...toolAcc.values()].filter((t) => t.name), streamedAnswer };
  }

  // Streaming provider: forward deltas live.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const partialEmit = new Map<string, number>(); // tool stream key -> last partial emit ms (throttle)
  const processFrame = (frame: string) => {
    const data = extractData(frame);
    if (!data || data === "[DONE]") return;
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    const choice = (json.choices as Array<Record<string, unknown>>)?.[0];
    if (!choice) return;
    const delta = (choice?.delta as Record<string, unknown>) || {};
    const reasoning = readReasoning(delta);
    if (reasoning) emit({ type: "reasoning", text: reasoning });
    if (typeof delta.content === "string" && delta.content) {
      content += delta.content;
      const nextVisibleContent = sanitizeToolLeakText(content, { trim: false });
      const visibleDelta = nextVisibleContent.startsWith(visibleContent) ? nextVisibleContent.slice(visibleContent.length) : "";
      visibleContent = nextVisibleContent;
      if (visibleDelta) {
        streamedAnswer = true;
        emit({ type: "delta", text: visibleDelta });
      }
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const [position, raw] of (delta.tool_calls as Array<Record<string, unknown>>).entries()) {
        const key = typeof raw.index === "number" ? `index:${raw.index}` : raw.id ? `id:${raw.id}` : `position:${position}`;
        const acc = toolAcc.get(key) || { id: "", name: "", arguments: "" };
        if (raw.id) acc.id = String(raw.id);
        const fn = (raw.function as Record<string, unknown>) || {};
        if (fn.name) acc.name = String(fn.name);
        const argChunk = typeof fn.arguments === "string" ? fn.arguments : "";
        if (argChunk) acc.arguments += argChunk;
        toolAcc.set(key, acc);

        // Stream partial tool-call arguments so the UI can render a file being
        // written live (typing preview + real-time line count). Throttled to a
        // newline or ~75ms; the loop re-emits the final arguments afterward.
        if (acc.id && acc.name) {
          const last = partialEmit.get(key) ?? 0;
          if (argChunk.includes("\n") || Date.now() - last > 75) {
            partialEmit.set(key, Date.now());
            emit({ type: "tool_call", id: acc.id, name: acc.name, arguments: acc.arguments });
          }
        }
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";
    for (const frame of frames) processFrame(frame);
  }
  buffer += decoder.decode();
  if (buffer.trim()) processFrame(buffer);

  const toolCalls = [...toolAcc.values()]
    .filter((t) => t.name)
    .map((t) => ({ id: t.id || `call_${crypto.randomUUID().slice(0, 8)}`, name: t.name, arguments: t.arguments || "{}" }));

  return { content: sanitizeToolLeakText(content), toolCalls, streamedAnswer };
}

function isRetryableProviderResponse(status: number, body: string): boolean {
  return [408, 409, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524].includes(status) || /rate limit|too many requests|quota|timeout|temporarily unavailable|overloaded|busy/i.test(body);
}

function retryMessage(status: number, body: string): string {
  if (status === 429 || /rate limit|too many requests|quota/i.test(body)) return "Rate limit reached. Retrying automatically.";
  if (status === 524 || /timeout/i.test(body)) return "Provider timed out. Retrying automatically.";
  return "Provider is busy. Retrying automatically.";
}

function emitRetry(emit: (e: StreamEvent) => void, attempt: number, maxAttempts: number, delayMs: number, message: string): void {
  emit({ type: "retry", attempt, maxAttempts, delaySeconds: delayMs / 1000, message });
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("Request cancelled"));
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("Request cancelled"));
      },
      { once: true },
    );
  });
}

function readReasoning(obj: Record<string, unknown>): string {
  for (const key of ["reasoning_content", "reasoning", "thinking"]) {
    const v = obj[key];
    if (typeof v === "string" && v) return v;
  }
  return "";
}

function extractData(frame: string): string {
  const lines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    const t = line.trimEnd();
    if (t.startsWith("data:")) lines.push(t.slice(5).replace(/^\s/, ""));
  }
  return lines.join("\n").trim();
}

function chunkText(text: string, target = 160): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(text.length, i + target);
    if (end < text.length) {
      const boundary = text.lastIndexOf(" ", end);
      if (boundary > i + target / 2) end = boundary + 1;
    }
    chunks.push(text.slice(i, end));
    i = end;
  }
  return chunks;
}

async function emitBufferedText(text: string, emit: (e: StreamEvent) => void, signal: AbortSignal): Promise<void> {
  for (const chunk of chunkText(sanitizeToolLeakText(text))) {
    if (signal.aborted) return;
    emit({ type: "delta", text: chunk });
    await sleep(0, signal).catch(() => undefined);
  }
}

function isToolErrorResult(result: string): boolean {
  return /^Error(?:\b|:)|\bExit code:\s*[1-9]\d*\b|Command timed out|Command cancelled|^VERDICT:\s*FAIL\b/im.test(result.trim());
}

function buildQuestionEvent(call: PreparedToolCall): StreamEvent {
  const q = call.parsed;
  const rawOptions = Array.isArray(q.options) ? (q.options as Array<Record<string, unknown>>) : [];
  const options = rawOptions
    .map((o) => ({ label: String(o?.label || ""), description: o?.description ? String(o.description) : undefined }))
    .filter((o) => o.label);
  return {
    type: "question",
    id: call.id,
    question: String(q.question || ""),
    header: q.header ? String(q.header) : undefined,
    options,
  };
}

function buildPlanEvent(call: PreparedToolCall, result?: string): StreamEvent {
  const a = call.parsed;
  const fileMatch = result ? /Plan saved:\s*(\S+)/.exec(result) : null;
  return {
    type: "plan",
    id: call.id,
    title: String(a.title || "Implementation Plan"),
    plan: String(a.plan || ""),
    file: fileMatch ? fileMatch[1] : undefined,
  };
}

function normalizeMode(value: string | undefined): ChatMode {
  return value === "code" || value === "chat" || value === "agent" ? value : "agent";
}

function prepareToolCall(call: { id: string; name: string; arguments: string }): PreparedToolCall {
  let parsed: Record<string, unknown> = {};
  const raw = call.arguments || "{}";
  try {
    const value = JSON.parse(raw);
    if (value && typeof value === "object" && !Array.isArray(value)) parsed = value as Record<string, unknown>;
  } catch {
    // JSON repair: try to fix truncated/malformed arguments
    try {
      let fixed = raw.trim();
      // Fix truncated JSON: add missing closing braces/brackets
      const opens = (fixed.match(/[{[]/g) || []).length;
      const closes = (fixed.match(/[}\]]/g) || []).length;
      for (let j = 0; j < opens - closes; j++) fixed += fixed.includes("[") && !fixed.includes("{") ? "]" : "}";
      // Fix trailing comma before close
      fixed = fixed.replace(/,\s*([}\]])/g, "$1");
      const value = JSON.parse(fixed);
      if (value && typeof value === "object" && !Array.isArray(value)) parsed = value as Record<string, unknown>;
    } catch {
      /* truly malformed — proceed with empty args */
    }
  }

  // Canonicalize the tool name (repair hallucinated names)
  const canonical = canonicalToolName(call.name);

  return { ...call, name: canonical, parsed };
}

function toolExecutionBatches(calls: PreparedToolCall[]): PreparedToolCall[][] {
  const batches: PreparedToolCall[][] = [];
  let safeBatch: PreparedToolCall[] = [];

  const flushSafeBatch = () => {
    if (safeBatch.length) batches.push(safeBatch);
    safeBatch = [];
  };

  for (const call of calls) {
    if (isConcurrencySafeTool(call.name)) safeBatch.push(call);
    else {
      flushSafeBatch();
      batches.push([call]);
    }
  }
  flushSafeBatch();
  return batches;
}

function isConcurrencySafeTool(name: string): boolean {
  if (name.startsWith("mcp__")) return true;
  return new Set(["Read", "Glob", "Grep", "LS", "WebFetch", "WebSearch", "XSearch", "RecallSessions", "MultiModel", "Skill", "Task", "ListProcesses", "Vision", "Transcribe"]).has(canonicalToolName(name));
}

// ── Sub-agents (the Task tool) ────────────────────────────────
// A sub-agent is a focused, autonomous worker the main agent spawns
// to handle one task end-to-end and report back. It runs its own
// tool loop against the same workspace, but cannot spawn further
// sub-agents or ask the user directly, so recursion and stalled turns
// stay bounded.
type SubAgentType = "general" | "explore" | "verification";

const SUB_AGENT_TOOLS = AGENT_TOOLS.filter((t) => !["Task", "AskUserQuestion", "SwitchMode", "Plan"].includes(t.function.name));
const EXPLORE_AGENT_TOOLS = AGENT_TOOLS.filter((t) => ["Read", "Glob", "Grep", "LS", "WebFetch", "WebSearch", "RecallSessions", "XSearch", "Skill"].includes(t.function.name));
const VERIFICATION_AGENT_TOOLS = SUB_AGENT_TOOLS.filter((t) => !["Write", "Edit", "MultiEdit", "ApplyPatch", "TodoWrite", "Kanban", "Schedule", "MultiModel"].includes(t.function.name));
const SUB_AGENT_MAX_ITERATIONS = 64;

function normalizeSubAgentType(value: string): SubAgentType {
  return value === "explore" || value === "verification" ? value : "general";
}

function subAgentTools(type: SubAgentType): typeof AGENT_TOOLS {
  if (type === "explore") return EXPLORE_AGENT_TOOLS;
  if (type === "verification") return VERIFICATION_AGENT_TOOLS;
  return SUB_AGENT_TOOLS;
}

function subAgentSystemPrompt(type: SubAgentType): string {
  const shell =
    process.platform === "win32"
      ? "Commands run in PowerShell on Windows (pwsh when available, Windows PowerShell fallback); avoid bash-only syntax (mkdir -p, cat > file, /home/...)."
      : "Commands run in bash.";
  const base = [
    "You are a VaultGate sub-agent: a focused worker spawned by the main agent to complete ONE task autonomously and then report back.",
    "You cannot ask the user questions and cannot spawn other sub-agents. Make reasonable decisions from the prompt, work efficiently, and stop once your assigned scope is complete.",
    "Use parallel Read/Grep/Glob/LS/WebFetch/WebSearch calls whenever they are independent. Run mutations and shell commands serially.",
    "When complete, STOP calling tools and reply in plain text with: what you did, key findings/results, commands or checks run, file paths changed or inspected, and anything the main agent needs to continue.",
    "Do not include raw tool transcripts in plain text. Never write lines like `Tool Open({...}) => ...`, JSON tool arguments, or pasted internal tool outputs unless the parent explicitly requested a transcript.",
    shell,
  ];

  if (type === "explore") {
    return [
      ...base,
      "Mode: read-only exploration. Do not create, edit, delete, move, install, or run state-changing commands. Your available tools are limited to reading, listing, searching, web search/fetch, and skill loading.",
      "Start broad, then narrow. Use multiple naming and path strategies if the first search misses. Match the caller's requested thoroughness and return concise file/line-oriented findings.",
    ].join("\n");
  }

  if (type === "verification") {
    return [
      ...base,
      "Mode: adversarial verification. Your job is to try to break the implementation, not rubber-stamp it.",
      "Do not modify project files. You may run builds, tests, linters, typechecks, and read files. If a command would write durable project state, do not run it.",
      "Verify by executing commands and observing outputs, not by reading code alone. Include at least one edge, boundary, idempotency, regression, or failure-path probe when applicable.",
      "End with exactly one verdict line: VERDICT: PASS, VERDICT: FAIL, or VERDICT: PARTIAL. Use PARTIAL only for environmental limitations.",
    ].join("\n");
  }

  return [
    ...base,
    "Mode: general implementation/research. Complete the assigned scope fully without gold-plating. Prefer the smallest correct change, follow existing project conventions, and verify any code you change before reporting back.",
  ].join("\n");
}

function describeSubCall(call: PreparedToolCall): string {
  const name = canonicalToolName(call.name);
  const a = call.parsed;
  const detail = String(a.command || a.filepath || a.file_path || a.path || a.pattern || a.query || a.url || a.command || "");
  return detail ? `${name}: ${detail.slice(0, 80)}` : name;
}

function snapshotRun(run: SubAgentRun) {
  const { abortController: _abortController, ...safe } = run;
  void _abortController;
  return safe;
}

function updateSubAgentRun(id: string, patch: Partial<Omit<SubAgentRun, "id" | "abortController">>): void {
  const run = subAgentRuns.get(id);
  if (!run) return;
  subAgentRuns.set(id, { ...run, ...patch, updatedAt: Date.now() });
}

async function appendSubAgentTerminalMessage(subAgentChatId: string, content: string, status: Message["status"] = "complete") {
  await upsertMessage(sanitizeAssistantMessage({
    id: `${subAgentChatId}-terminal-${Date.now()}`,
    chatId: subAgentChatId,
    role: "assistant",
    content,
    blocks: [{ type: "text", content }],
    status,
    createdAt: Date.now(),
  }));
}

async function appendParentSubAgentReport(parentChatId: string, subAgentChatId: string, description: string, result: string, status: SubAgentRunStatus) {
  const label = status === "completed" ? "finished" : status === "timeout" ? "timed out" : status === "cancelled" ? "was stopped" : "failed";
  const content = `Sub-agent ${label}: ${description}\n\n${result}`;
  await upsertMessage(sanitizeAssistantMessage({
    id: `${subAgentChatId}-parent-report`,
    chatId: parentChatId,
    role: "assistant",
    content,
    blocks: [{ type: "text", content }],
    status: status === "completed" ? "complete" : "error",
    createdAt: Date.now(),
  }));
}

export function getSubAgentRun(id: string) {
  const run = subAgentRuns.get(id);
  return run ? snapshotRun(run) : null;
}

export function cancelSubAgentRun(id: string): boolean {
  const run = subAgentRuns.get(id);
  if (!run || run.status !== "running") return false;
  updateSubAgentRun(id, { status: "cancelled" });
  run.abortController.abort();
  return true;
}

export function cancelSubAgentRunsForParent(parentChatId: string): number {
  let cancelled = 0;
  for (const run of subAgentRuns.values()) {
    if (run.parentChatId !== parentChatId || run.status !== "running") continue;
    updateSubAgentRun(run.id, { status: "cancelled" });
    run.abortController.abort();
    cancelled++;
  }
  return cancelled;
}

export async function startSubAgentTask(
  chatId: string,
  description: string,
  prompt: string,
  ctx: { subagentType?: string; onOutput?: (chunk: string) => void; subAgentChatId: string; approval?: ApprovalSettings; agentParams?: ChatRequest["agentParams"] },
): Promise<string> {
  const config = await getProviderConfig();
  if (!config.endpoint) return "Sub-agent error: no API endpoint configured.";
  const model = config.model;
  if (!model) return "Sub-agent error: no model configured.";

  const type = normalizeSubAgentType(ctx.subagentType || "general");
  const subAgentChatId = ctx.subAgentChatId;
  const controller = new AbortController();
  const startedAt = Date.now();
  subAgentRuns.set(subAgentChatId, {
    id: subAgentChatId,
    parentChatId: chatId,
    title: description,
    type,
    status: "running",
    startedAt,
    updatedAt: startedAt,
    abortController: controller,
  });

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    updateSubAgentRun(subAgentChatId, { status: "timeout" });
    controller.abort();
  }, Math.max(30_000, SUB_AGENT_TIMEOUT_MS));

  void (async () => {
    try {
      const result = await runSubAgentTask(chatId, description, prompt, {
        subagentType: type,
        onOutput: ctx.onOutput,
        signal: controller.signal,
        subAgentChatId,
        approval: ctx.approval,
        agentParams: ctx.agentParams,
      });
      const status: SubAgentRunStatus = timedOut ? "timeout" : controller.signal.aborted ? "cancelled" : "completed";
      const finalResult = status === "timeout" ? `${result}\n\nSub-agent timed out after ${Math.round(SUB_AGENT_TIMEOUT_MS / 1000)}s.` : result;
      updateSubAgentRun(subAgentChatId, { status, finishedAt: Date.now(), result: finalResult });
      if (status !== "completed") await appendSubAgentTerminalMessage(subAgentChatId, finalResult, "error");
      await appendParentSubAgentReport(chatId, subAgentChatId, description, finalResult, status);
    } catch (error) {
      const status: SubAgentRunStatus = timedOut ? "timeout" : controller.signal.aborted ? "cancelled" : "error";
      const message = error instanceof Error ? error.message : String(error);
      const result = status === "timeout" ? `Sub-agent timed out after ${Math.round(SUB_AGENT_TIMEOUT_MS / 1000)}s.` : `Sub-agent ${status}: ${message}`;
      updateSubAgentRun(subAgentChatId, { status, finishedAt: Date.now(), error: message, result });
      await appendSubAgentTerminalMessage(subAgentChatId, result, "error");
      await appendParentSubAgentReport(chatId, subAgentChatId, description, result, status);
    } finally {
      clearTimeout(timeout);
    }
  })();

  return `Started sub-agent in background. id: ${subAgentChatId}\nType: ${type}\nDescription: ${description}\nThe parent chat can continue now; a completion report will be appended here when the sub-agent finishes.`;
}

export async function runSubAgentTask(
  chatId: string,
  description: string,
  prompt: string,
  ctx: { subagentType?: string; onOutput?: (chunk: string) => void; signal: AbortSignal; subAgentChatId?: string; approval?: ApprovalSettings; agentParams?: ChatRequest["agentParams"] },
): Promise<string> {
  const config = await getProviderConfig();
  if (!config.endpoint) return "Sub-agent error: no API endpoint configured.";
  const model = config.model;
  if (!model) return "Sub-agent error: no model configured.";
  const type = normalizeSubAgentType(ctx.subagentType || "general");
  const tools = subAgentTools(type);
  const approval = normalizeApprovalSettings(ctx.approval);
  const maxIterations = ctx.agentParams?.subAgentMaxIterations ?? SUB_AGENT_MAX_ITERATIONS;

  const emit = (e: StreamEvent) => {
    if (e.type === "retry") ctx.onOutput?.(`  ${e.message}\n`);
  };

  const messages: ProviderMessage[] = [
    { role: "system", content: subAgentSystemPrompt(type) },
    { role: "user", content: `Task: ${description}\nSub-agent type: ${type}\n\n${prompt}` },
  ];

  const subAgentChatId = ctx.subAgentChatId;
  if (subAgentChatId) {
    const { createChat, upsertMessage } = await import("@/lib/db/repo");
    await createChat({
      id: subAgentChatId,
      title: description,
      model: model,
      parentId: chatId,
      type: "subagent",
    });

    const userMessage: Message = {
      id: `${subAgentChatId}-user`,
      chatId: subAgentChatId,
      role: "user",
      content: `Task: ${description}\nSub-agent type: ${type}\n\n${prompt}`,
      blocks: [{ type: "text", content: `Task: ${description}\nSub-agent type: ${type}\n\n${prompt}` }],
      status: "complete",
      createdAt: Date.now(),
    };
    await upsertMessage(userMessage);
  }

  const upsertSubAgentAssistantMessage = async (turnContent: string, turnToolCalls: TurnResult["toolCalls"], index: number, runResults: ToolResult[]) => {
    if (!subAgentChatId) return;
    const { upsertMessage } = await import("@/lib/db/repo");
    const blocks: ContentBlock[] = [];
    if (turnContent) {
      blocks.push({ type: "text", content: turnContent });
    }
    if (turnToolCalls && turnToolCalls.length > 0) {
      blocks.push({
        type: "tool_calls",
        content: "",
        toolCalls: turnToolCalls.map((t) => ({ id: t.id, name: t.name, arguments: t.arguments })),
        results: runResults,
      });
    }
    await upsertMessage(sanitizeAssistantMessage({
      id: `${subAgentChatId}-assistant-${index}`,
      chatId: subAgentChatId,
      role: "assistant",
      content: turnContent || "",
      blocks,
      status: "complete",
      createdAt: Date.now(),
    }));
  };

  ctx.onOutput?.(`Sub-agent started (${type}): ${description}\n`);
  let report = "";

  for (let i = 0; i < maxIterations; i++) {
    if (ctx.signal.aborted) return "Sub-agent cancelled.";
    const turn = await callLLM(config.endpoint, config.apiKey, model, messages, emit, ctx.signal, "auto", tools);

    if (turn.toolCalls.length === 0) {
      report = turn.content;
      await upsertSubAgentAssistantMessage(turn.content, [], i, []);
      break;
    }

    messages.push({
      role: "assistant",
      content: turn.content,
      tool_calls: turn.toolCalls.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: t.arguments } })),
    });

    const runResults: ToolResult[] = [];
    await upsertSubAgentAssistantMessage(turn.content, turn.toolCalls, i, runResults);

    const calls = turn.toolCalls.map(prepareToolCall);
    for (const batch of toolExecutionBatches(calls)) {
      for (const call of batch) ctx.onOutput?.(`  -> ${describeSubCall(call)}\n`);
      const results = await Promise.all(
        batch.map(async (call) => {
          const permission = evaluateToolPermission(chatId, call.name, call.parsed, approval, { canAsk: false });
          if (permission.action !== "allow") {
            return { id: call.id, result: `Error: ${permission.reason} (${permission.summary})` };
          }
          return {
            id: call.id,
            result: await executeTool(call.name, call.parsed, { chatId, signal: ctx.signal, onOutput: ctx.onOutput, approval, agentParams: ctx.agentParams }),
          };
        }),
      );
      for (const { id, result } of results) {
        messages.push({ role: "tool", content: result, tool_call_id: id });
        runResults.push({
          toolCallId: id,
          status: isToolErrorResult(result) ? "error" : "completed",
          content: result,
        });
      }
      await upsertSubAgentAssistantMessage(turn.content, turn.toolCalls, i, runResults);
    }
  }

  if (!report) {
    messages.push({ role: "user", content: "Stop using tools now and reply with your concise final report." });
    const wrap = await callLLM(config.endpoint, config.apiKey, model, messages, emit, ctx.signal, "none", tools);
    report = wrap.content || "(sub-agent finished without a written report)";

    if (subAgentChatId) {
      const { upsertMessage } = await import("@/lib/db/repo");
      await upsertMessage({
        id: `${subAgentChatId}-force-wrap-user`,
        chatId: subAgentChatId,
        role: "user",
        content: "Stop using tools now and reply with your concise final report.",
        blocks: [{ type: "text", content: "Stop using tools now and reply with your concise final report." }],
        status: "complete",
        createdAt: Date.now(),
      });
      await upsertMessage(sanitizeAssistantMessage({
        id: `${subAgentChatId}-assistant-wrap`,
        chatId: subAgentChatId,
        role: "assistant",
        content: report,
        blocks: [{ type: "text", content: report }],
        status: "complete",
        createdAt: Date.now(),
      }));
    }
  }

  ctx.onOutput?.(`Sub-agent done (${type}): ${description}\n`);
  return `Sub-agent report (${type}) - ${description}:\n\n${report}`;
}

// Enforce the mode's capability tree at execution time (defense in depth): the
// gated toolset is already withheld from the provider, but if the model still
// emits a tool the current branch lacks, refuse it and point it at SwitchMode.
async function runGatedToolCall(
  call: PreparedToolCall,
  mode: ChatMode,
  canSwitch: boolean,
  chatId: string,
  approval: ApprovalSettings,
  agentParams: ChatRequest["agentParams"] | undefined,
  emit: (e: StreamEvent) => void,
  signal: AbortSignal,
): Promise<ToolExecutionResult> {
  const permission = evaluateToolPermission(chatId, call.name, call.parsed, approval, { canAsk: true });
  if (permission.action === "block") {
    const msg = `Blocked ${permission.summary}. ${permission.reason}`;
    emit({ type: "tool_result", id: call.id, status: "error", content: msg });
    return { id: call.id, content: msg };
  }
  if (permission.action === "ask") {
    const msg = `Approval required before running ${permission.summary}. ${permission.reason}`;
    emit({ type: "tool_result", id: call.id, status: "error", content: msg });
    emit({ type: "delta", text: `${msg}\n` });
    emit({ type: "question", ...permissionQuestion(permission) });
    return { id: call.id, content: msg, paused: true };
  }

  // Connected MCP tools bypass the static mode gate after approval policy passes.
  if (call.name.startsWith("mcp__")) {
    return runMcpToolCall(call, emit, signal);
  }
  if (!isToolAllowed(mode, call.name, canSwitch)) {
    const canonical = canonicalToolName(call.name);
    const hint = mode === "chat" ? "Chat mode can only read files and search the web." : `${mode} mode does not include this tool.`;
    const remedy = canSwitch
      ? `Call SwitchMode to "code" (software engineering) or "agent" (open-ended builds) first, then retry.`
      : `Mode is locked (Auto is off), so tell the user you can't do this in ${mode} mode and suggest enabling Auto mode or switching modes — do not attempt it.`;
    const msg = `Error: the "${canonical}" tool is not available in ${mode} mode. ${hint} ${remedy}`;
    emit({ type: "tool_result", id: call.id, status: "error", content: msg });
    return { id: call.id, content: msg };
  }
  return runToolCall(call, chatId, approval, agentParams, emit, signal);
}

async function runToolCall(
  call: PreparedToolCall,
  chatId: string,
  approval: ApprovalSettings,
  agentParams: ChatRequest["agentParams"] | undefined,
  emit: (e: StreamEvent) => void,
  signal: AbortSignal,
): Promise<ToolExecutionResult> {
  let streamedOutput = "";
  emit({ type: "tool_result", id: call.id, status: "running", content: "" });
  await sleep(0, signal).catch(() => undefined);

  const result = await executeTool(call.name, call.parsed, {
    chatId,
    signal,
    toolCallId: call.id,
    approval,
    agentParams,
    onOutput: (chunk) => {
      streamedOutput += chunk;
      emit({ type: "terminal", id: call.id, chunk });
      emit({ type: "tool_result", id: call.id, status: "running", content: streamedOutput });
    },
  });

  const status = isToolErrorResult(result) ? "error" : "completed";
  emit({ type: "tool_result", id: call.id, status, content: result });
  return { id: call.id, content: result };
}

// ── MCP integration helpers ─────────────────────────────────

function mcpToolToOpenAI(tool: McpToolDef) {
  return {
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description || `MCP tool from ${tool.serverName}`,
      parameters: tool.inputSchema ?? { type: "object", properties: {} },
    },
  };
}

async function runMcpToolCall(
  call: PreparedToolCall,
  emit: (e: StreamEvent) => void,
  signal: AbortSignal,
): Promise<ToolExecutionResult> {
  emit({ type: "tool_result", id: call.id, status: "running", content: "" });
  await sleep(0, signal).catch(() => undefined);
  const result = await callMcpTool(call.name, call.parsed);
  const status = result.isError ? "error" : "completed";
  emit({ type: "tool_result", id: call.id, status, content: result.content });
  return { id: call.id, content: result.content };
}
