"use client";
import { ArrowLeft, Bot, Boxes, ChevronRight, Folder, PanelLeftOpen, Settings } from "lucide-react";
import { useUiStore } from "@/lib/store/ui-store";
import { ThemeToggle } from "./ThemeToggle";
import { WindowControls } from "./WindowControls";
import { ContextUsageIndicator } from "./ContextUsageIndicator";
import { useChatStore } from "@/lib/store/chat-store";

export function TopBar() {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const setInventoryOpen = useUiStore((s) => s.setInventoryOpen);

  const currentChatId = useChatStore((s) => s.currentChatId);
  const chats = useChatStore((s) => s.chats);
  const selectChat = useChatStore((s) => s.selectChat);
  const currentChat = chats.find((c) => c.id === currentChatId);
  const parentChat = currentChat?.parentId ? chats.find((c) => c.id === currentChat.parentId) : undefined;
  const fallbackParent = chats.find((chat) => chat.type !== "subagent" && chat.id !== currentChatId);
  const backTargetId = currentChat?.parentId ?? fallbackParent?.id;
  const parentTitle = parentChat?.title || fallbackParent?.title || "Parent Chat";
  const isSubAgentChat = Boolean(currentChat?.parentId || currentChat?.type === "subagent");

  return (
    <header className="app-drag-region flex h-[35px] shrink-0 items-center gap-1 bg-sidebar px-2 text-sm">
      {!sidebarOpen && (
        <button
          onClick={toggleSidebar}
          className="app-no-drag flex size-6 items-center justify-center rounded-md text-foreground/70 transition-colors hover:bg-secondary hover:text-foreground"
          title="Show sidebar"
        >
          <PanelLeftOpen className="size-4" />
        </button>
      )}

      {isSubAgentChat && currentChat ? (
        <div className="app-no-drag flex min-w-0 items-center gap-1.5">
          <button
            onClick={() => backTargetId && void selectChat(backTargetId)}
            disabled={!backTargetId}
            className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs text-secondary-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
            title="Back to main chat"
          >
            <ArrowLeft className="size-3.5" />
            Main chat
          </button>
          <div className="flex min-w-0 items-center gap-1 text-xs text-secondary-foreground">
            <Folder className="size-3.5 shrink-0 opacity-50" />
            <button
              onClick={() => backTargetId && void selectChat(backTargetId)}
              disabled={!backTargetId}
              className="max-w-[210px] truncate text-left transition-colors hover:text-foreground"
              title={parentTitle}
            >
              {parentTitle}
            </button>
            <ChevronRight className="size-3 shrink-0 opacity-50" />
            <span className="flex min-w-0 items-center gap-1.5 text-foreground" title="Sub-agent chat">
              <span className="max-w-[280px] truncate font-medium">{currentChat.title}</span>
              <Bot className="size-3.5 shrink-0 text-primary" />
            </span>
          </div>
        </div>
      ) : (
        <span className="app-no-drag select-none px-1 text-sm font-medium text-foreground/90">VaultGate</span>
      )}

      <div className="app-no-drag ml-auto flex items-center gap-0.5">
        <ContextUsageIndicator />
        <ThemeToggle />
        <button
          onClick={() => setInventoryOpen(true)}
          className="flex size-6 items-center justify-center rounded-md text-foreground/70 transition-colors hover:bg-secondary hover:text-foreground"
          title="Inventory (Ctrl+I)"
        >
          <Boxes className="size-4" />
        </button>
        <button
          onClick={() => setSettingsOpen(true)}
          className="flex size-6 items-center justify-center rounded-md text-foreground/70 transition-colors hover:bg-secondary hover:text-foreground"
          title="Settings (Ctrl+,)"
        >
          <Settings className="size-4" />
        </button>
        <WindowControls />
      </div>
    </header>
  );
}
