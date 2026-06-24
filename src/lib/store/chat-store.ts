"use client";
import { create } from "zustand";
import type { Chat, ChatWithMessages, ContentBlock, Message, PendingPlan, PendingQuestion, QueuedMessage } from "@/types";
import { uid } from "@/lib/utils";
import { useWorkspaceStore } from "@/lib/store/workspace-store";
import { sanitizeAssistantMessage } from "@/lib/ai/tool-leak-sanitizer";

interface ChatState {
  chats: Chat[];
  messagesByChat: Record<string, Message[]>;
  currentChatId: string | null;
  isStreaming: boolean;
  streamingByChat: Record<string, boolean>;
  pendingQuestion: PendingQuestion | null;
  pendingPlan: PendingPlan | null;
  draftByChat: Record<string, string>;
  queuedByChat: Record<string, QueuedMessage[]>;

  load: () => Promise<void>;
  selectChat: (id: string) => Promise<void>;
  beginNewChat: () => void;
  newChat: (model: string, projectId?: string) => string;
  deleteChat: (id: string) => Promise<void>;
  upsertChat: (chat: Chat) => void;

  addMessage: (chatId: string, message: Message) => void;
  setMessages: (chatId: string, messages: Message[]) => void;
  /**
   * Replace a single message, preserving the refs of every other
   * message so memoized bubbles never re-render mid-stream.
   */
  patchMessage: (chatId: string, id: string, patch: Partial<Message>) => void;
  rollbackToMessage: (chatId: string, messageId: string, createdAt: number) => Promise<void>;
  setStreaming: (chatId: string, streaming: boolean) => void;
  setChatTitle: (chatId: string, title: string) => void;
  setChatProject: (chatId: string, projectId: string | null) => Promise<void>;
  setPendingQuestion: (question: PendingQuestion | null) => void;
  setPendingPlan: (plan: PendingPlan | null) => void;
  setDraft: (chatId: string, value: string | null) => void;
  enqueueQueuedMessage: (chatId: string, content: string) => QueuedMessage | null;
  updateQueuedMessage: (chatId: string, id: string, content: string) => void;
  removeQueuedMessage: (chatId: string, id: string) => void;
  promoteQueuedMessage: (chatId: string, id: string) => void;
  popQueuedMessage: (chatId: string) => QueuedMessage | null;
  clearQueuedMessages: (chatId: string) => void;

  messages: (chatId: string) => Message[];
}

export const EMPTY_MESSAGES: Message[] = [];
export const EMPTY_QUEUED_MESSAGES: QueuedMessage[] = [];

function upsertChatList(chats: Chat[], chat: Chat): Chat[] {
  const existing = chats.findIndex((c) => c.id === chat.id);
  if (existing === -1) return chat.type === "subagent" ? [...chats, chat] : [chat, ...chats];
  return chats.map((c) => {
    if (c.id !== chat.id) return c;
    return {
      ...c,
      ...chat,
      parentId: chat.parentId ?? c.parentId,
      type: c.type === "subagent" && chat.type !== "subagent" ? "subagent" : chat.type ?? c.type,
    };
  });
}

export const useChatStore = create<ChatState>((set, get) => ({
  chats: [],
  messagesByChat: {},
  currentChatId: null,
  isStreaming: false,
  streamingByChat: {},
  pendingQuestion: null,
  pendingPlan: null,
  draftByChat: {},
  queuedByChat: {},

  load: async () => {
    try {
      const res = await fetch("/api/chats", { cache: "no-store" });
      if (!res.ok) return;
      const chats = (await res.json()) as Chat[];
      set({ chats });
    } catch {
      /* first run */
    }
  },

  selectChat: async (id) => {
    set({ currentChatId: id });
    const knownChat = get().chats.some((chat) => chat.id === id);
    const knownMessages = Boolean(get().messagesByChat[id]);
    if (knownChat && knownMessages) return;
    try {
      const res = await fetch(`/api/chats/${id}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as ChatWithMessages;
      const { messages, ...rawChat } = data;
      const isSubAgentTrace = messages.some((message) => message.id === `${id}-user` || (message.content.startsWith("Task:") && message.content.includes("Sub-agent type:")));
      const chat = isSubAgentTrace ? { ...rawChat, type: "subagent" } : rawChat;
      set((s) => ({ chats: upsertChatList(s.chats, chat), messagesByChat: { ...s.messagesByChat, [id]: messages.map(sanitizeAssistantMessage) } }));
    } catch {
      /* ignore */
    }
  },

  beginNewChat: () => set({ currentChatId: null, pendingQuestion: null, pendingPlan: null }),

  upsertChat: (chat) => set((s) => ({ chats: upsertChatList(s.chats, chat) })),

  newChat: (model, projectId) => {
    const id = uid();
    const now = Date.now();
    const chat: Chat = { id, title: "New Chat", model, projectId, createdAt: now, updatedAt: now };
    set((s) => ({
      chats: [chat, ...s.chats],
      messagesByChat: { ...s.messagesByChat, [id]: [] },
      currentChatId: id,
    }));
    void fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, title: chat.title, model, projectId }),
    }).catch(() => {});
    return id;
  },

  deleteChat: async (id) => {
    const previous = {
      chats: get().chats,
      messagesByChat: get().messagesByChat,
      currentChatId: get().currentChatId,
      draftByChat: get().draftByChat,
      queuedByChat: get().queuedByChat,
    };
    set((s) => {
      const deletedIds = new Set(s.chats.filter((c) => c.id === id || c.parentId === id).map((c) => c.id));
      deletedIds.add(id);
      const chats = s.chats.filter((c) => !deletedIds.has(c.id));
      const messagesByChat = { ...s.messagesByChat };
      const draftByChat = { ...s.draftByChat };
      const queuedByChat = { ...s.queuedByChat };
      for (const deletedId of deletedIds) delete messagesByChat[deletedId];
      for (const deletedId of deletedIds) {
        delete draftByChat[deletedId];
        delete queuedByChat[deletedId];
      }
      const currentChatId = s.currentChatId && deletedIds.has(s.currentChatId) ? (chats[0]?.id ?? null) : s.currentChatId;
      return { chats, messagesByChat, currentChatId, draftByChat, queuedByChat };
    });
    try {
      const res = await fetch(`/api/chats/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      useWorkspaceStore.getState().forgetChat(id);
    } catch (error) {
      set(previous);
      throw error;
    }
  },

  addMessage: (chatId, message) =>
    set((s) => ({
      messagesByChat: { ...s.messagesByChat, [chatId]: [...(s.messagesByChat[chatId] ?? []), sanitizeAssistantMessage(message)] },
    })),

  setMessages: (chatId, messages) =>
    set((s) => ({
      messagesByChat: { ...s.messagesByChat, [chatId]: messages.map(sanitizeAssistantMessage) },
    })),

  patchMessage: (chatId, id, patch) =>
    set((s) => {
      const list = s.messagesByChat[chatId] ?? [];
      return {
        messagesByChat: {
          ...s.messagesByChat,
          [chatId]: list.map((m) => (m.id === id ? sanitizeAssistantMessage({ ...m, ...patch }) : m)),
        },
      };
    }),

  rollbackToMessage: async (chatId, messageId, createdAt) => {
    const previous = get().messagesByChat[chatId] ?? [];
    set((s) => ({
      messagesByChat: {
        ...s.messagesByChat,
        [chatId]: previous.filter((message) => message.createdAt < createdAt),
      },
    }));
    try {
      const res = await fetch(`/api/chats/${chatId}/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, createdAt }),
      });
      const data = (await res.json()) as { messages?: Message[]; error?: string };
      if (!res.ok) throw new Error(data.error || `Rollback failed: ${res.status}`);
      set((s) => ({ messagesByChat: { ...s.messagesByChat, [chatId]: (data.messages ?? []).map(sanitizeAssistantMessage) } }));
      const workspace = useWorkspaceStore.getState();
      workspace.clearTerminal(chatId);
      workspace.setReviewDiffs([]);
      workspace.bumpWorkspace();
    } catch (error) {
      set((s) => ({ messagesByChat: { ...s.messagesByChat, [chatId]: previous } }));
      throw error;
    }
  },

  setStreaming: (chatId, streaming) =>
    set((s) => {
      const streamingByChat = { ...s.streamingByChat };
      if (streaming) streamingByChat[chatId] = true;
      else delete streamingByChat[chatId];
      return { streamingByChat, isStreaming: Object.keys(streamingByChat).length > 0 };
    }),

  setPendingQuestion: (pendingQuestion) => set({ pendingQuestion }),
  setPendingPlan: (pendingPlan) => set({ pendingPlan }),

  setDraft: (chatId, value) =>
    set((s) => {
      const draftByChat = { ...s.draftByChat };
      if (value === null) delete draftByChat[chatId];
      else draftByChat[chatId] = value;
      return { draftByChat };
    }),

  enqueueQueuedMessage: (chatId, content) => {
    const trimmed = content.trim();
    if (!trimmed) return null;
    const message: QueuedMessage = { id: uid(), chatId, content: trimmed, createdAt: Date.now() };
    set((s) => ({
      queuedByChat: { ...s.queuedByChat, [chatId]: [...(s.queuedByChat[chatId] ?? []), message] },
    }));
    return message;
  },

  updateQueuedMessage: (chatId, id, content) =>
    set((s) => {
      const trimmed = content.trim();
      const queue = s.queuedByChat[chatId] ?? [];
      const nextQueue = trimmed ? queue.map((item) => (item.id === id ? { ...item, content: trimmed } : item)) : queue.filter((item) => item.id !== id);
      const queuedByChat = { ...s.queuedByChat };
      if (nextQueue.length > 0) queuedByChat[chatId] = nextQueue;
      else delete queuedByChat[chatId];
      return { queuedByChat };
    }),

  removeQueuedMessage: (chatId, id) =>
    set((s) => {
      const nextQueue = (s.queuedByChat[chatId] ?? []).filter((item) => item.id !== id);
      const queuedByChat = { ...s.queuedByChat };
      if (nextQueue.length > 0) queuedByChat[chatId] = nextQueue;
      else delete queuedByChat[chatId];
      return { queuedByChat };
    }),

  promoteQueuedMessage: (chatId, id) =>
    set((s) => {
      const queue = s.queuedByChat[chatId] ?? [];
      const index = queue.findIndex((item) => item.id === id);
      if (index <= 0) return {};
      const nextQueue = [queue[index], ...queue.slice(0, index), ...queue.slice(index + 1)];
      return { queuedByChat: { ...s.queuedByChat, [chatId]: nextQueue } };
    }),

  popQueuedMessage: (chatId) => {
    let next: QueuedMessage | null = null;
    set((s) => {
      const queue = s.queuedByChat[chatId] ?? [];
      if (queue.length === 0) return {};
      next = queue[0];
      const queuedByChat = { ...s.queuedByChat };
      const rest = queue.slice(1);
      if (rest.length > 0) queuedByChat[chatId] = rest;
      else delete queuedByChat[chatId];
      return { queuedByChat };
    });
    return next;
  },

  clearQueuedMessages: (chatId) =>
    set((s) => {
      if (!s.queuedByChat[chatId]) return {};
      const queuedByChat = { ...s.queuedByChat };
      delete queuedByChat[chatId];
      return { queuedByChat };
    }),

  setChatTitle: (chatId, title) =>
    set((s) => ({
      chats: s.chats.map((c) => (c.id === chatId ? { ...c, title } : c)),
    })),

  setChatProject: async (chatId, projectId) => {
    const previous = get().chats;
    set((s) => ({
      chats: s.chats.map((c) => (c.id === chatId ? { ...c, projectId: projectId ?? undefined, updatedAt: Date.now() } : c)),
    }));
    try {
      const res = await fetch(`/api/chats/${chatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) throw new Error(`Project update failed: ${res.status}`);
    } catch (error) {
      set({ chats: previous });
      throw error;
    }
  },

  messages: (chatId) => get().messagesByChat[chatId] ?? EMPTY_MESSAGES,
}));

/** Persist a finalized message to SQLite (fire-and-forget). */
export function persistMessage(chatId: string, message: { id: string; role: string; content: string; blocks: ContentBlock[]; status: string; model?: string; createdAt: number }) {
  void fetch(`/api/chats/${chatId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  }).catch(() => {});
}
