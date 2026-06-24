"use client";
import { useSettingsStore } from "@/lib/store/settings-store";
import { MODES, MODE_ORDER, DEFAULT_MODE, type ModeDef } from "@/lib/modes";
import { cn } from "@/lib/utils";
import type { ChatMode } from "@/types";

const KEYBOARD_SHORTCUTS: { keys: string; description: string }[] = [
  { keys: "Enter", description: "Send message" },
  { keys: "Shift + Enter", description: "New line in composer" },
  { keys: "Enter Enter", description: "Stop streaming (double-tap)" },
  { keys: "Escape Escape", description: "Clear composer (double-tap)" },
  { keys: "↑", description: "Edit last message (when composer empty)" },
  { keys: "/", description: "Open slash command palette" },
  { keys: "@", description: "Mention a file" },
  { keys: "Ctrl + ,", description: "Open Settings" },
  { keys: "Ctrl + I", description: "Open Inventory" },
  { keys: "Ctrl + B", description: "Toggle sidebar" },
];

function ToggleSwitch({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-card-border bg-background px-3 py-2.5">
      <div className="min-w-0">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <p className="text-[10px] text-muted-foreground">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors",
          checked ? "bg-primary" : "bg-muted",
        )}
      >
        <span className={cn("pointer-events-none inline-block size-3.5 transform rounded-full bg-white shadow-sm transition-transform", checked ? "translate-x-[18px]" : "translate-x-[3px]")} />
      </button>
    </label>
  );
}

export function GeneralTab() {
  const mode = useSettingsStore((s) => s.mode);
  const setMode = useSettingsStore((s) => s.setMode);
  const autoMode = useSettingsStore((s) => s.autoMode);
  const setAutoMode = useSettingsStore((s) => s.setAutoMode);
  const features = useSettingsStore((s) => s.features);
  const setFeature = useSettingsStore((s) => s.setFeature);
  const resetPrefs = useSettingsStore((s) => s.resetPrefs);

  return (
    <div className="space-y-6">
      {/* Default Mode */}
      <section className="space-y-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Default Mode</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Choose which mode new conversations start in. Auto mode lets the agent switch freely between modes.</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {MODE_ORDER.map((id) => {
            const m: ModeDef = MODES[id];
            const Icon = m.icon;
            const active = mode === id;
            return (
              <button
                key={id}
                onClick={() => setMode(id as ChatMode)}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-center transition-all",
                  active ? "border-primary/50 bg-primary/5 shadow-sm" : "border-card-border bg-background hover:border-border hover:bg-muted/40",
                )}
              >
                <Icon className={cn("size-5", active ? "text-primary" : "text-muted-foreground")} />
                <span className={cn("text-xs font-medium", active ? "text-foreground" : "text-secondary-foreground")}>{m.label}</span>
                <span className="text-[10px] leading-tight text-muted-foreground">{m.description}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Toggles */}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Behavior</h3>
        <div className="space-y-1.5">
          <ToggleSwitch
            checked={autoMode}
            onChange={setAutoMode}
            label="Auto Mode"
            description="Let the agent freely switch between Agent, Code, and Chat modes as needed."
          />
          <ToggleSwitch
            checked={features.deepThink}
            onChange={(v) => setFeature("deepThink", v)}
            label="Deep Think"
            description="Enable extended reasoning: TodoWrite planning, inspect-before-acting, edge case consideration."
          />
          <ToggleSwitch
            checked={features.webSearch}
            onChange={(v) => setFeature("webSearch", v)}
            label="Web Search"
            description="Proactively use WebSearch/WebFetch for current information, docs, and research."
          />
          <ToggleSwitch
            checked={features.autoImprove}
            onChange={(v) => setFeature("autoImprove", v)}
            label="Auto Improve"
            description="Let the agent fix routine build, config, dependency, and runtime issues without stopping at the first error."
          />
          <ToggleSwitch
            checked={features.planFirst}
            onChange={(v) => setFeature("planFirst", v)}
            label="Plan First (Code mode)"
            description="Require an implementation plan and your approval before any code changes."
          />
        </div>
      </section>

      {/* Keyboard shortcuts */}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Keyboard Shortcuts</h3>
        <div className="rounded-lg border border-card-border bg-background">
          {KEYBOARD_SHORTCUTS.map((shortcut, i) => (
            <div key={shortcut.keys} className={cn("flex items-center justify-between px-3 py-1.5", i > 0 && "border-t border-border/50")}>
              <span className="text-[11px] text-muted-foreground">{shortcut.description}</span>
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-secondary-foreground">{shortcut.keys}</kbd>
            </div>
          ))}
        </div>
      </section>

      {/* Reset */}
      <section>
        <button
          onClick={resetPrefs}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Reset to defaults
        </button>
        <p className="mt-1 text-[10px] text-muted-foreground">Resets mode and auto-mode to defaults ({MODES[DEFAULT_MODE].label}, auto on).</p>
      </section>
    </div>
  );
}
