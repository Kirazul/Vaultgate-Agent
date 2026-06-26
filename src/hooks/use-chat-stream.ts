"use client";
// ============================================================
// The streaming bridge. This is the fix for the legacy
// "buffered / appears all at once" problem.
//
//  • The SSE read loop only mutates a BlockBuilder + a `dirty`
//    flag. It never calls setState.
//  • A single requestAnimationFrame loop commits the accumulated
//    text/blocks to the store ONCE PER FRAME (~60fps), coalescing
//    many tokens into one render. No flushSync, no per-token churn.
//  • Only the active assistant message ref changes per flush, so
//    memoized bubbles for prior messages never re-render.
// ============================================================
import { useCallback, useRef, type MutableRefObject } from "react";
import { readEventStream } from "@/lib/ai/stream";
import { BlockBuilder } from "@/lib/ai/blocks";
import { useChatStore, persistMessage } from "@/lib/store/chat-store";
import { useSettingsStore } from "@/lib/store/settings-store";
import { useWorkspaceStore } from "@/lib/store/workspace-store";
import { canonicalToolName } from "@/lib/ai/tools/definitions";
import { firstVisibleLine, sanitizeToolLeakBlocks, sanitizeToolLeakText } from "@/lib/ai/tool-leak-sanitizer";
import type { ChatRequest, ContentBlock, Message, StreamEvent } from "@/types";
import { uid } from "@/lib/utils";

function parseLooseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function hydrateSubAgentTranscripts(chatId: string): Promise<void> {
  const store = useChatStore.getState();
  const taskIds = new Set<string>();

  for (const message of store.messages(chatId)) {
    for (const block of message.blocks) {
      if (block.type !== "tool_calls") continue;
      for (const call of block.toolCalls ?? []) {
        if (canonicalToolName(call.name) === "Task") taskIds.add(call.id);
      }
    }
  }

  await Promise.all(
    [...taskIds].map(async (id) => {
      try {
        await fetch(`/api/subagents/${id}`, { cache: "no-store" }).catch(() => null);
        const res = await fetch(`/api/chats/${id}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const { messages, ...chat } = data;
        useChatStore.getState().upsertChat(chat);
        useChatStore.getState().setMessages(id, messages);
      } catch {
        /* Sub-agent transcripts are best-effort context, never block sending. */
      }
    }),
  );
}

async function createWorkspaceCheckpoint(chatId: string, messageId: string, createdAt: number): Promise<void> {
  try {
    await fetch("/api/workspace/checkpoints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId, messageId, createdAt }),
    });
  } catch {
    /* Rollback checkpoints are best-effort and must not block chat. */
  }
}

function messageContextContent(message: Message): string {
  const parts: string[] = [];
  const visibleText = sanitizeToolLeakText(
    message.blocks
      .filter((block) => block.type === "text")
      .map((block) => block.content)
      .join("\n\n") || message.content,
  );
  if (visibleText.trim()) parts.push(visibleText.trim());

  const internal: string[] = [];
  for (const block of message.blocks) {
    if (block.type !== "tool_calls") continue;
    for (const call of block.toolCalls ?? []) {
      const toolName = canonicalToolName(call.name);
      const result = block.results?.find((r) => r.toolCallId === call.id);
      if (result?.content) internal.push(`${toolName}: ${firstVisibleLine(result.content)}`);
      if (toolName === "Task") {
        const subMessages = useChatStore.getState().messagesByChat[call.id] ?? [];
        if (subMessages.length > 0) {
          const transcript = subMessages
            .map((m) => `${m.role}: ${messageContextContent(m)}`)
            .join("\n\n")
            .slice(0, 6000);
          internal.push(`Sub-agent ${call.id}: ${transcript}`);
        }
      }
    }
  }
  if (!visibleText.trim() && internal.length > 0) parts.push(`[Internal action summary; do not repeat as a tool transcript.]\n${internal.slice(0, 12).join("\n")}`);

  return parts.join("\n\n") || "(no assistant text; see workspace history)";
}

export function useChatStream() {
  const abortByChatRef = useRef<Map<string, AbortController>>(new Map());
  const streamEventListenerRef = useRef<((event: StreamEvent) => void) | null>(null) as MutableRefObject<((event: StreamEvent) => void) | null>;

  const send = useCallback(async (chatId: string, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const chatStore = useChatStore.getState();
    const settings = useSettingsStore.getState();
    const model = settings.provider.model;
    if (!model) return;

    // Sending a message answers/supersedes any pending clarifying question or plan for this chat.
    chatStore.clearPendingForChat(chatId);
    await hydrateSubAgentTranscripts(chatId);

    // 1. User message (optimistic + persisted)
    const userCreatedAt = Date.now();
    const userMsg: Message = {
      id: uid(),
      chatId,
      role: "user",
      content: trimmed,
      blocks: [{ type: "text", content: trimmed }],
      status: "complete",
      createdAt: userCreatedAt,
    };
    await createWorkspaceCheckpoint(chatId, userMsg.id, userMsg.createdAt);
    chatStore.addMessage(chatId, userMsg);
    persistMessage(chatId, { ...userMsg });

    // Capture history NOW (includes the user message, excludes the
    // assistant placeholder we are about to add).
    const history = useChatStore.getState().messages(chatId);

    // 2. Assistant placeholder (streaming)
    const assistantId = uid();
    const assistant: Message = {
      id: assistantId,
      chatId,
      role: "assistant",
      content: "",
      blocks: [],
      status: "streaming",
      model,
      createdAt: userCreatedAt + 1,
    };
    chatStore.addMessage(chatId, assistant);
    chatStore.setStreaming(chatId, true);

    // 3. Build request from history (assistant placeholder excluded)
      const body: ChatRequest = {
        chatId,
        model,
      messages: history
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role, content: m.role === "assistant" ? messageContextContent(m) : m.content })),
      features: settings.features,
        mode: settings.mode,
        auto: settings.autoMode,
        agentParams: settings.agentParams,
        approval: settings.approval,
      };

    // 4. rAF batching machinery.
    // Commit on a steady ~45ms cadence (not every frame): coalesces bursty
    // provider deltas into smooth, regular updates and keeps the markdown
    // re-parse cost bounded as the message grows (the source of the lag).
    const builder = new BlockBuilder();
    const toolNamesById = new Map<string, string>();
    const initializedToolIds = new Set<string>();
    const startedAt = Date.now();
    // ~30ms (~33fps) reads as smooth, continuous typing while still coalescing
    // bursty provider deltas into one render. The rAF gate below caps it to the
    // display refresh so it never over-commits between frames.
    const COMMIT_INTERVAL_MS = 30;
    let dirty = false;
    let finished = false;
    let rafId = 0;
    let lastCommit = 0;

    const commit = () => {
      dirty = false;
      const blocks = sanitizeToolLeakBlocks(builder.snapshot());
      useChatStore.getState().patchMessage(chatId, assistantId, {
        content: sanitizeToolLeakText(builder.plain()),
        blocks,
      });
    };

    const flush = (now: number) => {
      if (dirty && now - lastCommit >= COMMIT_INTERVAL_MS) {
        lastCommit = now;
        commit();
      }
      if (!finished) rafId = requestAnimationFrame(flush);
    };
    rafId = requestAnimationFrame(flush);

    const controller = new AbortController();
    abortByChatRef.current.set(chatId, controller);
    let errored = false;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);

      await readEventStream(
        res,
        (event) => {
          switch (event.type) {
            case "delta":
              builder.appendText(event.text);
              dirty = true;
              break;
            case "reasoning":
              builder.appendReasoning(event.text);
              dirty = true;
              break;
            case "tool_call": {
              builder.addToolCall({ id: event.id, name: event.name, arguments: event.arguments });
              dirty = true;
              const toolName = canonicalToolName(event.name);
              toolNamesById.set(event.id, toolName);
              if (initializedToolIds.has(event.id)) break;
              initializedToolIds.add(event.id);
              const ws = useWorkspaceStore.getState();
              if (["Write", "Edit", "MultiEdit", "ApplyPatch", "Delete", "Move"].includes(toolName) && !ws.panelOpen) ws.notifyPanel();
              if (["Bash", "Write", "Edit", "MultiEdit", "ApplyPatch", "Delete", "Move"].includes(toolName)) ws.setFocusedTool(event.id);
              if (toolName === "Task") {
                const args = parseLooseObject(event.arguments);
                useChatStore.getState().upsertChat({
                  id: event.id,
                  title: String(args.description || "Sub-agent"),
                  model,
                  parentId: chatId,
                  type: "subagent",
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                });
              }
              break;
            }
            case "tool_result":
              builder.addToolResult(event.id, event.status, event.content);
              dirty = true;
              if (event.status !== "running" && isWorkspaceChangingTool(toolNamesById.get(event.id))) {
                useWorkspaceStore.getState().bumpWorkspace();
              }
              break;
            case "terminal":
              useWorkspaceStore.getState().appendTerminal(chatId, event.chunk, event.id);
              break;
            case "retry":
              builder.appendReasoning(`${event.message} Attempt ${event.attempt}/${event.maxAttempts}; retrying in ${event.delaySeconds}s.`);
              dirty = true;
              break;
            case "question":
              useChatStore.getState().setPendingQuestion({
                chatId,
                id: event.id,
                question: event.question,
                header: event.header,
                options: event.options,
              });
              break;
            case "plan":
              // The model decided this task warrants a plan: present the
              // approval card (this IS the visible "plan mode" activation). We
              // deliberately do NOT flip the persistent planFirst preference —
              // doing so re-armed the full plan-first system prompt on the
              // APPROVAL turn, which made the model re-plan instead of build.
              // The approve → implement transition is anchored server-side by
              // the plan-mode-exit directive (see lib/chat/plan.ts).
              useChatStore.getState().setPendingPlan({
                chatId,
                id: event.id,
                title: event.title,
                plan: event.plan,
                file: event.file,
              });
              break;
            case "mode":
              // The model escalated/switched its own branch — reflect it in the
              // UI (which also plays the transformation overlay).
              useSettingsStore.getState().setMode(event.mode);
              break;
            case "title": {
              const store = useChatStore.getState();
              const chat = store.chats.find((c) => c.id === chatId);
              if (chat && chat.title === "New Chat") {
                store.setChatTitle(chatId, event.title);
                void fetch(`/api/chats/${chatId}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ title: event.title }),
                }).catch(() => {});
              }
              break;
            }
            case "error":
              builder.appendText((builder.plain() ? "\n\n" : "") + `Error: ${event.message}`);
              dirty = true;
              errored = true;
              break;
            case "done":
              break;
          }
          streamEventListenerRef.current?.(event);
        },
        controller.signal,
      );
    } catch (err) {
      if (!controller.signal.aborted) {
        builder.appendText(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
        dirty = true;
        errored = true;
      }
    } finally {
      finished = true;
      cancelAnimationFrame(rafId);
      // Final commit (captures anything since the last frame).
      const cancelled = controller.signal.aborted;
      const finalContent = sanitizeToolLeakText(builder.plain());
      const finalBlocks = cancelled ? markCancelledToolResults(sanitizeToolLeakBlocks(builder.snapshot())) : sanitizeToolLeakBlocks(builder.snapshot());
      const finalMsg: Message = {
        id: assistantId,
        chatId,
        role: "assistant",
        content: finalContent,
        blocks: finalBlocks,
        status: cancelled ? "cancelled" : errored ? "error" : "complete",
        model,
        createdAt: assistant.createdAt,
        durationMs: Math.max(0, Date.now() - startedAt),
      };
      const store = useChatStore.getState();
      store.patchMessage(chatId, assistantId, {
        content: finalMsg.content,
        blocks: finalMsg.blocks,
        status: finalMsg.status,
        durationMs: finalMsg.durationMs,
      });
      store.setStreaming(chatId, false);
      abortByChatRef.current.delete(chatId);
      const hasVisibleContent = finalMsg.content.trim() || finalMsg.blocks.some((b) => b.type === "text" ? b.content.trim() : b.type === "tool_calls");
      if (cancelled && !hasVisibleContent) {
        // Cancelled before any visible response — remove both messages
        // and restore the user's text to the composer.
        const latest = useChatStore.getState();
        const msgs = latest.messagesByChat[chatId] ?? [];
        latest.setMessages(chatId, msgs.filter((m) => m.id !== assistantId && m.id !== userMsg.id));
        const hasDraft = Boolean(latest.draftByChat[chatId]?.trim());
        const hasQueued = Boolean(latest.queuedByChat[chatId]?.length);
        if (!hasDraft && !hasQueued) latest.setDraft(chatId, userMsg.content);
        // Delete persisted messages
        void fetch(`/api/chats/${chatId}/messages`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [userMsg.id, assistantId] }) }).catch(() => {});
      } else {
        persistMessage(chatId, { ...finalMsg });
      }
    }
  }, []);

  const stop = useCallback((chatId?: string) => {
    if (chatId) {
      abortByChatRef.current.get(chatId)?.abort();
      return;
    }
    for (const controller of abortByChatRef.current.values()) controller.abort();
  }, []);

  return { send, stop, streamEventListenerRef };
}

function isWorkspaceChangingTool(toolName: string | undefined): boolean {
  return toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit" || toolName === "ApplyPatch" || toolName === "Delete" || toolName === "Move" || toolName === "Bash" || toolName === "Open" || toolName === "Desktop";
}

function markCancelledToolResults(blocks: ContentBlock[]): ContentBlock[] {
  return blocks.map((block) => {
    if (block.type !== "tool_calls") return block;

    let changed = false;
    const results = (block.results ?? []).map((result) => {
      if (result.status !== "running") return result;
      changed = true;
      return { ...result, status: "error" as const, content: "Stopped before this tool returned." };
    });
    const seen = new Set(results.map((result) => result.toolCallId));
    for (const call of block.toolCalls ?? []) {
      if (seen.has(call.id)) continue;
      changed = true;
      results.push({ toolCallId: call.id, status: "error", content: "Stopped before this tool returned.", durationMs: Math.max(0, Date.now() - (call.startedAt ?? Date.now())) });
    }

    return changed ? { ...block, results } : block;
  });
}
