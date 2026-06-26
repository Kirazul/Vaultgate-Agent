"use client";
import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { ArrowLeft, LockKeyhole, Square } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { MessageList } from "./MessageList";
import { Composer, type UploadedAttachment } from "./Composer";
import { WelcomeScreen } from "./WelcomeScreen";
import { SettingsDialog } from "./SettingsDialog";
import { InventoryDialog } from "./InventoryDialog";
import { WorkspaceHandle, WorkspacePanel } from "./WorkspacePanel";
import { QuestionCard } from "./QuestionCard";
import { PlanCard } from "./PlanCard";
import { TurnStatusLine } from "./TurnStatusLine";
import { getMessageFileDiffs } from "./ToolCalls";
import { EMPTY_MESSAGES, EMPTY_QUEUED_MESSAGES, useChatStore } from "@/lib/store/chat-store";
import { useSettingsStore } from "@/lib/store/settings-store";
import { useUiStore } from "@/lib/store/ui-store";
import { useWorkspaceStore } from "@/lib/store/workspace-store";
import { useProjectStore } from "@/lib/store/project-store";
import { useChatStream } from "@/hooks/use-chat-stream";
import { useMountTransition } from "@/hooks/use-mount-transition";
import { planApprovalMessage, planRevisionMessage } from "@/lib/chat/plan";
import type { Chat, ChatMode, ChatRequest, Message, PermissionMode, PendingQuestion, StreamEvent } from "@/types";
import { normalizeToolName } from "@/lib/ai/tool-display";
import { cn, uid } from "@/lib/utils";
import { readEventStream } from "@/lib/ai/stream";
import { BlockBuilder } from "@/lib/ai/blocks";
import { sanitizeToolLeakBlocks, sanitizeToolLeakText } from "@/lib/ai/tool-leak-sanitizer";
import { expandWorkspaceReferences } from "@/lib/chat/file-mentions";
import { formatSlashHelp, parseSlashCommand } from "@/lib/chat/slash-commands";

export function ChatApp() {
  const currentChatId = useChatStore((s) => s.currentChatId);
  const messages = useChatStore((s) => (currentChatId ? s.messagesByChat[currentChatId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES));
  const newChat = useChatStore((s) => s.newChat);
  const loadChats = useChatStore((s) => s.load);
  const pendingQuestion = useChatStore((s) => (currentChatId ? s.pendingQuestionByChat[currentChatId] ?? null : null));
  const pendingPlan = useChatStore((s) => (currentChatId ? s.pendingPlanByChat[currentChatId] ?? null : null));
  const currentChatStreaming = useChatStore((s) => (currentChatId ? Boolean(s.streamingByChat[currentChatId]) : s.isStreaming));
  const chats = useChatStore((s) => s.chats);
  const setMessages = useChatStore((s) => s.setMessages);
  const selectChat = useChatStore((s) => s.selectChat);
  const upsertChat = useChatStore((s) => s.upsertChat);

  const loadProvider = useSettingsStore((s) => s.loadProvider);
  const fetchModels = useSettingsStore((s) => s.fetchModels);
  const model = useSettingsStore((s) => s.provider.model);
  const mode = useSettingsStore((s) => s.mode);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);

  const loadProjects = useProjectStore((s) => s.load);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);

  const panelOpen = useWorkspaceStore((s) => s.panelOpen);
  const panelChatId = useWorkspaceStore((s) => s.activeChatId);
  const panelWidth = useWorkspaceStore((s) => s.panelWidth);
  const setPanelWidth = useWorkspaceStore((s) => s.setPanelWidth);
  const lastReviewSignature = useRef("");
  const lastWorkspaceMutationSignature = useRef("");
  const workspaceRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const turnRunnerRef = useRef<Set<string>>(new Set());
  const handleRegenerateRef = useRef<((message: Message) => void) | null>(null);

  const { send, stop } = useChatStream();
  const queuedForCurrent = useChatStore((s) => (currentChatId ? s.queuedByChat[currentChatId] ?? EMPTY_QUEUED_MESSAGES : EMPTY_QUEUED_MESSAGES));

  // First-run bootstrap.
  useEffect(() => {
    // Apply persisted mode/auto prefs now (after mount) — the store starts at
    // deterministic defaults so SSR and the first client render match.
    useSettingsStore.getState().hydratePrefs();
    void (async () => {
      await loadProvider();
      await Promise.all([loadChats(), loadProjects()]);
      const { provider } = useSettingsStore.getState();
      if (provider.endpoint) await fetchModels();
      else setSettingsOpen(true);
    })();
  }, [loadProvider, loadChats, loadProjects, fetchModels, setSettingsOpen]);

  // Global keyboard shortcuts (Ctrl+, → Settings, Ctrl+I → Inventory, Ctrl+B → sidebar).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === ",") { e.preventDefault(); useUiStore.getState().setSettingsOpen(true); }
      if (ctrl && e.key === "i") { e.preventDefault(); useUiStore.getState().setInventoryOpen(true); }
      if (ctrl && e.key === "b") { e.preventDefault(); useUiStore.getState().toggleSidebar(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Sub-agent chats are intentionally hidden from the sidebar list. If one is
  // selected directly from a tool card, hydrate its parent/type metadata so the
  // shell can render the read-only trace state immediately.
  useEffect(() => {
    if (!currentChatId) return;
    if (chats.some((chat) => chat.id === currentChatId)) return;
    void selectChat(currentChatId);
  }, [currentChatId, chats, selectChat]);

  // Intercept workspace-file links anywhere in chat -> open in Workspace tab.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement)?.closest?.("a");
      const href = anchor?.getAttribute("href");
      if (!href) return;
      const m = /^(?:workspace-file:)(.*)$/.exec(href);
      if (!m) return;
      e.preventDefault();
      let path = m[1].replace(/^\/+/, "");
      try {
        path = decodeURIComponent(path);
      } catch {
        /* keep raw */
      }
      const ws = useWorkspaceStore.getState();
      const chat = useChatStore.getState().chats.find((item) => item.id === currentChatId);
      const workspaceChatId = chat?.parentId ?? currentChatId;
      if (workspaceChatId) ws.activate(workspaceChatId, "code");
      openWorkspacePath(path);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [currentChatId]);

  const currentChat = currentChatId ? chats.find((c) => c.id === currentChatId) : undefined;
  const looksLikeSubAgentTrace = Boolean(
    currentChatId && messages.some((message) => message.id === `${currentChatId}-user` || message.content.startsWith("Task:") && message.content.includes("Sub-agent type:")),
  );
  const isSubAgentChat = Boolean(currentChat?.parentId || currentChat?.type === "subagent" || looksLikeSubAgentTrace);
  const parentChat = currentChat?.parentId ? chats.find((c) => c.id === currentChat.parentId) : undefined;
  const fallbackMainChat = chats.find((chat) => chat.type !== "subagent" && chat.id !== currentChatId);
  const backTargetId = currentChat?.parentId ?? fallbackMainChat?.id;
  const workspaceChatId = currentChat?.parentId ?? currentChatId;
  const activeTurnMessage = messages.findLast((message) => message.role === "assistant" && (message.status === "streaming" || message.status === "complete"));
  const pendingBackgroundSubAgents = currentChatId && !isSubAgentChat ? collectPendingBackgroundSubAgents(messages) : [];
  const pendingBackgroundKey = pendingBackgroundSubAgents.join("|");

  useEffect(() => {
    if (!currentChatId || !isSubAgentChat) return;
    let active = true;

    const refreshSubAgentChat = async () => {
      try {
        const res = await fetch(`/api/chats/${currentChatId}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!active) return;
        const { messages: nextMessages, ...chat } = data;
        upsertChat(chat);
        setMessages(currentChatId, nextMessages);
      } catch {
        /* keep the current trace visible if polling misses */
      }
    };

    void refreshSubAgentChat();
    const interval = setInterval(refreshSubAgentChat, 1000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [currentChatId, isSubAgentChat, setMessages, upsertChat]);

  useEffect(() => {
    const ids = pendingBackgroundKey ? pendingBackgroundKey.split("|") : [];
    if (!currentChatId || isSubAgentChat || currentChatStreaming || ids.length === 0) return;
    let active = true;

    const refreshParentWhenSubAgentsMove = async () => {
      try {
        const statuses = await Promise.all(ids.map(readSubAgentStatus));
        const res = await fetch(`/api/chats/${currentChatId}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as Chat & { messages: Message[] };
        if (!active) return;
        const { messages: freshMessages, ...chat } = data;
        let nextMessages = freshMessages;
        const syntheticReports = statuses
          .filter((status) => isTerminalSubAgentStatus(status.status))
          .filter((status) => !nextMessages.some((message) => message.id === `${status.id}-parent-report`))
          .map((status) => makeSubAgentReportMessage(currentChatId, status, subAgentDescription(messages, status.id)));
        if (syntheticReports.length > 0) {
          nextMessages = [...nextMessages, ...syntheticReports];
          for (const report of syntheticReports) void persistSyntheticMessage(report);
        }
        if (statuses.some((status) => isTerminalSubAgentStatus(status.status))) {
          useWorkspaceStore.getState().bumpWorkspace();
        }
        upsertChat(chat);
        setMessages(currentChatId, nextMessages);
      } catch {
        /* background completion polling is best-effort */
      }
    };

    void refreshParentWhenSubAgentsMove();
    const interval = setInterval(refreshParentWhenSubAgentsMove, 2000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [currentChatId, currentChatStreaming, isSubAgentChat, pendingBackgroundKey, setMessages, upsertChat]);

  useEffect(() => {
    lastReviewSignature.current = "";
    lastWorkspaceMutationSignature.current = "";
  }, [workspaceChatId]);

  useEffect(() => {
    return () => {
      if (workspaceRefreshTimer.current) clearTimeout(workspaceRefreshTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!workspaceChatId) return;
    const diffs = latestFileDiffs(messages);
    if (diffs.length === 0) {
      if (lastReviewSignature.current) {
        lastReviewSignature.current = "";
        useWorkspaceStore.getState().setReviewDiffs([]);
      }
      return;
    }
    const signature = fileDiffSignature(diffs);
    if (signature === lastReviewSignature.current) return;
    lastReviewSignature.current = signature;
    const workspace = useWorkspaceStore.getState();
    workspace.setReviewDiffs(diffs);
    scheduleWorkspaceRefresh(workspaceRefreshTimer);
  }, [messages, workspaceChatId]);

  useEffect(() => {
    if (!workspaceChatId) return;
    const signature = workspaceMutationSignature(messages);
    if (!signature) return;
    if (signature === lastWorkspaceMutationSignature.current) return;
    lastWorkspaceMutationSignature.current = signature;
    scheduleWorkspaceRefresh(workspaceRefreshTimer);
  }, [messages, workspaceChatId]);

  const runTurnQueue = useCallback(
    (chatId: string, firstText: string) => {
      const trimmed = firstText.trim();
      if (!trimmed) return;
      if (turnRunnerRef.current.has(chatId)) {
        useChatStore.getState().enqueueQueuedMessage(chatId, trimmed);
        return;
      }

      turnRunnerRef.current.add(chatId);
      void (async () => {
        try {
          let nextText: string | null = trimmed;
          while (nextText) {
            const modelForTurn = useSettingsStore.getState().provider.model;
            await ensureDraftChatRoot(chatId, modelForTurn);
            await send(chatId, await expandForAgent(chatId, nextText));
            nextText = useChatStore.getState().popQueuedMessage(chatId)?.content ?? null;
          }
        } finally {
          turnRunnerRef.current.delete(chatId);
        }
      })();
    },
    [send],
  );

  useEffect(() => {
    if (!currentChatId || isSubAgentChat || currentChatStreaming || queuedForCurrent.length === 0 || turnRunnerRef.current.has(currentChatId)) return;
    const next = useChatStore.getState().popQueuedMessage(currentChatId);
    if (next) runTurnQueue(currentChatId, next.content);
  }, [currentChatId, currentChatStreaming, isSubAgentChat, queuedForCurrent.length, runTurnQueue]);

  const appendCommandMessage = useCallback((chatId: string, content: string, status: Message["status"] = "complete") => {
    const message: Message = {
      id: uid(),
      chatId,
      role: "system",
      content,
      blocks: [{ type: "text", content }],
      status,
      createdAt: Date.now(),
    };
    useChatStore.getState().addMessage(chatId, message);
    void persistSyntheticMessage(message);
    return message;
  }, []);

  const handleSend = useCallback((text: string) => {
    if (isSubAgentChat) return;
    let id = currentChatId;
    if (!id) id = newChat(model, activeProjectId ?? undefined);
    const slash = parseSlashCommand(text);
    if (slash) {
      void executeSlashCommand({ chatId: id, slash, runTurnQueue, stop, appendCommandMessage, handleRegenerate: (message) => handleRegenerateRef.current?.(message) });
      return;
    }
    const store = useChatStore.getState();
    if (turnRunnerRef.current.has(id) || store.streamingByChat[id]) {
      store.enqueueQueuedMessage(id, text);
      return;
    }
    runTurnQueue(id, text);
  }, [activeProjectId, appendCommandMessage, currentChatId, isSubAgentChat, model, newChat, runTurnQueue, stop]);

  const handleRegenerate = useCallback(
    (message: Message) => {
      if (isSubAgentChat) return;
      const store = useChatStore.getState();
      if (store.streamingByChat[message.chatId] || turnRunnerRef.current.has(message.chatId)) return;
      const list = store.messages(message.chatId);
      const messageIndex = list.findIndex((item) => item.id === message.id);
      if (messageIndex <= 0) return;
      const previousUser = list.slice(0, messageIndex).findLast((item) => item.role === "user");
      if (!previousUser) return;

      void (async () => {
        try {
          await store.rollbackToMessage(message.chatId, previousUser.id, previousUser.createdAt);
          useChatStore.getState().setDraft(message.chatId, null);
          runTurnQueue(message.chatId, previousUser.content);
        } catch (err) {
          console.error(err);
        }
      })();
    },
    [isSubAgentChat, runTurnQueue],
  );

  useEffect(() => {
    handleRegenerateRef.current = handleRegenerate;
  }, [handleRegenerate]);

  const handleQuestionAnswer = useCallback((question: PendingQuestion, answer: string) => {
    if (question.id.startsWith("permission:")) {
      handleSend(`Permission response: ${answer}\nRequest id: ${question.id}`);
      return;
    }
    handleSend(answer);
  }, [handleSend]);

  const handleAttach = async (files: File[]): Promise<UploadedAttachment[]> => {
    let id = currentChatId;
    if (!id) id = newChat(model, activeProjectId ?? undefined);
    await ensureDraftChatRoot(id, model);
    const form = new FormData();
    form.append("chatId", id);
    for (const file of files) form.append("files", file);
    const res = await fetch("/api/workspace/upload", { method: "POST", body: form });
    const data = (await res.json()) as { uploaded?: UploadedAttachment[]; error?: string };
    if (!res.ok) throw new Error(data.error || `Upload failed: ${res.status}`);
    const uploaded = data.uploaded ?? [];
    if (uploaded.length > 0) useWorkspaceStore.getState().bumpWorkspace();
    const first = uploaded[0]?.path;
    if (first) {
      const folder = first.split("/").slice(0, -1).join("/");
      useWorkspaceStore.getState().activate(id, "code");
      openWorkspacePath(folder || first);
    }
    return uploaded;
  };

  const showWelcome = !currentChatId || (messages.length === 0 && !isSubAgentChat);
  const showPanel = panelOpen && panelChatId === workspaceChatId && !!workspaceChatId;
  const { mounted: panelMounted, closing: panelClosing } = useMountTransition(showPanel, 200);
  const showWorkspaceHandle = Boolean(workspaceChatId && !showPanel && !panelClosing);

  return (
    <div data-mode={mode} suppressHydrationWarning className="mode-root flex h-screen overflow-hidden bg-[var(--ui-bg-chrome)] text-foreground">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <div className="flex min-h-0 flex-1 bg-[var(--ui-bg-chrome)]">
          <div className="flex min-w-0 flex-1 flex-col">
            {showWelcome ? (
              <WelcomeScreen chatId={currentChatId} onSend={handleSend} onStop={() => currentChatId && stop(currentChatId)} onAttach={handleAttach} />
            ) : (
              <>
                <MessageList chatId={currentChatId!} onRegenerate={handleRegenerate} />
                <TurnStatusLine message={activeTurnMessage} />
                {pendingPlan && pendingPlan.chatId === currentChatId && (
                  <PlanCard
                    plan={pendingPlan}
                    workspaceChatId={currentChatId!}
                    onApprove={() => handleSend(planApprovalMessage(pendingPlan.file))}
                    onRequestChanges={(feedback) => handleSend(planRevisionMessage(feedback))}
                  />
                )}
                {pendingQuestion && pendingQuestion.chatId === currentChatId && !pendingPlan && (
                  <QuestionCard question={pendingQuestion} onAnswer={(answer) => handleQuestionAnswer(pendingQuestion, answer)} />
                )}
                {isSubAgentChat ? (
                  <SubAgentReadOnlyBar
                    parentTitle={parentChat?.title || "main chat"}
                    onBack={() => backTargetId && void selectChat(backTargetId)}
                    canGoBack={Boolean(backTargetId)}
                    onStop={() => currentChatId && void fetch(`/api/subagents/${currentChatId}`, { method: "DELETE" })}
                  />
                ) : (
                  <Composer
                    chatId={currentChatId}
                    onSend={handleSend}
                    onStop={() => currentChatId && stop(currentChatId)}
                    onAttach={handleAttach}
                  />
                )}
              </>
            )}
          </div>
          {panelMounted && workspaceChatId && (
            <>
              <div
                className="group hidden w-2 cursor-col-resize bg-transparent lg:block"
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  const startX = event.clientX;
                  const startWidth = panelWidth;
                  const onMove = (moveEvent: PointerEvent) => setPanelWidth(startWidth - (moveEvent.clientX - startX));
                  const onUp = () => {
                    window.removeEventListener("pointermove", onMove);
                    window.removeEventListener("pointerup", onUp);
                  };
                  window.addEventListener("pointermove", onMove);
                  window.addEventListener("pointerup", onUp, { once: true });
                }}
                title="Resize workspace panel"
              >
                <div className="h-full w-px bg-[var(--ui-stroke-tertiary)] transition-colors group-hover:bg-[var(--ui-stroke-primary)]" />
              </div>
              <div className={cn("hidden min-w-[360px] max-w-[72vw] border-l border-[var(--ui-stroke-tertiary)] lg:block", panelClosing ? "animate-panel-out" : "animate-panel-in")} style={{ width: panelWidth }}>
                <WorkspacePanel chatId={workspaceChatId} />
              </div>
            </>
          )}
        </div>
      </div>
      {showWorkspaceHandle && <WorkspaceHandle chatId={workspaceChatId!} />}
      <SettingsDialog />
      <InventoryDialog />
    </div>
  );
}

async function ensureDraftChatRoot(chatId: string, model: string): Promise<void> {
  const chatStore = useChatStore.getState();
  if (chatStore.messages(chatId).length > 0) return;

  const projectId = useProjectStore.getState().activeProjectId ?? null;
  const chat = chatStore.chats.find((item) => item.id === chatId);
  if ((chat?.projectId ?? null) !== projectId) await chatStore.setChatProject(chatId, projectId);

  const res = await fetch("/api/chats", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: chatId, title: chat?.title || "New Chat", model: chat?.model || model, projectId: projectId ?? undefined }),
  });
  if (!res.ok) throw new Error(`Failed to persist chat root: ${res.status}`);
}

async function expandForAgent(chatId: string, text: string): Promise<string> {
  if (text.includes("Referenced workspace context:")) return text;
  try {
    return await expandWorkspaceReferences(chatId, text);
  } catch {
    return text;
  }
}

async function executeSlashCommand({
  chatId,
  slash,
  runTurnQueue,
  stop,
  appendCommandMessage,
}: {
  chatId: string;
  slash: NonNullable<ReturnType<typeof parseSlashCommand>>;
  runTurnQueue: (chatId: string, text: string) => void;
  stop: (chatId?: string) => void;
  appendCommandMessage: (chatId: string, content: string, status?: Message["status"]) => Message;
  handleRegenerate?: (message: Message) => void;
}) {
  const command = slash.command;
  if (!command) {
    appendCommandMessage(chatId, `Unknown command \`/${slash.name}\`.\n\n${formatSlashHelp()}`, "error");
    return;
  }

  const store = useChatStore.getState();
  const settings = useSettingsStore.getState();
  const name = command.name;
  const arg = slash.arg.trim();

  switch (name) {
    case "help":
      appendCommandMessage(chatId, formatSlashHelp());
      return;

    case "status":
      appendCommandMessage(chatId, statusReport(chatId));
      return;

    case "stop":
      stop(chatId);
      appendCommandMessage(chatId, "Stopping the current turn. Queued prompts are preserved.");
      return;

    case "clear-queue":
      store.clearQueuedMessages(chatId);
      appendCommandMessage(chatId, "Cleared queued prompts for this chat.");
      return;

    case "copy": {
      const n = Math.max(1, Number.parseInt(arg || "1", 10) || 1);
      const assistantMessages = store.messages(chatId).filter((message) => message.role === "assistant" && message.content.trim()).reverse();
      const target = assistantMessages[n - 1];
      if (!target) {
        appendCommandMessage(chatId, `No assistant response found for /copy ${n}.`, "error");
        return;
      }
      await navigator.clipboard.writeText(target.content);
      appendCommandMessage(chatId, `Copied assistant response ${n === 1 ? "latest" : `#${n}`} to clipboard.`);
      return;
    }

    case "title": {
      if (!arg) {
        appendCommandMessage(chatId, "Usage: `/title <name>`", "error");
        return;
      }
      store.setChatTitle(chatId, arg);
      await fetch(`/api/chats/${chatId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: arg }) }).catch(() => null);
      appendCommandMessage(chatId, `Renamed chat to **${arg}**.`);
      return;
    }

    case "mode": {
      if (!arg) {
        appendCommandMessage(chatId, `Current mode: **${settings.mode}**. Auto mode: **${settings.autoMode ? "on" : "off"}**.`);
        return;
      }
      const next = arg.toLowerCase();
      if (next === "auto") {
        settings.setAutoMode(true);
        appendCommandMessage(chatId, "Auto mode enabled. VaultGate can switch capabilities when needed.");
        return;
      }
      if (!["agent", "code", "chat"].includes(next)) {
        appendCommandMessage(chatId, "Usage: `/mode agent|code|chat|auto`", "error");
        return;
      }
      settings.setMode(next as ChatMode);
      settings.setAutoMode(false);
      appendCommandMessage(chatId, `Mode set to **${next}** and Auto mode disabled.`);
      return;
    }

    case "think": {
      const next = arg.toLowerCase();
      if (!next || next === "status") {
        appendCommandMessage(chatId, `Deep Think is **${settings.features.deepThink ? "on" : "off"}**.`);
        return;
      }
      if (!["on", "off"].includes(next)) {
        appendCommandMessage(chatId, "Usage: `/think on|off|status`", "error");
        return;
      }
      settings.setFeature("deepThink", next === "on");
      appendCommandMessage(chatId, `Deep Think turned **${next}**.`);
      return;
    }

    case "permissions": {
      const next = arg.toLowerCase().replace(/\s+/g, "-");
      const modes: PermissionMode[] = ["auto-safe", "ask", "auto-approve", "read-only"];
      if (!next || next === "status") {
        appendCommandMessage(chatId, `Permission mode: **${settings.approval.mode}**\n\nAllowed values: ${modes.map((item) => `\`${item}\``).join(", ")}.`);
        return;
      }
      if (!modes.includes(next as PermissionMode)) {
        appendCommandMessage(chatId, "Usage: `/permissions auto-safe|ask|auto-approve|read-only|status`", "error");
        return;
      }
      settings.setApproval("mode", next as PermissionMode);
      appendCommandMessage(chatId, `Permission mode set to **${next}**.`);
      return;
    }

    case "queue": {
      if (!arg) {
        appendCommandMessage(chatId, "Usage: `/queue <prompt>`", "error");
        return;
      }
      store.enqueueQueuedMessage(chatId, await expandForAgent(chatId, arg));
      appendCommandMessage(chatId, `Queued prompt ${store.queuedByChat[chatId]?.length ?? 1}.`);
      return;
    }

    case "steer": {
      if (!arg) {
        appendCommandMessage(chatId, "Usage: `/steer <note>`", "error");
        return;
      }
      const note = await expandForAgent(chatId, arg);
      if (store.streamingByChat[chatId]) {
        const res = await fetch("/api/chat/steer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId, note }) });
        if (!res.ok) appendCommandMessage(chatId, "Could not steer the active turn. Queuing it as a follow-up instead.", "error");
        else appendCommandMessage(chatId, "Steering note injected into the active turn.");
        if (!res.ok) store.enqueueQueuedMessage(chatId, note);
      } else {
        store.enqueueQueuedMessage(chatId, note);
        appendCommandMessage(chatId, "No active turn. Queued the note for the next prompt.");
      }
      return;
    }

    case "btw": {
      if (!arg) {
        appendCommandMessage(chatId, "Usage: `/btw <question>`", "error");
        return;
      }
      void runSideQuestion(chatId, await expandForAgent(chatId, arg), arg);
      return;
    }

    case "background": {
      if (!arg) {
        appendCommandMessage(chatId, "Usage: `/background <prompt>` or `/bg <prompt>`", "error");
        return;
      }
      await ensureDraftChatRoot(chatId, settings.provider.model);
      const prompt = await expandForAgent(chatId, arg);
      const res = await fetch("/api/subagents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId, prompt, description: arg }) });
      const data = (await res.json()) as { id?: string; result?: string; error?: string };
      appendCommandMessage(chatId, res.ok ? `Background task started: **${arg.slice(0, 120)}**` : `Background task failed: ${data.error || res.status}`, res.ok ? "complete" : "error");
      return;
    }

    case "plan": {
      if (!arg) {
        appendCommandMessage(chatId, "Usage: `/plan <goal>`", "error");
        return;
      }
      settings.setFeature("planFirst", true);
      runTurnQueue(chatId, await expandForAgent(chatId, arg));
      return;
    }

    case "retry": {
      const last = store.messages(chatId).findLast((message) => message.role === "assistant");
      if (!last) {
        appendCommandMessage(chatId, "Nothing to retry yet.", "error");
        return;
      }
      await retryAssistantMessage(chatId, last, runTurnQueue, appendCommandMessage);
      return;
    }

    case "rewind": {
      await rewindCommand(chatId, arg, runTurnQueue, appendCommandMessage);
      return;
    }

    case "compact": {
      appendCommandMessage(chatId, "Context compaction will run at the start of the next agent turn. The oldest tool outputs will be summarized to free up context space.");
      return;
    }

    case "stats": {
      const msgs = store.messages(chatId);
      const userCount = msgs.filter((m) => m.role === "user").length;
      const assistantCount = msgs.filter((m) => m.role === "assistant").length;
      let toolCalls = 0;
      let durationMs = 0;
      for (const m of msgs) {
        if (m.durationMs) durationMs += m.durationMs;
        for (const b of m.blocks) {
          if (b.type === "tool_calls") toolCalls += b.toolCalls?.length ?? 0;
        }
      }
      const elapsed = durationMs > 60000 ? `${(durationMs / 60000).toFixed(1)}m` : `${(durationMs / 1000).toFixed(1)}s`;
      appendCommandMessage(chatId, `**Session Stats**\n\n- Messages: ${msgs.length} (${userCount} user, ${assistantCount} assistant)\n- Tool calls: ${toolCalls}\n- Agent time: ${elapsed}\n\nOpen **Settings → Stats** for detailed breakdowns.`);
      return;
    }

    case "export": {
      const msgs = store.messages(chatId);
      const lines = msgs.map((m) => `## ${m.role} (${new Date(m.createdAt).toLocaleString()})\n\n${m.content}`);
      const md = lines.join("\n\n---\n\n");
      await navigator.clipboard.writeText(md);
      appendCommandMessage(chatId, `Exported ${msgs.length} messages to clipboard as markdown.`);
      return;
    }

    case "doctor": {
      const provider = settings.provider;
      const diag: string[] = ["**VaultGate Diagnostics**\n"];
      diag.push(`- Endpoint: ${provider.endpoint || "❌ not configured"}`);
      diag.push(`- API key: ${provider.keySet ? "✓ set" : "❌ not set"}`);
      diag.push(`- Model: ${provider.model || "❌ not selected"}`);
      diag.push(`- Mode: ${settings.mode} (auto: ${settings.autoMode ? "on" : "off"})`);
      diag.push(`- Deep Think: ${settings.features.deepThink ? "on" : "off"}`);
      diag.push(`- Web Search: ${settings.features.webSearch ? "on" : "off"}`);
      diag.push(`- Auto Improve: ${settings.features.autoImprove ? "on" : "off"}`);
      diag.push(`- Plan First: ${settings.features.planFirst ? "on" : "off"}`);
      diag.push(`- Permission mode: ${settings.approval.mode}`);
      if (!provider.endpoint || !provider.keySet) {
        diag.push("\n⚠️ **Provider not fully configured.** Open Settings → Providers to add an endpoint and API key.");
      } else if (!provider.model) {
        diag.push("\n⚠️ **No model selected.** Open Settings → Providers and fetch models.");
      } else {
        diag.push("\n✓ Ready to go.");
      }
      appendCommandMessage(chatId, diag.join("\n"));
      return;
    }

    case "settings": {
      useUiStore.getState().setSettingsOpen(true);
      return;
    }

    case "inventory": {
      useUiStore.getState().setInventoryOpen(true);
      return;
    }
  }
}

async function retryAssistantMessage(chatId: string, message: Message, runTurnQueue: (chatId: string, text: string) => void, appendCommandMessage: (chatId: string, content: string, status?: Message["status"]) => Message) {
  const store = useChatStore.getState();
  if (store.streamingByChat[chatId]) {
    appendCommandMessage(chatId, "Cannot retry while this chat is already streaming. Stop or wait first.", "error");
    return;
  }
  const list = store.messages(chatId);
  const index = list.findIndex((item) => item.id === message.id);
  const previousUser = list.slice(0, index).findLast((item) => item.role === "user");
  if (!previousUser) {
    appendCommandMessage(chatId, "Could not find the user prompt for that response.", "error");
    return;
  }
  await store.rollbackToMessage(chatId, previousUser.id, previousUser.createdAt);
  store.setDraft(chatId, null);
  runTurnQueue(chatId, previousUser.content);
}

async function rewindCommand(chatId: string, arg: string, runTurnQueue: (chatId: string, text: string) => void, appendCommandMessage: (chatId: string, content: string, status?: Message["status"]) => Message) {
  const store = useChatStore.getState();
  const userMessages = store.messages(chatId).filter((message) => message.role === "user").reverse();
  if (!arg) {
    if (userMessages.length === 0) {
      appendCommandMessage(chatId, "No checkpoints yet. Send a message first.", "error");
      return;
    }
    appendCommandMessage(chatId, ["Rewind checkpoints", "", ...userMessages.slice(0, 8).map((message, index) => `${index + 1}. \`${clipLine(message.content, 90)}\``), "", "Run `/rewind <number>` to restore conversation and workspace to that prompt. The prompt will be placed back in the composer."].join("\n"));
    return;
  }
  const index = Math.max(1, Number.parseInt(arg, 10) || 0) - 1;
  const target = userMessages[index];
  if (!target) {
    appendCommandMessage(chatId, "Invalid rewind number. Run `/rewind` to list checkpoints.", "error");
    return;
  }
  await store.rollbackToMessage(chatId, target.id, target.createdAt);
  store.setDraft(chatId, target.content);
  appendCommandMessage(chatId, `Rewound to: \`${clipLine(target.content, 120)}\`\n\nThe prompt is back in the composer. Edit it or send again.`);
  void runTurnQueue;
}

async function runSideQuestion(chatId: string, prompt: string, label: string) {
  const store = useChatStore.getState();
  const settings = useSettingsStore.getState();
  const model = settings.provider.model;
  if (!model) {
    const content = "Cannot run /btw: no model selected.";
    const message: Message = { id: uid(), chatId, role: "system", content, blocks: [{ type: "text", content }], status: "error", createdAt: Date.now() };
    store.addMessage(chatId, message);
    void persistSyntheticMessage(message);
    return;
  }

  const messageId = uid();
  const displayLabel = `/btw ${label}`;
  const message: Message = {
    id: messageId,
    chatId,
    role: "system",
    content: `${displayLabel}\n\nAnswering...`,
    blocks: [{ type: "text", content: `${displayLabel}\n\nAnswering...` }],
    status: "streaming",
    model,
    createdAt: Date.now(),
  };
  store.addMessage(chatId, message);

  const history = store
    .messages(chatId)
    .filter((item) => item.role === "user" || item.role === "assistant")
    .slice(-12)
    .map((item) => ({ role: item.role, content: item.content }));
  const body: ChatRequest = {
    chatId,
    model,
    messages: [...history, { role: "user", content: `Side question. Answer briefly and do not modify files unless explicitly asked:\n\n${prompt}` }],
    features: { ...settings.features, deepThink: false },
    mode: "chat",
    auto: false,
    approval: settings.approval,
  };
  const builder = new BlockBuilder();
  let errored = false;
  try {
    const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    await readEventStream(res, (event: StreamEvent) => {
      if (event.type === "delta") builder.appendText(event.text);
      if (event.type === "reasoning") builder.appendReasoning(event.text);
      if (event.type === "error") {
        builder.appendText(`Error: ${event.message}`);
        errored = true;
      }
      const content = sanitizeToolLeakText(builder.plain());
      store.patchMessage(chatId, messageId, { content: content ? `${displayLabel}\n\n${content}` : `${displayLabel}\n\nAnswering...`, blocks: sideQuestionBlocks(label, builder) });
    });
  } catch (err) {
    builder.appendText(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    errored = true;
  } finally {
    const content = sanitizeToolLeakText(builder.plain()) || "No side answer returned.";
    const finalMsg: Message = { ...message, content: `${displayLabel}\n\n${content}`, blocks: sideQuestionBlocks(label, builder), status: errored ? "error" : "complete" };
    store.patchMessage(chatId, messageId, { content: finalMsg.content, blocks: finalMsg.blocks, status: finalMsg.status });
    void persistSyntheticMessage(finalMsg);
  }
}

function sideQuestionBlocks(label: string, builder: BlockBuilder) {
  const blocks = sanitizeToolLeakBlocks(builder.snapshot());
  const prefix = { type: "text" as const, content: `/btw ${label}` };
  return blocks.length > 0 ? [prefix, ...blocks] : [prefix];
}

function statusReport(chatId: string): string {
  const store = useChatStore.getState();
  const settings = useSettingsStore.getState();
  const messages = store.messages(chatId);
  const queued = store.queuedByChat[chatId]?.length ?? 0;
  const activeTools = messages.findLast((message) => message.status === "streaming")?.blocks.flatMap((block) => block.toolCalls ?? []).length ?? 0;
  const diffs = latestFileDiffs(messages).slice(0, 8);
  return [
    "VaultGate status",
    "",
    `- Mode: ${settings.autoMode ? `auto (${settings.mode})` : settings.mode}`,
    `- Permission mode: ${settings.approval.mode}`,
    `- Model: ${settings.provider.model || "not selected"}`,
    `- Streaming: ${store.streamingByChat[chatId] ? "yes" : "no"}`,
    `- Queued prompts: ${queued}`,
    `- Active tool calls in latest turn: ${activeTools}`,
    `- Messages: ${messages.length}`,
    diffs.length ? `- Recent changed files: ${diffs.map((diff) => diff.filePath).join(", ")}` : "- Recent changed files: none detected",
  ].join("\n");
}

function clipLine(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit - 3)}...` : clean;
}

function openWorkspacePath(path: string) {
  const emit = () => {
    window.dispatchEvent(new CustomEvent("vaultgate:open-workspace-path", { detail: path }));
    window.dispatchEvent(new CustomEvent("vaultgate:open-file", { detail: path }));
  };
  emit();
  window.setTimeout(emit, 50);
}

function SubAgentReadOnlyBar({ parentTitle, onBack, canGoBack, onStop }: { parentTitle: string; onBack: () => void; canGoBack: boolean; onStop: () => void }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-3">
      <div className="flex min-h-20 items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-sm shadow-sm">
        <div className="flex min-w-0 items-center gap-3 text-muted-foreground">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted/40">
            <LockKeyhole className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-foreground">Cannot send message to subagent.</p>
            <p className="mt-0.5 truncate text-xs">This is a read-only trace. Back keeps it running and returns to {parentTitle}.</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={onBack}
            disabled={!canGoBack}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
          >
            <ArrowLeft className="size-3.5" />
            Back to main chat
          </button>
          <button
            onClick={onStop}
            className="flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs font-medium text-red-300/80 transition-colors hover:bg-red-500/10 hover:text-red-200"
            title="Cancel this sub-agent run"
          >
            <Square className="size-3 fill-current" />
            Cancel run
          </button>
        </div>
      </div>
    </div>
  );
}

function scheduleWorkspaceRefresh(timer: MutableRefObject<ReturnType<typeof setTimeout> | null>) {
  if (timer.current) clearTimeout(timer.current);
  timer.current = setTimeout(() => {
    useWorkspaceStore.getState().bumpWorkspace();
    timer.current = null;
  }, 300);
}

function latestFileDiffs(messages: Message[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant") continue;
    const diffs = getMessageFileDiffs(message.blocks);
    if (diffs.length > 0) return diffs;
  }
  return [];
}

function fileDiffSignature(diffs: ReturnType<typeof latestFileDiffs>): string {
  return diffs
    .map((diff) => `${diff.filePath}:${diff.stats.added}:${diff.stats.removed}:${diff.hunks.map((hunk) => `${hunk.old.length},${hunk.next.length}`).join(";")}`)
    .join("|");
}

function workspaceMutationSignature(messages: Message[]): string {
  const parts: string[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const block of message.blocks) {
      if (block.type !== "tool_calls") continue;
      for (const call of block.toolCalls ?? []) {
        const name = normalizeToolName(call.name);
        if (!["write", "edit", "multiedit", "applypatch", "delete", "move", "bash"].includes(name)) continue;
        const result = block.results?.find((item) => item.toolCallId === call.id);
        parts.push(`${call.id}:${name}:${result?.status ?? "queued"}:${result?.content.length ?? 0}`);
      }
    }
  }
  return parts.join("|");
}

function collectPendingBackgroundSubAgents(messages: Message[]): string[] {
  const reports = new Set(messages.map((message) => message.id));
  const ids: string[] = [];
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.type !== "tool_calls") continue;
      for (const call of block.toolCalls ?? []) {
        const name = call.name.replace(/^functions\./i, "").toLowerCase();
        if (name !== "task") continue;
        if (reports.has(`${call.id}-parent-report`)) continue;
        const result = block.results?.find((item) => item.toolCallId === call.id);
        if (!result || result.status === "running" || result.content.includes("Started sub-agent in background")) ids.push(call.id);
      }
    }
  }
  return ids;
}

type SubAgentStatus = {
  id: string;
  status: string;
  result?: string;
  error?: string;
};

async function readSubAgentStatus(id: string): Promise<SubAgentStatus> {
  try {
    const res = await fetch(`/api/subagents/${id}`, { cache: "no-store" });
    if (!res.ok) return { id, status: "unreachable" };
    const data = (await res.json()) as Partial<SubAgentStatus>;
    return { id, status: String(data.status || "unknown"), result: data.result, error: data.error };
  } catch {
    return { id, status: "unreachable" };
  }
}

function isTerminalSubAgentStatus(status: string): boolean {
  return status === "completed" || status === "error" || status === "cancelled" || status === "timeout" || status === "unknown";
}

function subAgentDescription(messages: Message[], id: string): string {
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.type !== "tool_calls") continue;
      const call = block.toolCalls?.find((item) => item.id === id);
      if (!call) continue;
      try {
        const args = JSON.parse(call.arguments || "{}") as { description?: unknown };
        if (typeof args.description === "string" && args.description.trim()) return args.description.trim();
      } catch {
        /* fall through to generic label */
      }
    }
  }
  return "sub-agent";
}

function makeSubAgentReportMessage(parentChatId: string, status: SubAgentStatus, description: string): Message {
  const label = status.status === "completed" ? "finished" : status.status === "timeout" ? "timed out" : status.status === "cancelled" ? "was stopped" : "failed";
  const result = subAgentResultText(status);
  const content = `Sub-agent ${label}: ${description}\n\n${result}`;
  return {
    id: `${status.id}-parent-report`,
    chatId: parentChatId,
    role: "assistant",
    content,
    blocks: [{ type: "text", content }],
    status: status.status === "completed" ? "complete" : "error",
    createdAt: Date.now(),
  };
}

function subAgentResultText(status: SubAgentStatus): string {
  if (status.result?.trim()) return status.result.trim();
  if (status.error?.trim()) return status.error.trim();
  if (status.status === "completed") return "Sub-agent finished but did not provide a report.";
  if (status.status === "cancelled") return "Sub-agent was stopped before it could provide a report.";
  if (status.status === "timeout") return "Sub-agent timed out before it could provide a report.";
  if (status.status === "unknown") return "Sub-agent stopped or disappeared before producing a report. This can happen after a server restart or cancellation before finalization.";
  return "Sub-agent failed before producing a report.";
}

async function persistSyntheticMessage(message: Message): Promise<void> {
  await fetch(`/api/chats/${message.chatId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  }).catch(() => {});
}
