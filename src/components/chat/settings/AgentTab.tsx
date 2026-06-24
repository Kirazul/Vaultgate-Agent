"use client";
import { useSettingsStore } from "@/lib/store/settings-store";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { PermissionMode } from "@/types";

interface ParamDef {
  key: keyof ReturnType<typeof useSettingsStore.getState>["agentParams"];
  label: string;
  description: string;
  min: number;
  max: number;
  step: number;
}

const PARAMS: ParamDef[] = [
  { key: "temperature", label: "Temperature", description: "Controls randomness. 1.0 = default (creative, better tool decisions). Lower = more deterministic.", min: 0, max: 2, step: 0.1 },
  { key: "maxIterations", label: "Max Iterations", description: "Maximum tool-calling loops per turn. 128 = default. Set to 256 for complex multi-step tasks.", min: 8, max: 512, step: 8 },
  { key: "subAgentMaxIterations", label: "Sub-Agent Max Iterations", description: "Maximum iterations for background sub-agents.", min: 4, max: 256, step: 4 },
  { key: "maxContextChars", label: "Max Context (chars)", description: "When conversation exceeds this, old tool outputs are summarized to save context.", min: 50000, max: 500000, step: 10000 },
  { key: "providerRetryCount", label: "Provider Retry Count", description: "How many times to retry on provider errors (rate limits, timeouts, 500s).", min: 1, max: 30, step: 1 },
  { key: "providerRetryDelayMs", label: "Retry Delay (ms)", description: "Base delay between retries. Applies to rate limits and transient errors.", min: 1000, max: 30000, step: 1000 },
];

const PERMISSION_MODES: Array<{ id: PermissionMode; label: string; description: string }> = [
  { id: "auto-safe", label: "Auto Safe", description: "Run ordinary local work automatically; ask for destructive, external, or unknown actions." },
  { id: "ask", label: "Ask First", description: "Ask before every mutating shell, file, desktop, browser, schedule, or unknown tool action." },
  { id: "auto-approve", label: "Auto Approve", description: "Run all actions except catastrophic blocked operations. Best for trusted isolated workspaces." },
  { id: "read-only", label: "Read Only", description: "Allow reading, search, and analysis only. Block writes, shell mutations, UI control, and external effects." },
];

function ToggleSwitch({ checked, onChange, label, description }: { checked: boolean; onChange: (value: boolean) => void; label: string; description: string }) {
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
        className={cn("relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors", checked ? "bg-primary" : "bg-muted")}
      >
        <span className={cn("pointer-events-none inline-block size-3.5 transform rounded-full bg-white shadow-sm transition-transform", checked ? "translate-x-[18px]" : "translate-x-[3px]")} />
      </button>
    </label>
  );
}

export function AgentTab() {
  const agentParams = useSettingsStore((s) => s.agentParams);
  const setAgentParam = useSettingsStore((s) => s.setAgentParam);
  const approval = useSettingsStore((s) => s.approval);
  const setApproval = useSettingsStore((s) => s.setApproval);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Agent Tuning</h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Fine-tune the agent loop. These parameters control how the model is called, how many iterations it runs, and how errors are handled.
        </p>
      </div>

      <section className="space-y-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Permissions</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Choose how much autonomy tools have. Catastrophic actions stay blocked when hard blocking is enabled.</p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {PERMISSION_MODES.map((mode) => (
            <button
              key={mode.id}
              onClick={() => setApproval("mode", mode.id)}
              className={cn(
                "rounded-xl border px-3 py-2 text-left transition-all",
                approval.mode === mode.id ? "border-primary/50 bg-primary/5 shadow-sm" : "border-card-border bg-background hover:border-border hover:bg-muted/40",
              )}
            >
              <span className="text-xs font-medium text-foreground">{mode.label}</span>
              <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{mode.description}</p>
            </button>
          ))}
        </div>
        <div className="space-y-1.5">
          <ToggleSwitch
            checked={approval.askForUnknownMcp}
            onChange={(value) => setApproval("askForUnknownMcp", value)}
            label="Ask for Unknown MCP Tools"
            description="Unknown external tool calls ask first unless the tool name clearly looks read-only."
          />
          <ToggleSwitch
            checked={approval.askForExternalActions}
            onChange={(value) => setApproval("askForExternalActions", value)}
            label="Ask for External UI Actions"
            description="Ask before visible browser or desktop actions that may submit, publish, delete, pay, log in, or send."
          />
          <ToggleSwitch
            checked={approval.hardBlockDangerous}
            onChange={(value) => setApproval("hardBlockDangerous", value)}
            label="Hard-Block Dangerous Commands"
            description="Refuse catastrophic root deletes, disk formatting, raw block writes, fork bombs, and shutdown commands."
          />
        </div>
      </section>

      <div className="space-y-4">
        {PARAMS.map((param) => (
          <div key={param.key} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-foreground">{param.label}</label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={param.min}
                  max={param.max}
                  step={param.step}
                  value={agentParams[param.key]}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!isNaN(v) && v >= param.min && v <= param.max) setAgentParam(param.key, v);
                  }}
                  className="h-7 w-24 text-right text-xs tabular-nums"
                />
              </div>
            </div>
            <input
              type="range"
              min={param.min}
              max={param.max}
              step={param.step}
              value={agentParams[param.key]}
              onChange={(e) => setAgentParam(param.key, Number(e.target.value))}
              className="w-full accent-primary"
            />
            <p className="text-[10px] text-muted-foreground">{param.description}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
        <p className="text-[10px] font-medium text-muted-foreground">Defaults:</p>
        <div className="mt-1 text-[10px] tabular-nums text-muted-foreground">
          128 iterations · temperature 1.0 · 180k char context · 10 retries · Auto Safe permissions
        </div>
      </div>
    </div>
  );
}
