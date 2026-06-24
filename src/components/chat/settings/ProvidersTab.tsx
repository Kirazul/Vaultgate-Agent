"use client";
import { useEffect, useState } from "react";
import { RefreshCw, Plus, Trash2, Pencil, Check, KeyRound } from "lucide-react";
import { useSettingsStore } from "@/lib/store/settings-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CAPABILITIES, type Capability, type ProviderSummary } from "@/types";
import { cn } from "@/lib/utils";

const CAP_LABEL: Record<Capability, string> = {
  chat: "Chat (main agent)",
  vision: "Vision (image/video)",
  image: "Image generation",
};

export function ProvidersTab() {
  const providers = useSettingsStore((s) => s.providers);
  const roles = useSettingsStore((s) => s.roles);
  const upsertProvider = useSettingsStore((s) => s.upsertProvider);
  const removeProvider = useSettingsStore((s) => s.removeProvider);
  const assignRole = useSettingsStore((s) => s.assignRole);
  const fetchModelsFor = useSettingsStore((s) => s.fetchModelsFor);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const resetForm = () => { setEditingId(null); setName(""); setEndpoint(""); setApiKey(""); };

  useEffect(() => { resetForm(); }, []);

  const startEdit = (id: string) => {
    const p = providers.find((x) => x.id === id);
    if (!p) return;
    setEditingId(id);
    setName(p.name);
    setEndpoint(p.endpoint);
    setApiKey("");
  };

  const saveProviderForm = async () => {
    if (!endpoint.trim() && !name.trim()) return;
    setBusy("save");
    const id = await upsertProvider({ id: editingId ?? undefined, name, endpoint, ...(apiKey ? { apiKey } : {}) });
    setBusy(null);
    resetForm();
    if (id) void fetchModelsFor(id);
  };

  const fetchModels = async (id: string) => {
    setBusy(id);
    await fetchModelsFor(id);
    setBusy(null);
  };

  return (
    <div className="space-y-6">
      {/* Providers */}
      <section className="space-y-3">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Providers</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Add any number of OpenAI-compatible endpoints. Keys are stored locally and never leave your machine.</p>
        </div>
        <div className="space-y-2">
          {providers.length === 0 && <p className="text-xs text-muted-foreground">No providers yet — add one below.</p>}
          {providers.map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-lg border border-card-border bg-background px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{p.name}</span>
                  <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]", p.keySet ? "bg-green-500/15 text-green-400" : "bg-warning/15 text-warning-foreground")}>
                    <KeyRound className="size-2.5" />{p.keySet ? "key set" : "no key"}
                  </span>
                </div>
                <p className="truncate text-[11px] text-muted-foreground">
                  {p.endpoint || "no endpoint"} · {p.models.length} models · {Object.keys(p.modelInfo ?? {}).length} cataloged
                </p>
              </div>
              <button onClick={() => void fetchModels(p.id)} disabled={busy === p.id} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Fetch models">
                <RefreshCw className={busy === p.id ? "size-3.5 animate-spin" : "size-3.5"} />
              </button>
              <button onClick={() => startEdit(p.id)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Edit">
                <Pencil className="size-3.5" />
              </button>
              <button onClick={() => void removeProvider(p.id)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive" title="Delete">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
        <div className="space-y-2.5 rounded-lg border border-dashed border-border p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">{editingId ? "Edit provider" : "Add provider"}</span>
            {editingId && <button onClick={resetForm} className="text-[11px] text-muted-foreground hover:text-foreground">Cancel</button>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. OpenAI)" />
            <Input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://api…/v1" />
          </div>
          <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={editingId ? "API key (leave blank to keep)" : "API key (sk-…)"} />
          <Button onClick={() => void saveProviderForm()} size="sm" disabled={busy === "save"}>
            {editingId ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
            {editingId ? "Save changes" : "Add provider"}
          </Button>
        </div>
      </section>

      {/* Model roles */}
      <section className="space-y-3">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Model roles</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Assign a model to each capability. Vision and image generation fall back to the Chat model when left as Default.</p>
        </div>
        <div className="space-y-2">
          {CAPABILITIES.map((cap) => (
            <RoleRow key={cap} cap={cap} label={CAP_LABEL[cap]} providers={providers} assignment={roles[cap]} onAssign={(a) => void assignRole(cap, a)} />
          ))}
        </div>
      </section>
    </div>
  );
}

function RoleRow({ cap, label, providers, assignment, onAssign }: {
  cap: Capability; label: string; providers: Pick<ProviderSummary, "id" | "name" | "models" | "modelInfo">[];
  assignment: { providerId: string; model: string } | undefined;
  onAssign: (a: { providerId: string; model: string } | null) => void;
}) {
  const providerId = assignment?.providerId ?? "";
  const model = assignment?.model ?? "";
  const selectedProvider = providers.find((p) => p.id === providerId);
  const isChat = cap === "chat";
  const selectCls = "h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring [&>option]:bg-popover [&>option]:text-popover-foreground";

  return (
    <div className="grid grid-cols-[1fr_1fr_1fr] items-center gap-2">
      <span className="text-xs text-foreground">{label}</span>
      <select className={selectCls} value={providerId} onChange={(e) => {
        const pid = e.target.value;
        if (!pid) return onAssign(null);
        const p = providers.find((x) => x.id === pid);
        onAssign({ providerId: pid, model: p?.models[0] ?? model ?? "" });
      }}>
        <option value="">{isChat ? "Select…" : "Default (use Chat)"}</option>
        {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <select className={selectCls} value={model} disabled={!providerId} onChange={(e) => onAssign({ providerId, model: e.target.value })}>
        <option value="">{providerId ? "Select model…" : "—"}</option>
        {(selectedProvider?.models ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
    </div>
  );
}
