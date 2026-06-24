"use client";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useSettingsStore } from "@/lib/store/settings-store";
import { MODE_ORDER, modeDef } from "@/lib/modes";
import { cn } from "@/lib/utils";

/**
 * Minimized mode control: Auto + the three branches. Auto lets the model
 * switch branches itself (unlimited); a manual pick locks the model to that
 * branch. Icon-only except the active item, which shows its label. Disabled
 * while a response is generating — modes only change when idle.
 */
export function ModeSwitcher({ disabled = false }: { disabled?: boolean }) {
  const mode = useSettingsStore((s) => s.mode);
  const setMode = useSettingsStore((s) => s.setMode);
  const autoMode = useSettingsStore((s) => s.autoMode);
  const setAutoMode = useSettingsStore((s) => s.setAutoMode);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const items: Array<{ key: string; label: string; active: boolean; title: string; onSelect: () => void }> = [
    {
      key: "auto",
      label: "Auto",
      active: autoMode,
      title: "Auto — the agent picks the right mode and switches itself (unlimited)",
      onSelect: () => setAutoMode(true),
    },
    ...MODE_ORDER.map((id) => {
      const def = modeDef(id);
      return {
        key: id,
        label: def.short,
        active: !autoMode && mode === id,
        title: `${def.label} (locked) — ${def.description}`,
        onSelect: () => {
          setAutoMode(false);
          setMode(id);
        },
      };
    }),
  ];
  const active = items.find((item) => item.active) ?? items[0];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
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
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary hover:text-foreground",
          active.key === "auto" && "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary",
          disabled && "cursor-not-allowed opacity-50",
        )}
        title={disabled ? "Finish the current response to change modes" : active.title}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span>{active.label}</span>
        <ChevronDown className={cn("size-3 opacity-60 transition-transform", open && "rotate-180")} />
      </button>

      {open && !disabled && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-44 overflow-hidden rounded-xl border border-card-border bg-popover p-1 text-popover-foreground shadow-2xl shadow-black/40 dark:bg-[#141414]" role="menu">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                item.onSelect();
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                item.active ? "bg-secondary text-foreground" : "text-secondary-foreground hover:bg-muted hover:text-foreground",
              )}
              title={item.title}
              role="menuitem"
            >
              <Check className={cn("size-3.5", item.active ? "opacity-100" : "opacity-0")} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
