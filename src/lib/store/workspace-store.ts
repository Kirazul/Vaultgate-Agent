"use client";
import { create } from "zustand";
import { stripAnsi } from "@/lib/utils";
import type { FileDiffEntry } from "@/lib/ai/tool-display";

export type WorkspaceTab = "code" | "terminal" | "review";

export interface TerminalEntry {
  id?: string;
  chunk: string;
  at: number;
}

interface WorkspaceState {
  panelOpen: boolean;
  tab: WorkspaceTab;
  activeChatId: string | null;
  terminalByChat: Record<string, TerminalEntry[]>;
  focusedToolId: string | null;
  workspaceToken: number;
  panelWidth: number;
  reviewDiffs: FileDiffEntry[];
  hasNotification: boolean;

  openPanel: (tab?: WorkspaceTab) => void;
  closePanel: () => void;
  setTab: (tab: WorkspaceTab) => void;
  activate: (chatId: string, tab?: WorkspaceTab) => void;
  appendTerminal: (chatId: string, chunk: string, id?: string) => void;
  clearTerminal: (chatId: string) => void;
  forgetChat: (chatId: string) => void;
  setFocusedTool: (id: string | null) => void;
  bumpWorkspace: () => void;
  setPanelWidth: (width: number) => void;
  setReviewDiffs: (diffs: FileDiffEntry[]) => void;
  notifyPanel: () => void;
  clearNotification: () => void;
  terminal: (chatId: string | null) => TerminalEntry[];
}

export const EMPTY_TERMINAL_LINES: TerminalEntry[] = [];

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  panelOpen: false,
  tab: "terminal",
  activeChatId: null,
  terminalByChat: {},
  focusedToolId: null,
  workspaceToken: 0,
  panelWidth: 620,
  reviewDiffs: [],
  hasNotification: false,

  openPanel: (tab) => set((s) => ({ panelOpen: true, tab: tab ?? s.tab, hasNotification: false })),
  closePanel: () => set({ panelOpen: false }),
  setTab: (tab) => set({ tab }),
  activate: (chatId, tab) => set((s) => ({ panelOpen: true, activeChatId: chatId, tab: tab ?? s.tab, hasNotification: false })),

  appendTerminal: (chatId, chunk, id) =>
    set((s) => {
      const prev = s.terminalByChat[chatId] ?? [];
      const next = [...prev, { id, chunk: stripAnsi(chunk), at: Date.now() }].slice(-1000);
      return { terminalByChat: { ...s.terminalByChat, [chatId]: next } };
    }),

  clearTerminal: (chatId) =>
    set((s) => ({ terminalByChat: { ...s.terminalByChat, [chatId]: [] } })),

  forgetChat: (chatId) =>
    set((s) => {
      const terminalByChat = { ...s.terminalByChat };
      delete terminalByChat[chatId];
      return {
        terminalByChat,
        activeChatId: s.activeChatId === chatId ? null : s.activeChatId,
        panelOpen: s.activeChatId === chatId ? false : s.panelOpen,
        focusedToolId: s.activeChatId === chatId ? null : s.focusedToolId,
      };
    }),

  setFocusedTool: (id) => set({ focusedToolId: id }),
  bumpWorkspace: () => set((s) => ({ workspaceToken: s.workspaceToken + 1, hasNotification: !s.panelOpen ? true : s.hasNotification })),
  setPanelWidth: (width) => set({ panelWidth: Math.max(360, Math.min(width, Math.floor(window.innerWidth * 0.72))) }),
  setReviewDiffs: (reviewDiffs) => set((s) => ({ reviewDiffs, hasNotification: !s.panelOpen && reviewDiffs.length > 0 ? true : s.hasNotification })),
  notifyPanel: () => set((s) => (s.panelOpen ? {} : { hasNotification: true })),
  clearNotification: () => set({ hasNotification: false }),
  terminal: (chatId) => (chatId ? get().terminalByChat[chatId] ?? EMPTY_TERMINAL_LINES : EMPTY_TERMINAL_LINES),
}));
