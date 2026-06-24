"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronDown, Folder, FolderOpen, FolderPlus, Home } from "lucide-react";
import { useProjectStore } from "@/lib/store/project-store";
import { cn } from "@/lib/utils";
import type { Project } from "@/types";

/** Open native folder dialog via Electron IPC. Returns null if cancelled or not in Electron. */
async function pickFolderNative(): Promise<string | null> {
  try {
    const vg = (window as unknown as { vaultgate?: { dialog?: { openFolder: () => Promise<string | null> } } }).vaultgate;
    if (vg?.dialog?.openFolder) return await vg.dialog.openFolder();
  } catch {
    /* not in Electron */
  }
  return null;
}

/** Derive a display name from a folder path (last segment). */
function folderName(folderPath: string): string {
  return folderPath.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop() || "Untitled";
}

/**
 * Project selector rendered below the composer.
 * Shows current project name + chevron. Click opens dropdown upward.
 */
export function ProjectSelector({
  disabled,
  locked,
  selectedProjectId,
  lockedRootPath,
  onSelectProject,
}: {
  disabled?: boolean;
  locked?: boolean;
  selectedProjectId?: string | null;
  lockedRootPath?: string | null;
  onSelectProject?: (id: string | null) => void;
}) {
  // Use a single selector that returns both pieces so we always re-render together.
  const storeActiveProjectId = useProjectStore((s) => s.activeProjectId);
  const projects = useProjectStore((s) => s.projects);
  const setActive = useProjectStore((s) => s.setActive);
  const storeCreateProject = useProjectStore((s) => s.createProject);

  const activeProjectId = selectedProjectId === undefined ? storeActiveProjectId : selectedProjectId;
  const activeProject = activeProjectId ? projects.find((p) => p.id === activeProjectId) : undefined;
  const lockedRootName = locked && !activeProject && lockedRootPath ? folderName(lockedRootPath) : null;
  const displayName = activeProject ? activeProject.name : lockedRootName || "Home";
  const isDisabled = disabled || locked;

  const [open, setOpen] = useState(false);
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualPath, setManualPath] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isDisabled) return;
    setOpen(false);
    setShowManualInput(false);
  }, [isDisabled]);

  // Close on outside click / escape
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setShowManualInput(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setShowManualInput(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Ctrl+. shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isDisabled && e.ctrlKey && e.key === ".") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isDisabled]);

  const selectProject = useCallback((id: string | null) => {
    if (isDisabled) return;
    if (onSelectProject) onSelectProject(id);
    else setActive(id);
  }, [isDisabled, onSelectProject, setActive]);

  const handleOpenFolder = useCallback(async () => {
    if (isDisabled) return;
    // Try native dialog first
    const selected = await pickFolderNative();
    if (selected) {
      const project = await storeCreateProject(selected, folderName(selected));
      if (project) selectProject(project.id);
      setOpen(false);
      setShowManualInput(false);
      return;
    }
    // Fallback: show manual path input
    setShowManualInput(true);
  }, [isDisabled, selectProject, storeCreateProject]);

  const handleManualAdd = useCallback(async () => {
    if (isDisabled) return;
    const trimmed = manualPath.trim();
    if (!trimmed) return;
    const project = await storeCreateProject(trimmed, folderName(trimmed));
    if (project) selectProject(project.id);
    setManualPath("");
    setShowManualInput(false);
    setOpen(false);
  }, [isDisabled, manualPath, selectProject, storeCreateProject]);

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        onClick={() => !isDisabled && setOpen(!open)}
        disabled={isDisabled}
        className={cn(
          "flex h-7 max-w-[190px] items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors",
          open
            ? "bg-secondary text-foreground"
            : "text-secondary-foreground hover:bg-secondary hover:text-foreground",
          isDisabled && "cursor-not-allowed opacity-70",
        )}
        title={locked ? `Workspace root is locked to ${activeProject?.path || lockedRootPath || "Home"}. Start a new chat to choose another folder.` : "Select Project  Ctrl+."}
      >
        <span className="min-w-0 truncate">
          {displayName}
        </span>
        {!locked && <ChevronDown className={cn("size-3 shrink-0 opacity-50 transition-transform", open && "rotate-180")} />}
      </button>

      {/* Dropdown (opens upward since it's at the bottom) */}
      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 min-w-[260px] max-w-[360px] animate-in fade-in-0 slide-in-from-bottom-2 overflow-hidden rounded-xl border border-card-border bg-popover text-popover-foreground shadow-2xl shadow-black/40 dark:bg-[#141414]">
          {/* Project list */}
          <div className="max-h-[280px] overflow-y-auto scrollbar-none py-1">
            {/* Default "Home" (no project = user home dir) */}
            <button
              onClick={() => {
                selectProject(null);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                !activeProjectId
                  ? "bg-primary/10 text-foreground font-medium"
                  : "text-secondary-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Home className={cn("size-4 shrink-0", !activeProjectId ? "text-primary" : "opacity-50")} />
              <span>Home</span>
              <span className="ml-auto text-[10px] text-muted-foreground/50">~</span>
            </button>

            {/* Separator */}
            {projects.length > 0 && <div className="mx-3 my-1 h-px bg-border/60" />}

            {projects.map((project) => (
              <ProjectItem
                key={project.id}
                project={project}
                isActive={project.id === activeProjectId}
                onSelect={() => {
                  selectProject(project.id);
                  setOpen(false);
                }}
              />
            ))}
          </div>

          {/* Manual path input (fallback when no Electron dialog) */}
          {showManualInput && (
            <div className="space-y-1.5 border-t border-border/60 p-2">
              <input
                autoFocus
                value={manualPath}
                onChange={(e) => setManualPath(e.target.value)}
                placeholder="C:\Users\...\my-project"
                className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-ring"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleManualAdd();
                  if (e.key === "Escape") setShowManualInput(false);
                }}
              />
              <div className="flex justify-end gap-1">
                <button
                  onClick={() => setShowManualInput(false)}
                  className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleManualAdd()}
                  disabled={!manualPath.trim()}
                  className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
                >
                  Add
                </button>
              </div>
            </div>
          )}

          {/* Open folder button */}
          {!showManualInput && (
            <div className="border-t border-border/60">
              <button
                onClick={() => void handleOpenFolder()}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-secondary-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <FolderPlus className="size-4 opacity-50" />
                <span>Open folder…</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProjectItem({
  project,
  isActive,
  onSelect,
}: {
  project: Project;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <div>
      <button
        onClick={onSelect}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
          isActive
            ? "bg-primary/10 text-foreground font-medium"
            : "text-secondary-foreground hover:bg-muted hover:text-foreground",
        )}
        title={project.path}
      >
        {isActive ? (
          <FolderOpen className="size-4 shrink-0 text-primary" />
        ) : (
          <Folder className="size-4 shrink-0 opacity-50" />
        )}
        <span className="truncate">{project.name}</span>
      </button>
    </div>
  );
}
