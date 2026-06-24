"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useSettingsStore } from "@/lib/store/settings-store";
import { ProviderIcon } from "@/components/icons/ProviderIcon";
import { modelProviderIcon } from "@/lib/ai/provider-icons";
import { cn } from "@/lib/utils";

// Friendly provider labels for the grouped dropdown headers.
const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  xai: "xAI",
  deepseek: "DeepSeek",
  mistral: "Mistral",
  alibaba: "Qwen",
  moonshotai: "Moonshot",
  zhipuai: "Zhipu",
  cohere: "Cohere",
  llama: "Meta Llama",
  minimax: "MiniMax",
  perplexity: "Perplexity",
  nvidia: "NVIDIA",
  groq: "Groq",
  "ollama-cloud": "Ollama",
  lmstudio: "LM Studio",
  opencode: "Other",
};

function providerLabel(id: string): string {
  return PROVIDER_LABELS[id] ?? id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Composer model selector — a compact pill showing the active model's provider
 * logo + name, opening a provider-grouped picker upward. Logos come from the
 * shared sprite (see ProviderIcon).
 */
export function ModelSelector() {
  const models = useSettingsStore((s) => s.models);
  const model = useSettingsStore((s) => s.provider.model);
  const setModel = useSettingsStore((s) => s.setModel);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const options = model && !models.includes(model) ? [model, ...models] : models;

  // Group options by inferred provider, preserving first-seen order.
  const groups = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const opt of options) {
      const key = modelProviderIcon(opt);
      const list = map.get(key) ?? [];
      list.push(opt);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [options]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-7 min-w-0 max-w-full cursor-pointer items-center gap-1.5 rounded-lg pl-1.5 pr-1 text-xs outline-none transition-colors hover:bg-secondary"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={model || "Select a model"}
      >
        {model && <ProviderIcon model={model} size={15} className="opacity-90" />}
        <span className={cn("min-w-0 select-none truncate text-xs", model ? "text-secondary-foreground" : "text-muted-foreground")}>{model || "Select a model"}</span>
        <ChevronDown className={cn("size-3.5 shrink-0 text-secondary-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="vg-slide-in absolute bottom-full left-0 z-50 mb-2 w-72 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-card-border bg-popover text-popover-foreground shadow-2xl" role="listbox">
          <div className="max-h-[50vh] overflow-y-auto p-1">
            {options.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">No models loaded</div>
            ) : (
              groups.map(([providerId, list], groupIndex) => (
                <div key={providerId} className={cn(groupIndex > 0 && "mt-1")}>
                  <div className="flex items-center gap-1.5 px-2.5 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                    <ProviderIcon id={providerId} size={12} className="opacity-70" />
                    {providerLabel(providerId)}
                  </div>
                  {list.map((option) => {
                    const selected = option === model;
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => {
                          setModel(option);
                          setOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
                          selected ? "bg-secondary text-foreground" : "text-secondary-foreground hover:bg-muted",
                        )}
                        role="option"
                        aria-selected={selected}
                        title={option}
                      >
                        <ProviderIcon model={option} size={15} className="opacity-90" />
                        <span className="min-w-0 flex-1 truncate">{option}</span>
                        <Check className={cn("size-4 shrink-0 text-primary", selected ? "opacity-100" : "opacity-0")} />
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
