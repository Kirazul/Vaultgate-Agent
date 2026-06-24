"use client";
import { FolderOpen, Monitor } from "lucide-react";
import { Composer } from "./Composer";
import type { UploadedAttachment } from "./Composer";
import { useSettingsStore } from "@/lib/store/settings-store";
import { useProjectStore } from "@/lib/store/project-store";

export function WelcomeScreen({ chatId, onSend, onStop, onAttach }: { chatId?: string | null; onSend: (text: string) => void; onStop: () => void; onAttach?: (files: File[]) => Promise<UploadedAttachment[]> }) {
  const model = useSettingsStore((s) => s.provider.model);
  const activeProject = useProjectStore((s) => {
    const id = s.activeProjectId;
    return id ? s.projects.find((p) => p.id === id) : undefined;
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col items-center justify-end pb-6">
        <h1 className="text-3xl font-semibold tracking-tight">VaultGate</h1>
        {activeProject ? (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-1.5">
            <FolderOpen className="size-4 text-primary" />
            <span className="text-sm font-medium text-foreground">{activeProject.name}</span>
            <span className="text-xs text-muted-foreground truncate max-w-[300px]">{activeProject.path}</span>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            {model ? (
              <span className="flex items-center gap-1.5">
                <Monitor className="size-4 inline opacity-50" />
                Working locally — select a project or ask anything.
              </span>
            ) : (
              "Open Settings to connect your AI provider."
            )}
          </p>
        )}
      </div>
      <div className="flex-1">
        <Composer chatId={chatId} onSend={onSend} onStop={onStop} onAttach={onAttach} />
      </div>
    </div>
  );
}
