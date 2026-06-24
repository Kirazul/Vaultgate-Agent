"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Globe, Monitor, Terminal, Search, CheckSquare,
  Users, ToggleLeft, Loader2, Eye, Zap, Layers,
  FileText, Pencil, Trash2, FolderOpen, Download,
  AtSign, History, Columns, Clipboard, Clock, Puzzle,
  HelpCircle, Move, FilePlus, GitMerge, Activity,
  Box, Image, Mic,
} from "lucide-react";
import type { Feature, FeatureCategory } from "@/types";
import { cn } from "@/lib/utils";

const ICON_MAP: Record<string, React.ReactNode> = {
  globe: <Globe className="size-3.5" />,
  monitor: <Monitor className="size-3.5" />,
  terminal: <Terminal className="size-3.5" />,
  search: <Search className="size-3.5" />,
  "check-square": <CheckSquare className="size-3.5" />,
  users: <Users className="size-3.5" />,
  "toggle-left": <ToggleLeft className="size-3.5" />,
  eye: <Eye className="size-3.5" />,
  zap: <Zap className="size-3.5" />,
  layers: <Layers className="size-3.5" />,
  "file-text": <FileText className="size-3.5" />,
  pencil: <Pencil className="size-3.5" />,
  "trash-2": <Trash2 className="size-3.5" />,
  folder: <FolderOpen className="size-3.5" />,
  download: <Download className="size-3.5" />,
  "at-sign": <AtSign className="size-3.5" />,
  history: <History className="size-3.5" />,
  columns: <Columns className="size-3.5" />,
  clipboard: <Clipboard className="size-3.5" />,
  clock: <Clock className="size-3.5" />,
  puzzle: <Puzzle className="size-3.5" />,
  "help-circle": <HelpCircle className="size-3.5" />,
  move: <Move className="size-3.5" />,
  "file-plus": <FilePlus className="size-3.5" />,
  "git-merge": <GitMerge className="size-3.5" />,
  activity: <Activity className="size-3.5" />,
  box: <Box className="size-3.5" />,
  image: <Image className="size-3.5" />,
  mic: <Mic className="size-3.5" />,
};

const CATEGORY_ORDER: FeatureCategory[] = ["browser", "desktop", "multimodal", "code", "research", "planning", "agents", "control"];

const CATEGORY_LABELS: Record<FeatureCategory, string> = {
  browser: "Browser Control",
  desktop: "Desktop Control",
  code: "Code & File Operations",
  research: "Research & Web",
  planning: "Planning & Tracking",
  agents: "Agents & Delegation",
  multimodal: "Multimodal",
  control: "Flow Control",
};

const CATEGORY_ICONS: Record<FeatureCategory, React.ReactNode> = {
  browser: <Globe className="size-3.5" />,
  desktop: <Monitor className="size-3.5" />,
  code: <Terminal className="size-3.5" />,
  research: <Search className="size-3.5" />,
  planning: <CheckSquare className="size-3.5" />,
  agents: <Users className="size-3.5" />,
  multimodal: <Eye className="size-3.5" />,
  control: <ToggleLeft className="size-3.5" />,
};

export function FeaturesTab() {
  const [features, setFeatures] = useState<Feature[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/features", { cache: "no-store" });
      const data = (await res.json()) as { features?: Feature[] };
      setFeatures(data.features ?? []);
    } catch {
      setFeatures([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="size-4 animate-spin" /></div>;
  }

  const activeFeatures = features.filter((f) => f.status === "active");
  const availableFeatures = features.filter((f) => f.status === "available");

  const grouped = new Map<FeatureCategory, Feature[]>();
  for (const f of activeFeatures) {
    const list = grouped.get(f.category) ?? [];
    list.push(f);
    grouped.set(f.category, list);
  }

  const availableGrouped = new Map<FeatureCategory, Feature[]>();
  for (const f of availableFeatures) {
    const list = availableGrouped.get(f.category) ?? [];
    list.push(f);
    availableGrouped.set(f.category, list);
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-3 space-y-5">
      {/* Active features */}
      {activeFeatures.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-1.5">
            <Zap className="size-3.5 text-primary" />
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Active Features</h3>
            <span className="text-[10px] text-muted-foreground/50">— equipped in current mode</span>
          </div>
          {CATEGORY_ORDER.filter((cat) => grouped.has(cat)).map((cat) => (
            <CategoryGroup key={cat} category={cat} features={grouped.get(cat)!} active />
          ))}
        </div>
      )}

      {/* Available in other modes */}
      {availableFeatures.length > 0 && (
        <div className="space-y-3 opacity-60">
          <div className="flex items-center gap-1.5">
            <Box className="size-3.5 text-muted-foreground" />
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Available in Other Modes</h3>
          </div>
          {CATEGORY_ORDER.filter((cat) => availableGrouped.has(cat)).map((cat) => (
            <CategoryGroup key={cat} category={cat} features={availableGrouped.get(cat)!} active={false} />
          ))}
        </div>
      )}
    </div>
  );
}

function CategoryGroup({ category, features, active }: { category: FeatureCategory; features: Feature[]; active: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 pb-1.5">
        <span className={cn("opacity-70", active ? "text-primary" : "text-muted-foreground")}>{CATEGORY_ICONS[category]}</span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{CATEGORY_LABELS[category]}</span>
      </div>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {features.map((f) => <FeatureCard key={f.id} feature={f} active={active} />)}
      </div>
    </div>
  );
}

function FeatureCard({ feature, active }: { feature: Feature; active: boolean }) {
  return (
    <div className={cn(
      "flex items-start gap-2.5 rounded-lg border px-3 py-2 transition-all duration-150",
      active
        ? "border-primary/30 bg-primary/[0.04] hover:border-primary/50 hover:shadow-sm"
        : "border-card-border bg-background",
    )}>
      <span className={cn(
        "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md",
        active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
      )}>
        {ICON_MAP[feature.icon] ?? <Box className="size-3.5" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-xs font-medium text-foreground">{feature.name}</span>
          <div className="flex shrink-0 gap-0.5">
            {feature.modes.map((m) => (
              <span key={m} className="rounded bg-muted px-1 py-px text-[9px] font-medium text-muted-foreground">{m}</span>
            ))}
          </div>
        </div>
        <p className="mt-0.5 line-clamp-1 text-[10px] text-muted-foreground">{feature.description}</p>
      </div>
    </div>
  );
}
