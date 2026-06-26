"use client";
import { useEffect, useRef, useState } from "react";
import { FolderOpen } from "lucide-react";
import { Composer } from "./Composer";
import type { UploadedAttachment } from "./Composer";
import { useSettingsStore } from "@/lib/store/settings-store";
import { useProjectStore } from "@/lib/store/project-store";
import { modeDef } from "@/lib/modes";
import { cn } from "@/lib/utils";

const INTRO_LINES = [
  "What are we building today?",
  "Drop a task, a file, or a rough idea — I'll inspect first, then act.",
  "What should we work on?",
  "Bring the bug, the goal, or the stuck part.",
  "Where should we start?",
];

export function WelcomeScreen({ chatId, onSend, onStop, onAttach }: { chatId?: string | null; onSend: (text: string) => void; onStop: () => void; onAttach?: (files: File[]) => Promise<UploadedAttachment[]> }) {
  const model = useSettingsStore((s) => s.provider.model);
  const mode = useSettingsStore((s) => s.mode);
  const autoMode = useSettingsStore((s) => s.autoMode);
  const activeProject = useProjectStore((s) => {
    const id = s.activeProjectId;
    return id ? s.projects.find((p) => p.id === id) : undefined;
  });
  const [line] = useState(() => INTRO_LINES[Math.floor(Math.random() * INTRO_LINES.length)]);
  const [leaving, setLeaving] = useState(false);

  const def = modeDef(mode);
  const accent = def.accent;
  // Auto mode with nothing sent yet → just "VaultGate". A locked mode shows the
  // mode word with its accent gradient.
  const showModeWord = !autoMode;

  // Animate the mode word whenever it changes (manual switch).
  const [wordKey, setWordKey] = useState(def.short);
  const prevWord = useRef(def.short);
  useEffect(() => {
    if (prevWord.current !== def.short) {
      prevWord.current = def.short;
      setWordKey(`${def.short}-${Date.now()}`);
    }
  }, [def.short]);

  const handleSend = (text: string) => {
    if (text.trim()) setLeaving(true);
    onSend(text);
  };

  return (
    <div className={cn("flex h-full flex-col bg-[var(--ui-bg-chrome)]", leaving && "welcome-shell-leaving")}>
      {/* Centered hero: title + intro + composer all sit together, vertically
          centered. On the first send the whole block lifts away and ChatApp
          swaps to the standard bottom-docked composer — reading as the input
          smoothly relocating down into the conversation. */}
      <div className="flex flex-1 flex-col items-center justify-center px-3 text-center">
        <div className={cn("flex w-full flex-col items-center", leaving ? "welcome-hero welcome-hero-leaving" : "welcome-hero")}>
          <h1 className="select-none text-5xl font-bold uppercase tracking-[0.14em] sm:text-6xl">
            <span className="text-foreground/90">VaultGate</span>
            {showModeWord && (
              <>
                {" "}
                <span
                  key={wordKey}
                  className="welcome-mode-word"
                  style={
                    {
                      "--mode-accent": accent,
                      backgroundImage: `linear-gradient(110deg, ${accent}, color-mix(in srgb, ${accent} 55%, #ffffff), ${accent})`,
                    } as React.CSSProperties
                  }
                >
                  {def.short}
                </span>
              </>
            )}
          </h1>
          <p className="mx-auto mt-4 max-w-[var(--composer-width)] px-3 text-sm leading-normal text-[var(--ui-text-tertiary)]">
            {model ? line : "Open Settings to connect your AI provider, then send your first message."}
          </p>
          {activeProject && (
            <div className="mx-auto mt-5 flex w-fit max-w-[var(--composer-width)] items-center gap-2 rounded-full border border-[var(--ui-stroke-tertiary)] bg-[var(--ui-bg-card)] px-3 py-1">
              <FolderOpen className="size-3.5" style={{ color: accent }} />
              <span className="text-xs font-medium text-foreground">{activeProject.name}</span>
              <span className="max-w-[300px] truncate text-[11px] text-[var(--ui-text-quaternary)]">{activeProject.path}</span>
            </div>
          )}

          {/* Composer sits right under the title while empty. */}
          <div className="mt-6 w-full">
            <Composer chatId={chatId} onSend={handleSend} onStop={onStop} onAttach={onAttach} />
          </div>
        </div>
      </div>
    </div>
  );
}
