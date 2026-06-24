"use client";
import { create } from "zustand";
import type { UsageData } from "@/types";

interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  cost: number;
  turns: number;
}

const EMPTY_CHAT: ChatUsage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, cost: 0, turns: 0 };

interface UsageState {
  /** Lifetime, accumulated totals per chat — used for COST and session stats. */
  byChat: Record<string, ChatUsage>;
  /**
   * Current context-window occupancy per chat (tokens). This is the prompt size
   * of the most recent request — NOT a running sum — so it reads honestly
   * against the model's context limit. Persists after the turn ends.
   */
  contextByChat: Record<string, number>;
  /** Smoothly-animated live token count for the active turn (status line). */
  streamingTokens: number;
  /** The latest cumulative usage event from the current turn (server emits cumulative). */
  latestUsage: UsageData | null;

  recordUsage: (chatId: string, usage: UsageData) => void;
  setContext: (chatId: string, tokens: number) => void;
  getContext: (chatId: string) => number;
  setStreamingTokens: (count: number) => void;
  resetStreamingTokens: () => void;
  setLatestUsage: (usage: UsageData | null) => void;
  getChat: (chatId: string) => ChatUsage;
  getSessionTotal: () => ChatUsage;
}

// ── Single-rAF token tween ───────────────────────────────────
// The old implementation scheduled up to 20 stacked setTimeouts per update;
// rapid updates overlapped and made the counter stutter/jump. This is one
// monotonic rAF loop that eases the displayed value toward its target.
let tweenTarget = 0;
let tweenRaf: number | null = null;

function startTween(get: () => UsageState, set: (partial: Partial<UsageState>) => void) {
  if (typeof window === "undefined" || tweenRaf !== null) return;
  const step = () => {
    const current = get().streamingTokens;
    const delta = tweenTarget - current;
    if (Math.abs(delta) < 1) {
      set({ streamingTokens: tweenTarget });
      tweenRaf = null;
      return;
    }
    // Ease ~18% of the remaining distance per frame, min 1 token, so it always
    // makes visible progress and settles in a few hundred ms.
    const next = current + Math.sign(delta) * Math.max(1, Math.round(Math.abs(delta) * 0.18));
    set({ streamingTokens: delta > 0 ? Math.min(next, tweenTarget) : Math.max(next, tweenTarget) });
    tweenRaf = requestAnimationFrame(step);
  };
  tweenRaf = requestAnimationFrame(step);
}

export const useUsageStore = create<UsageState>((set, get) => ({
  byChat: {},
  contextByChat: {},
  streamingTokens: 0,
  latestUsage: null,

  recordUsage: (chatId, usage) =>
    set((s) => {
      const prev = s.byChat[chatId] ?? { ...EMPTY_CHAT };
      return {
        byChat: {
          ...s.byChat,
          [chatId]: {
            inputTokens: prev.inputTokens + usage.inputTokens,
            outputTokens: prev.outputTokens + usage.outputTokens,
            reasoningTokens: prev.reasoningTokens + (usage.reasoningTokens ?? 0),
            cacheReadTokens: prev.cacheReadTokens + (usage.cacheReadTokens ?? 0),
            cacheWriteTokens: prev.cacheWriteTokens + (usage.cacheWriteTokens ?? 0),
            totalTokens: prev.totalTokens + usage.totalTokens,
            cost: prev.cost + (usage.cost ?? 0),
            turns: prev.turns + 1,
          },
        },
        // Keep the context reading from the same turn's footprint.
        contextByChat: { ...s.contextByChat, [chatId]: usage.contextTokens ?? s.contextByChat[chatId] ?? 0 },
      };
    }),

  setContext: (chatId, tokens) => set((s) => ({ contextByChat: { ...s.contextByChat, [chatId]: Math.max(0, Math.round(tokens)) } })),
  getContext: (chatId) => get().contextByChat[chatId] ?? 0,

  setStreamingTokens: (count) => {
    const target = Math.max(0, Math.round(count));
    // A new turn resets downward — snap instantly, don't animate backwards.
    if (target < get().streamingTokens) {
      tweenTarget = target;
      set({ streamingTokens: target });
      return;
    }
    tweenTarget = target;
    startTween(get, set);
  },
  resetStreamingTokens: () => {
    tweenTarget = 0;
    if (tweenRaf !== null && typeof window !== "undefined") {
      cancelAnimationFrame(tweenRaf);
      tweenRaf = null;
    }
    set({ streamingTokens: 0 });
  },
  setLatestUsage: (usage) => set({ latestUsage: usage }),

  getChat: (chatId) => get().byChat[chatId] ?? EMPTY_CHAT,

  getSessionTotal: () => {
    const all = Object.values(get().byChat);
    if (all.length === 0) return EMPTY_CHAT;
    return all.reduce((acc, c) => ({
      inputTokens: acc.inputTokens + c.inputTokens,
      outputTokens: acc.outputTokens + c.outputTokens,
      reasoningTokens: acc.reasoningTokens + c.reasoningTokens,
      cacheReadTokens: acc.cacheReadTokens + c.cacheReadTokens,
      cacheWriteTokens: acc.cacheWriteTokens + c.cacheWriteTokens,
      totalTokens: acc.totalTokens + c.totalTokens,
      cost: acc.cost + c.cost,
      turns: acc.turns + c.turns,
    }));
  },
}));
