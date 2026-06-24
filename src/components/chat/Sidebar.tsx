"use client";
import { Plus, Trash2, PanelLeft, Boxes, Clock, ChevronRight, Folder, FolderOpen, FolderPlus } from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { useChatStore } from "@/lib/store/chat-store";
import { useProjectStore } from "@/lib/store/project-store";
import { useUiStore } from "@/lib/store/ui-store";
import { cn } from "@/lib/utils";
import type { Chat, Project } from "@/types";

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

/** Open native folder dialog via Electron IPC. Returns null if cancelled or not in Electron. */
async function pickFolder(): Promise<string | null> {
  try {
    const vg = (window as unknown as { vaultgate?: { dialog?: { openFolder: () => Promise<string | null> } } }).vaultgate;
    if (vg?.dialog?.openFolder) return await vg.dialog.openFolder();
  } catch {
    /* not in Electron */
  }
  return null;
}

function folderName(folderPath: string): string {
  return folderPath.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop() || "Untitled";
}

export function Sidebar() {
  const open = useUiStore((s) => s.sidebarOpen);
  const toggle = useUiStore((s) => s.toggleSidebar);
  const setInventoryOpen = useUiStore((s) => s.setInventoryOpen);
  const collapsedProjects = useUiStore((s) => s.collapsedProjects);
  const toggleProjectCollapsed = useUiStore((s) => s.toggleProjectCollapsed);

  const chats = useChatStore((s) => s.chats);
  const currentChatId = useChatStore((s) => s.currentChatId);
  const selectChat = useChatStore((s) => s.selectChat);
  const beginNewChat = useChatStore((s) => s.beginNewChat);
  const deleteChat = useChatStore((s) => s.deleteChat);

  const projects = useProjectStore((s) => s.projects);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const setActiveProject = useProjectStore((s) => s.setActive);
  const createProject = useProjectStore((s) => s.createProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);

  const [pendingDelete, setPendingDelete] = useState<Chat | null>(null);
  const [pendingProjectDelete, setPendingProjectDelete] = useState<Project | null>(null);
  const [projectDeleteInput, setProjectDeleteInput] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteChat(pendingDelete.id);
      toast.success("Conversation deleted");
      setPendingDelete(null);
    } catch {
      toast.error("Could not delete conversation");
    } finally {
      setDeleting(false);
    }
  };

  const confirmProjectDelete = async () => {
    if (!pendingProjectDelete || projectDeleteInput !== pendingProjectDelete.name) return;
    setDeletingProject(true);
    try {
      await deleteProject(pendingProjectDelete.id);
      const store = useChatStore.getState();
      for (const chat of store.chats.filter((item) => item.projectId === pendingProjectDelete.id)) {
        store.upsertChat({ ...chat, projectId: undefined, workspacePath: chat.workspacePath ?? pendingProjectDelete.path, updatedAt: Date.now() });
      }
      toast.success("Project removed");
      setPendingProjectDelete(null);
      setProjectDeleteInput("");
    } catch {
      toast.error("Could not remove project");
    } finally {
      setDeletingProject(false);
    }
  };

  const visibleChats = useMemo(() => chats.filter((c) => c.type !== "subagent"), [chats]);

  const chatsByProject = useMemo(() => {
    const map = new Map<string | null, Chat[]>();
    for (const chat of visibleChats) {
      const key = chat.projectId ?? null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(chat);
    }
    return map;
  }, [visibleChats]);

  const projectsWithChats = useMemo(() => {
    return projects.map((project) => ({
      project,
      chats: chatsByProject.get(project.id) ?? [],
    }));
  }, [projects, chatsByProject]);

  const orphanChats = chatsByProject.get(null) ?? [];

  const handleNewChat = () => {
    beginNewChat();
  };

  const handleOpenFolder = async () => {
    const selected = await pickFolder();
    if (selected) {
      await createProject(selected, folderName(selected));
    } else {
      // Fallback: if native dialog not available, prompt manual input
      const path = window.prompt("Enter the full path to a project folder:");
      if (path?.trim()) {
        await createProject(path.trim(), folderName(path.trim()));
      }
    }
  };

  return (
    <>
      <aside
        className={cn(
          "flex h-screen shrink-0 flex-col bg-sidebar pb-2 transition-[width] duration-200",
          open ? "w-[256px]" : "w-0 overflow-hidden",
        )}
      >
        {/* Header — toggle */}
        <div className="shrink-0 flex items-center pr-2 mb-1" style={{ height: 40 }}>
          <div className="flex items-center pl-2">
            <button
              onClick={toggle}
              className="group outline-none w-6 h-6 flex items-center justify-center rounded-md hover:bg-secondary transition-[background] disabled:pointer-events-none"
              title="Toggle Sidebar"
              aria-label="Toggle Sidebar"
            >
              <PanelLeft className="outline-none opacity-70 group-hover:opacity-100 transition-opacity size-[18px]" />
            </button>
          </div>
        </div>

        {/* Primary actions */}
        <div className="px-2 flex flex-col gap-0.5">
          <button
            onClick={handleNewChat}
            aria-label="New Conversation"
            className="flex h-8 min-w-0 flex-grow items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-normal transition-colors bg-primary/10 hover:bg-primary/20 text-foreground outline-none"
          >
            <Plus className="size-[14px] shrink-0 text-primary" />
            <span className="select-none truncate font-medium">New Conversation</span>
          </button>

          <button
            className="flex h-8 min-w-0 flex-grow items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-normal transition-colors bg-transparent hover:bg-sidebar-muted text-secondary-foreground outline-none"
            title="Conversation History"
          >
            <Clock className="size-[14px] shrink-0 opacity-60" />
            <span className="select-none truncate">Conversation History</span>
          </button>
        </div>

        {/* Projects section header */}
        <div className="flex items-center justify-between px-3 pt-4 pb-1">
          <h2 className="m-0 select-none text-xs font-medium opacity-50 uppercase tracking-wider">Projects</h2>
          <button
            onClick={() => void handleOpenFolder()}
            className="flex size-5 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-secondary hover:text-foreground"
            title="Open project folder"
          >
            <FolderPlus className="size-3.5" />
          </button>
        </div>

        {/* Project groups + chats */}
        <nav
          className="flex min-h-0 flex-1 flex-col gap-0 overflow-y-auto scrollbar-none px-2 pb-3"
          style={{ maskImage: "linear-gradient(transparent, black 12px)" }}
        >
          {projectsWithChats.length === 0 && orphanChats.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              No projects yet — open a folder to start
            </p>
          )}

          {projectsWithChats.map(({ project, chats: projectChats }) => {
            const isCollapsed = collapsedProjects.has(project.id);
            const isActive = project.id === activeProjectId;

            return (
              <div key={project.id} className="mb-0.5">
                {/* Project header */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setActiveProject(project.id);
                    if (isCollapsed) toggleProjectCollapsed(project.id);
                  }}
                  className={cn(
                    "group flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-sm transition-colors outline-none cursor-pointer",
                    isActive
                      ? "text-foreground"
                      : "text-secondary-foreground hover:text-foreground",
                  )}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleProjectCollapsed(project.id);
                    }}
                    className="flex size-4 shrink-0 items-center justify-center"
                  >
                    <ChevronRight
                      className={cn(
                        "size-3 opacity-40 transition-transform duration-150",
                        !isCollapsed && "rotate-90",
                        projectChats.length === 0 && "invisible",
                      )}
                    />
                  </button>
                  {isActive ? (
                    <FolderOpen className="size-4 shrink-0 text-primary" />
                  ) : (
                    <Folder className="size-4 shrink-0 opacity-50" />
                  )}
                  <span className={cn("truncate", isActive && "font-medium")}>{project.name}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingProjectDelete(project);
                      setProjectDeleteInput("");
                    }}
                    className="ml-auto flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/55 opacity-0 transition-all hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100"
                    title="Remove project"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>

                {/* Nested chats */}
                {!isCollapsed && projectChats.length > 0 && (
                  <div className="flex flex-col gap-px ml-2 mt-px">
                    {projectChats.map((chat) => (
                      <ChatItem
                        key={chat.id}
                        chat={chat}
                        isCurrent={chat.id === currentChatId}
                        onSelect={() => {
                          setActiveProject(project.id);
                          void selectChat(chat.id);
                        }}
                        onDelete={() => setPendingDelete(chat)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Orphan chats (no project) */}
          {orphanChats.length > 0 && (
            <div className="mt-2">
              <div className="flex items-center gap-1.5 px-2 py-1">
                <h3 className="text-xs font-medium text-muted-foreground/60">Unsorted</h3>
              </div>
              <div className="flex flex-col gap-px ml-2">
                {orphanChats.map((chat) => (
                  <ChatItem
                    key={chat.id}
                    chat={chat}
                    isCurrent={chat.id === currentChatId}
                    onSelect={() => void selectChat(chat.id)}
                    onDelete={() => setPendingDelete(chat)}
                  />
                ))}
              </div>
            </div>
          )}
        </nav>

        {/* Bottom — Inventory */}
        <div className="flex flex-col gap-px pt-2 px-2 shrink-0">
          <button
            onClick={() => setInventoryOpen(true)}
            className="group relative flex h-9 min-w-0 flex-grow cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-lg border border-transparent bg-transparent px-2 py-1 text-secondary-foreground outline-none transition-all duration-300 hover:-translate-y-px hover:border-card-border hover:bg-sidebar-muted hover:text-foreground hover:shadow-[0_8px_28px_-18px_var(--foreground)] active:translate-y-0 active:scale-[0.98]"
            title="Inventory — skills & memory"
          >
            <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-foreground/10 to-transparent opacity-0 transition-all duration-700 group-hover:translate-x-full group-hover:opacity-100" />
            <Boxes className="relative size-[18px] shrink-0 transition-transform duration-300 group-hover:rotate-6 group-hover:scale-110" />
            <span className="relative select-none truncate text-sm font-medium tracking-[-0.01em]">Inventory</span>
          </button>
        </div>
      </aside>

      {/* Delete confirmation */}
      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" onClick={() => !deleting && setPendingDelete(null)}>
          <div className="w-full max-w-md rounded-xl border border-card-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-sm font-semibold">Delete conversation?</h2>
              <p className="mt-1 text-xs text-muted-foreground">This permanently deletes the conversation and its messages.</p>
            </div>
            <div className="space-y-3 px-5 py-4">
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {pendingDelete.title}
              </div>
              <div className="flex justify-end gap-2">
                <button disabled={deleting} onClick={() => setPendingDelete(null)} className="rounded-md border border-border px-3 py-2 text-sm text-secondary-foreground hover:bg-secondary disabled:opacity-50">
                  Cancel
                </button>
                <button disabled={deleting} onClick={() => void confirmDelete()} className="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
                  {deleting ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Project removal confirmation */}
      {pendingProjectDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !deletingProject && setPendingProjectDelete(null)}>
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-card-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-sm font-semibold">Remove project?</h2>
              <p className="mt-1 text-xs text-muted-foreground">This removes the project from the sidebar. Existing chats keep their locked workspace folder.</p>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div className="rounded-xl border border-card-border bg-muted/45 px-3 py-2">
                <p className="truncate text-sm font-medium text-foreground">{pendingProjectDelete.name}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{pendingProjectDelete.path}</p>
              </div>
              <label className="block space-y-1.5">
                <span className="text-xs text-muted-foreground">Type <span className="font-medium text-foreground">{pendingProjectDelete.name}</span> to confirm.</span>
                <input
                  autoFocus
                  value={projectDeleteInput}
                  onChange={(event) => setProjectDeleteInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && projectDeleteInput === pendingProjectDelete.name) void confirmProjectDelete();
                    if (event.key === "Escape") setPendingProjectDelete(null);
                  }}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-ring"
                  placeholder={pendingProjectDelete.name}
                />
              </label>
              <div className="flex justify-end gap-2">
                <button disabled={deletingProject} onClick={() => setPendingProjectDelete(null)} className="rounded-md border border-border px-3 py-2 text-sm text-secondary-foreground hover:bg-secondary disabled:opacity-50">
                  Cancel
                </button>
                <button disabled={deletingProject || projectDeleteInput !== pendingProjectDelete.name} onClick={() => void confirmProjectDelete()} className="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40">
                  {deletingProject ? "Removing..." : "Remove project"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ChatItem({
  chat,
  isCurrent,
  onSelect,
  onDelete,
}: {
  chat: Chat;
  isCurrent: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="w-full h-full group">
      <div
        role="button"
        tabIndex={0}
        className={cn(
          "select-none cursor-pointer rounded-lg min-h-[30px] py-1 flex flex-row gap-1 items-center justify-between px-2 outline-none ml-[18px]",
          isCurrent
            ? "bg-sidebar-secondary text-foreground"
            : "hover:bg-sidebar-muted text-secondary-foreground",
        )}
        onClick={onSelect}
      >
        <div className="flex flex-col grow min-w-0">
          <div className="flex items-center gap-1.5 w-full">
            <span
              className={cn(
                "truncate inline-block text-[13px] text-left transition-opacity leading-tight",
                isCurrent ? "text-foreground" : "group-hover:text-foreground",
              )}
            >
              {chat.title}
            </span>
          </div>
        </div>
        <div className="flex items-center shrink-0 gap-1">
          <span className="text-[10px] text-muted-foreground/60 tabular-nums">
            {timeAgo(chat.updatedAt)}
          </span>
          <div className="relative flex items-center">
            <div className="absolute top-0 bottom-0 right-0 pl-2 flex items-center justify-end gap-px translate-x-0.5 invisible group-hover:visible">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                className="w-5 h-5 shrink-0 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                title="Delete"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
