"use client";
import { BrainCircuit } from "lucide-react";

export function MemoryTab() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
        <BrainCircuit className="size-6 text-muted-foreground" />
      </div>
      <h3 className="mt-4 text-sm font-semibold">Memory</h3>
      <p className="mt-1 max-w-sm text-xs text-muted-foreground">
        Persistent memory across conversations is on the roadmap — the agent will remember your preferences, projects, and facts you tell it. Coming soon.
      </p>
      <span className="mt-3 rounded-full border border-border px-2.5 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">Planned</span>
    </div>
  );
}
