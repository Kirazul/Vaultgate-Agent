"use client";
import { useRef, useState, useEffect, type DragEvent, type KeyboardEvent } from "react";
import { ArrowUp, CornerDownRight, FileText, Folder, Loader2, Pencil, Plus, Square, Trash2, X } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { ModelSelector } from "./ModelSelector";
import { ModeSwitcher } from "./ModeSwitcher";
import { ProjectSelector } from "./ProjectSelector";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/lib/store/settings-store";
import { EMPTY_MESSAGES, EMPTY_QUEUED_MESSAGES, useChatStore } from "@/lib/store/chat-store";
import { useProjectStore } from "@/lib/store/project-store";
import type { QueuedMessage } from "@/types";
import { activeFileMentionToken, activeSlashToken, fetchWorkspaceTree, fileMentionSuggestions, flattenWorkspaceTree, insertedFileMention, type FileMentionSuggestion } from "@/lib/chat/file-mentions";
import { formatSlashCommand, slashCommandSuggestions, type SlashCommandDef } from "@/lib/chat/slash-commands";

export function Composer({
  chatId,
  onSend,
  onStop,
  onAttach,
}: {
  chatId?: string | null;
  onSend: (text: string) => void;
  onStop: () => void;
  onAttach?: (files: File[]) => Promise<UploadedAttachment[]>;
}) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [workspaceFiles, setWorkspaceFiles] = useState<FileMentionSuggestion[]>([]);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fileTreeChatRef = useRef<string | null>(null);
  const previousChatRef = useRef<string | null | undefined>(undefined);
  const lastEmptyEnterAtRef = useRef(0);
  const lastEscapeAtRef = useRef(0);
  const isStreaming = useChatStore((s) => (chatId ? Boolean(s.streamingByChat[chatId]) : s.isStreaming));
  const messages = useChatStore((s) => (chatId ? s.messagesByChat[chatId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES));
  const queued = useChatStore((s) => (chatId ? s.queuedByChat[chatId] ?? EMPTY_QUEUED_MESSAGES : EMPTY_QUEUED_MESSAGES));
  const chat = useChatStore((s) => (chatId ? s.chats.find((item) => item.id === chatId) : undefined));
  const draft = useChatStore((s) => (chatId ? s.draftByChat[chatId] : undefined));
  const setDraft = useChatStore((s) => s.setDraft);
  const removeQueuedMessage = useChatStore((s) => s.removeQueuedMessage);
  const promoteQueuedMessage = useChatStore((s) => s.promoteQueuedMessage);
  const clearQueuedMessages = useChatStore((s) => s.clearQueuedMessages);
  const setChatProject = useChatStore((s) => s.setChatProject);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const setActiveProject = useProjectStore((s) => s.setActive);
  const model = useSettingsStore((s) => s.provider.model);
  const features = useSettingsStore((s) => s.features);
  const setFeature = useSettingsStore((s) => s.setFeature);
  const mode = useSettingsStore((s) => s.mode);
  const canAttachFiles = Boolean(onAttach && !isStreaming && !uploading && model);
  const slashToken = activeSlashToken(value, cursor);
  const fileToken = activeFileMentionToken(value, cursor);
  const commandSuggestions = slashToken ? slashCommandSuggestions(slashToken.query, 10) : [];
  const pathSuggestions = fileToken ? fileMentionSuggestions(fileToken.query, workspaceFiles, 10) : [];
  const showCommandPalette = Boolean(slashToken && commandSuggestions.length > 0);
  const showFilePalette = Boolean(fileToken && pathSuggestions.length > 0);

  // Auto-grow the textarea.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 300) + "px";
  }, [value]);

  useEffect(() => {
    if (!chatId || !fileToken) return;
    if (fileTreeChatRef.current === chatId && workspaceFiles.length > 0) return;
    let cancelled = false;
    void (async () => {
      const tree = await fetchWorkspaceTree(chatId);
      if (cancelled) return;
      fileTreeChatRef.current = chatId;
      setWorkspaceFiles(flattenWorkspaceTree(tree));
    })();
    return () => {
      cancelled = true;
    };
  }, [chatId, fileToken, workspaceFiles.length]);

  useEffect(() => {
    const changedChat = previousChatRef.current !== chatId;
    previousChatRef.current = chatId;
    if (changedChat) {
      setValue(draft ?? "");
      if (draft !== undefined) ref.current?.focus();
      return;
    }
    if (draft !== undefined && draft !== value) {
      setValue(draft);
      ref.current?.focus();
    }
  }, [chatId, draft, value]);

  const setComposerValue = (next: string) => {
    setValue(next);
    if (chatId) setDraft(chatId, next.trim() ? next : null);
  };

  const syncCursor = () => setCursor(ref.current?.selectionStart ?? 0);

  const replaceToken = (start: number, end: number, replacement: string) => {
    const next = `${value.slice(0, start)}${replacement}${value.slice(end)}`;
    const nextCursor = start + replacement.length;
    setComposerValue(next);
    setCursor(nextCursor);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const submit = () => {
    const text = value.trim();
    if ((!text && attachments.length === 0) || !model || uploading) return;
    const attachmentNote = attachments.length
      ? `Attached files:\n${attachments.map((file) => `- [${file.name}](workspace-file:${encodeURIComponent(file.path)})`).join("\n")}`
      : "";
    onSend([text, attachmentNote].filter(Boolean).join("\n\n"));
    setComposerValue("");
    setAttachments([]);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!value.trim() && attachments.length === 0) {
        const now = Date.now();
        if (isStreaming && now - lastEmptyEnterAtRef.current < 450) onStop();
        lastEmptyEnterAtRef.current = now;
        return;
      }
      submit();
      return;
    }

    if (e.key === "Escape") {
      if (value.trim() || attachments.length > 0) {
        const now = Date.now();
        if (now - lastEscapeAtRef.current < 450) {
          setComposerValue("");
          setAttachments([]);
          setUploadError(null);
        }
        lastEscapeAtRef.current = now;
        return;
      }
      if (isStreaming) onStop();
    }
  };

  const pickFiles = () => fileRef.current?.click();

  const handleFiles = async (files: FileList | null) => {
    const selected = files ? Array.from(files) : [];
    if (selected.length === 0 || !onAttach || uploading) return;
    setUploading(true);
    setUploadError(null);
    try {
      const uploaded = await onAttach(selected);
      setAttachments((prev) => [...prev, ...uploaded]);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!canAttachFiles || !hasDraggedFiles(event)) return;
    event.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setDragActive(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!canAttachFiles || !hasDraggedFiles(event)) return;
    event.preventDefault();
    setDragActive(false);
    void handleFiles(event.dataTransfer.files);
  };

  const removeAttachment = (path: string) => setAttachments((prev) => prev.filter((file) => file.path !== path));

  const editQueuedMessage = (message: QueuedMessage) => {
    if (!chatId) return;
    removeQueuedMessage(chatId, message.id);
    setComposerValue(message.content);
    requestAnimationFrame(() => ref.current?.focus());
  };

  const removeQueued = (id: string) => {
    if (chatId) removeQueuedMessage(chatId, id);
  };

  const promoteQueued = (id: string) => {
    if (chatId) promoteQueuedMessage(chatId, id);
  };

  const stopAndSendQueued = (id: string) => {
    if (!chatId) return;
    promoteQueuedMessage(chatId, id);
    onStop();
  };

  const clearQueue = () => {
    if (chatId) clearQueuedMessages(chatId);
  };

  const rootLocked = Boolean(chatId && messages.length > 0);
  const selectedProjectId = rootLocked ? chat?.projectId ?? null : activeProjectId;
  const lockedRootPath = rootLocked ? chat?.workspacePath : null;
  const handleSelectProject = (projectId: string | null) => {
    setActiveProject(projectId);
    if (chatId && !rootLocked) void setChatProject(chatId, projectId);
  };

  const placeholder = model ? (isStreaming ? "Queue a follow-up while VaultGate works" : "Ask anything, @ to mention, / for actions") : "Configure a provider in Settings to start";
  const canSubmit = Boolean((value.trim() || attachments.length > 0) && model && !uploading);

  return (
    <div className="relative mb-2 flex w-full flex-col items-center px-4">
      <div className="w-full max-w-3xl">
        <div
          onDragEnter={handleDragOver}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "relative overflow-visible rounded-2xl border border-card-border bg-card p-1 transition-colors focus-within:border-foreground/15 dark:bg-[#141414]/95 dark:focus-within:border-white/20",
            dragActive && "border-primary/60 bg-primary/5",
          )}
        >
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(event) => void handleFiles(event.target.files)} />

          {dragActive && (
            <div className="pointer-events-none absolute inset-1 z-20 flex items-center justify-center rounded-xl border border-dashed border-primary/70 bg-background/80 text-sm font-medium text-primary backdrop-blur-sm">
              Drop files to attach them as context
            </div>
          )}

          {queued.length > 0 && (
            <QueuedMessages
              queued={queued}
              isStreaming={isStreaming}
              onEdit={editQueuedMessage}
              onRemove={removeQueued}
              onPromote={promoteQueued}
              onStopAndSend={stopAndSendQueued}
              onClear={clearQueue}
            />
          )}

          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-1 pb-1 pt-1">
              {attachments.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => removeAttachment(file.path)}
                  className="flex max-w-[16rem] items-center gap-1.5 rounded-full border border-card-border bg-muted/60 px-2.5 py-1 text-xs text-secondary-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
                  title={`${file.path} - click to remove`}
                >
                  <span className="truncate">{file.name}</span>
                  <X className="size-3" />
                </button>
              ))}
            </div>
          )}
          {uploadError && <p className="px-2 pb-1 text-xs text-destructive">{uploadError}</p>}

          <div className="relative w-full">
            <Textarea
              ref={ref}
              value={value}
              onChange={(e) => {
                setComposerValue(e.target.value);
                setCursor(e.target.selectionStart ?? e.target.value.length);
              }}
              onKeyDown={handleKeyDown}
              onKeyUp={syncCursor}
              onClick={syncCursor}
              onSelect={syncCursor}
              onFocus={() => window.dispatchEvent(new CustomEvent("vaultgate:composer-focus"))}
              rows={1}
              placeholder={placeholder}
              className="max-h-[300px] min-h-[52px] rounded-xl px-3 py-2.5 text-sm leading-6 text-foreground placeholder:text-muted-foreground/75"
            />
          </div>

          {showCommandPalette && slashToken && (
            <SlashPalette
              commands={commandSuggestions}
              onPick={(command) => replaceToken(slashToken.start, slashToken.end, `/${command.name} `)}
            />
          )}

          {showFilePalette && fileToken && (
            <FileMentionPalette
              files={pathSuggestions}
              onPick={(file) => replaceToken(fileToken.start, fileToken.end, insertedFileMention(file.path))}
            />
          )}

          <div className="flex w-full flex-wrap items-center justify-between gap-1.5 p-0.5">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={pickFiles}
                disabled={!canAttachFiles}
                className="flex size-7 items-center justify-center rounded-lg text-secondary-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                title="Add context — attach files to this chat workspace"
              >
                {uploading ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              </button>
              <ModelSelector />
              <ModeSwitcher disabled={isStreaming} />
              <FeatureToggle
                active={features.deepThink}
                onClick={() => setFeature("deepThink", !features.deepThink)}
                label="Think"
                title="Deep Think changes the agent instructions: more planning, todos, edge-case checks, and verification before finalizing."
              />
              {mode === "code" && (
                <FeatureToggle
                  active={features.planFirst}
                  onClick={() => setFeature("planFirst", !features.planFirst)}
                  label="Plan"
                  title="Plan first: VaultGate Code proposes an implementation plan for you to approve before it writes any code."
                />
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <ProjectSelector disabled={isStreaming} locked={rootLocked} selectedProjectId={selectedProjectId} lockedRootPath={lockedRootPath} onSelectProject={handleSelectProject} />
              {isStreaming ? (
                <>
                  <button
                    onClick={submit}
                    disabled={!canSubmit}
                    className="flex size-8 items-center justify-center rounded-full bg-foreground text-background transition hover:opacity-90 disabled:bg-secondary disabled:text-muted-foreground disabled:opacity-70"
                    title="Queue message after the current turn"
                  >
                    <ArrowUp className="size-4" />
                  </button>
                  <button
                    onClick={onStop}
                    className="flex size-8 items-center justify-center rounded-full bg-secondary text-foreground transition hover:bg-muted"
                    title={queued.length > 0 ? "Stop current turn; queued messages will continue" : "Stop"}
                  >
                    <Square className="size-3.5 fill-current" />
                  </button>
                </>
              ) : (
                <button
                  onClick={submit}
                  disabled={!canSubmit}
                  className="flex size-8 items-center justify-center rounded-full bg-foreground text-background transition hover:opacity-90 disabled:bg-secondary disabled:text-muted-foreground disabled:opacity-70"
                  title="Send"
                >
                  <ArrowUp className="size-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export interface UploadedAttachment {
  name: string;
  path: string;
  size: number;
  type?: string;
}

function SlashPalette({ commands, onPick }: { commands: SlashCommandDef[]; onPick: (command: SlashCommandDef) => void }) {
  const grouped = commands.reduce<Record<string, SlashCommandDef[]>>((acc, command) => {
    acc[command.category] = [...(acc[command.category] ?? []), command];
    return acc;
  }, {});

  return (
    <div className="mx-1 mb-1 overflow-hidden rounded-xl border border-primary/20 bg-background/95 shadow-xl shadow-black/10 backdrop-blur">
      <div className="border-b border-border/70 px-3 py-2 text-xs font-semibold text-primary">Slash commands</div>
      <div className="max-h-72 overflow-y-auto p-1">
        {Object.entries(grouped).map(([category, items]) => (
          <div key={category} className="py-1">
            <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{category}</div>
            {items.map((command) => (
              <button key={command.name} type="button" onClick={() => onPick(command)} className="flex w-full min-w-0 items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted">
                <span className="w-36 shrink-0 font-mono text-xs text-foreground">{formatSlashCommand(command)}</span>
                <span className="min-w-0 flex-1 text-xs text-muted-foreground">{command.description}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function FileMentionPalette({ files, onPick }: { files: FileMentionSuggestion[]; onPick: (file: FileMentionSuggestion) => void }) {
  return (
    <div className="mx-1 mb-1 overflow-hidden rounded-xl border border-primary/20 bg-background/95 shadow-xl shadow-black/10 backdrop-blur">
      <div className="border-b border-border/70 px-3 py-2 text-xs font-semibold text-primary">Workspace paths</div>
      <div className="max-h-72 overflow-y-auto p-1">
        {files.map((file) => (
          <button key={`${file.type}:${file.path}`} type="button" onClick={() => onPick(file)} className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted">
            {file.type === "directory" ? <Folder className="size-4 shrink-0 text-primary" /> : <FileText className="size-4 shrink-0 text-muted-foreground" />}
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{file.path}{file.type === "directory" ? "/" : ""}</span>
            {file.size !== undefined && <span className="shrink-0 text-[10px] text-muted-foreground">{formatBytes(file.size)}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function QueuedMessages({
  queued,
  isStreaming,
  onEdit,
  onRemove,
  onPromote,
  onStopAndSend,
  onClear,
}: {
  queued: QueuedMessage[];
  isStreaming: boolean;
  onEdit: (message: QueuedMessage) => void;
  onRemove: (id: string) => void;
  onPromote: (id: string) => void;
  onStopAndSend: (id: string) => void;
  onClear: () => void;
}) {
  const shown = queued.slice(0, 4);
  const hidden = queued.length - shown.length;

  return (
    <div className="m-1 overflow-hidden rounded-xl border border-primary/20 bg-primary/5">
      <div className="flex items-center gap-2 border-b border-primary/10 px-3 py-2">
        <span className="text-xs font-semibold text-primary">Queued {queued.length}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {isStreaming ? "Sends after the current turn. Stop keeps the queue." : "Ready to send next."}
        </span>
        <button type="button" onClick={onClear} className="text-xs font-medium text-muted-foreground transition-colors hover:text-destructive">
          Clear
        </button>
      </div>
      <div className="divide-y divide-primary/10">
        {shown.map((item, index) => (
          <div key={item.id} className="flex min-w-0 items-center gap-2 px-3 py-2">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-background text-[11px] font-medium text-muted-foreground">{index + 1}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-foreground" title={item.content}>
              {compactQueueText(item.content)}
            </span>
            {index > 0 && (
              <button type="button" onClick={() => onPromote(item.id)} className="rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground" title="Send this queued message next">
                Next
              </button>
            )}
            {isStreaming && (
              <button type="button" onClick={() => onStopAndSend(item.id)} className="rounded-md px-1.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-background" title="Stop the current turn and send this next">
                Stop &amp; send
              </button>
            )}
            <button type="button" onClick={() => onEdit(item)} className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground" title="Edit queued message">
              <Pencil className="size-3.5" />
            </button>
            <button type="button" onClick={() => onRemove(item.id)} className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-background hover:text-destructive" title="Remove queued message">
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
        {hidden > 0 && (
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
            <CornerDownRight className="size-3.5" />
            {hidden} more queued
          </div>
        )}
      </div>
    </div>
  );
}

function compactQueueText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function hasDraggedFiles(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

function FeatureToggle({
  active,
  onClick,
  label,
  title,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "flex h-7 items-center rounded-lg px-2 text-xs font-medium transition-colors",
        active
          ? "bg-primary/15 text-primary hover:bg-primary/20"
          : "text-secondary-foreground hover:bg-secondary hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}
