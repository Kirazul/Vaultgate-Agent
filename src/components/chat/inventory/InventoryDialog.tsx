"use client";
import { X, Boxes, Zap, Puzzle, BrainCircuit, Server } from "lucide-react";
import { useUiStore } from "@/lib/store/ui-store";
import { useMountTransition } from "@/hooks/use-mount-transition";
import { cn } from "@/lib/utils";
import { FeaturesTab } from "./FeaturesTab";
import { SkillsTab } from "./SkillsTab";
import { McpTab } from "./McpTab";
import { MemoryTab } from "./MemoryTab";

interface TabDef {
  id: string;
  label: string;
  icon: React.ReactNode;
  component: React.ComponentType;
}

const TABS: TabDef[] = [
  { id: "features", label: "Features", icon: <Zap className="size-3.5" />, component: FeaturesTab },
  { id: "skills",   label: "Skills",   icon: <Puzzle className="size-3.5" />, component: SkillsTab },
  { id: "mcp",      label: "MCP",      icon: <Server className="size-3.5" />, component: McpTab },
  { id: "memory",   label: "Memory",   icon: <BrainCircuit className="size-3.5" />, component: MemoryTab },
];

export function InventoryDialog() {
  const open = useUiStore((s) => s.inventoryOpen);
  const setOpen = useUiStore((s) => s.setInventoryOpen);
  const tab = useUiStore((s) => s.inventoryTab);
  const setTab = useUiStore((s) => s.setInventoryTab);
  const { mounted, closing } = useMountTransition(open, 180);

  if (!mounted) return null;

  const activeDef = TABS.find((t) => t.id === tab) ?? TABS[0];
  const ActiveComponent = activeDef.component;

  return (
    <div className={cn("fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]", closing ? "vg-overlay-out" : "vg-overlay-in")} onClick={() => setOpen(false)}>
      <div
        className={cn("flex h-[80vh] max-h-[760px] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl", closing ? "vg-pop-out" : "vg-pop-in")}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Boxes className="size-4 text-primary" />
            <h2 className="text-sm font-semibold">Inventory</h2>
          </div>
          <button onClick={() => setOpen(false)} className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex shrink-0 gap-1 border-b border-border px-3 pt-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-xs font-medium transition-colors",
                tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-hidden">
          <ActiveComponent />
        </div>
      </div>
    </div>
  );
}
