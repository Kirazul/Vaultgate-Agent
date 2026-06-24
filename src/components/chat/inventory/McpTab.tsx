"use client";
import { useCallback, useEffect, useState } from "react";
import { Search, Plus, Trash2, Power, PowerOff, RefreshCw, Loader2, Server, Wrench, ChevronLeft, AlertCircle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface McpServerEntry {
  name: string;
  config: {
    type?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
  };
  enabled: boolean;
}

interface McpToolDef {
  name: string;
  description: string;
  serverName: string;
}

interface McpServerState {
  name: string;
  status: "connected" | "connecting" | "failed" | "disabled";
  tools: McpToolDef[];
  error?: string;
}

type AddForm = {
  name: string;
  type: "stdio" | "sse" | "http";
  command: string;
  args: string;
  url: string;
  env: string;
};

const EMPTY_FORM: AddForm = { name: "", type: "stdio", command: "", args: "", url: "", env: "" };

export function McpTab() {
  const [servers, setServers] = useState<McpServerEntry[]>([]);
  const [states, setStates] = useState<McpServerState[]>([]);
  const [tools, setTools] = useState<McpToolDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<AddForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<McpServerEntry | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/mcp", { cache: "no-store" });
      const data = await res.json() as { servers?: McpServerEntry[]; states?: McpServerState[]; tools?: McpToolDef[] };
      setServers(data.servers ?? []);
      setStates(data.states ?? []);
      setTools(data.tools ?? []);
    } catch {
      setServers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const doAction = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json() as { servers?: McpServerEntry[]; error?: string };
      if (!res.ok) { setError(data.error ?? "Operation failed."); return; }
      if (data.servers) setServers(data.servers);
      await load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  const addServer = async () => {
    const config: Record<string, unknown> = {};
    if (form.type === "stdio") {
      config.type = "stdio";
      config.command = form.command;
      config.args = form.args.split(/\s+/).filter(Boolean);
      if (form.env.trim()) {
        try { config.env = JSON.parse(form.env); } catch { setError("Env must be valid JSON."); return; }
      }
    } else {
      config.type = form.type;
      config.url = form.url;
    }
    await doAction({ action: "add", name: form.name, config });
    setAdding(false);
    setForm(EMPTY_FORM);
  };

  const removeServer = async (name: string) => { await doAction({ action: "remove", name }); setDetail(null); };
  const toggleServer = async (name: string, enabled: boolean) => { await doAction({ action: "toggle", name, enabled }); };
  const reconnectServer = async (name: string) => { await doAction({ action: "reconnect", name }); };
  const connectAll = async () => { await doAction({ action: "connect" }); };

  const stateFor = (name: string) => states.find((s) => s.name === name);
  const toolsFor = (name: string) => tools.filter((t) => t.serverName === name);

  // ── Detail view ──
  if (detail) {
    const st = stateFor(detail.name);
    const serverTools = toolsFor(detail.name);
    return (
      <div key={detail.name} className="vg-slide-in flex h-full flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-5 py-3">
          <button onClick={() => setDetail(null)} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <ChevronLeft className="size-3.5" />Back
          </button>
          <div className="flex min-w-0 items-center gap-2">
            <Server className="size-4 shrink-0 text-primary" />
            <span className="truncate text-sm font-medium">{detail.name}</span>
            <StatusBadge status={st?.status ?? (detail.enabled ? "connecting" : "disabled")} />
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <Button size="sm" variant="outline" onClick={() => void reconnectServer(detail.name)} disabled={busy}>
              <RefreshCw className="size-3" />Reconnect
            </Button>
            <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => void removeServer(detail.name)} disabled={busy}>
              <Trash2 className="size-3" />Remove
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Config */}
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">Configuration</p>
            <pre className="text-[11px] text-foreground whitespace-pre-wrap break-all">{JSON.stringify(detail.config, null, 2)}</pre>
          </div>
          {st?.error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
              <AlertCircle className="size-3.5 mt-0.5 shrink-0 text-destructive" />
              <p className="text-xs text-destructive">{st.error}</p>
            </div>
          )}
          {/* Tools */}
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-2">
              Tools ({serverTools.length})
            </p>
            {serverTools.length === 0 ? (
              <p className="text-xs text-muted-foreground">No tools discovered.</p>
            ) : (
              <div className="space-y-1.5">
                {serverTools.map((t) => (
                  <div key={t.name} className="flex items-start gap-2 rounded-md border border-border bg-background px-3 py-2">
                    <Wrench className="size-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <span className="text-xs font-medium text-foreground font-mono">{t.name}</span>
                      {t.description && <p className="mt-0.5 text-[10px] text-muted-foreground">{t.description}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const filtered = servers.filter(
    (s) => s.name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 px-5 py-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search servers..." className="pl-8" />
        </div>
        <Button size="sm" variant="outline" onClick={() => void connectAll()} disabled={busy}>
          <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />Connect All
        </Button>
        <Button size="sm" onClick={() => (adding ? (setAdding(false), setForm(EMPTY_FORM)) : setAdding(true))} variant={adding ? "outline" : "default"}>
          <Plus className="size-3.5" />{adding ? "Close" : "Add Server"}
        </Button>
      </div>

      {/* Add form */}
      {adding && (
        <div className="vg-slide-in mx-5 mb-3 shrink-0 space-y-2.5 rounded-lg border border-dashed border-border p-3">
          <div className="flex gap-2">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Server name (e.g. filesystem)" className="flex-1" />
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as AddForm["type"] })}
              className="h-9 rounded-md border border-border bg-background px-2 text-xs"
            >
              <option value="stdio">stdio</option>
              <option value="sse">SSE</option>
              <option value="http">HTTP</option>
            </select>
          </div>
          {form.type === "stdio" ? (
            <>
              <Input value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} placeholder="Command (e.g. npx)" />
              <Input value={form.args} onChange={(e) => setForm({ ...form, args: e.target.value })} placeholder="Args (space-separated, e.g. -y @modelcontextprotocol/server-filesystem /tmp)" />
              <Input value={form.env} onChange={(e) => setForm({ ...form, env: e.target.value })} placeholder='Env JSON (optional, e.g. {"KEY":"value"})' />
            </>
          ) : (
            <Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="Server URL (e.g. http://localhost:3001/sse)" />
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => void addServer()} disabled={busy || !form.name.trim() || (form.type === "stdio" ? !form.command.trim() : !form.url.trim())}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}Add
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setAdding(false); setForm(EMPTY_FORM); setError(null); }}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Server list */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="size-4 animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <Server className="size-8 text-muted-foreground/40" />
            <h3 className="mt-3 text-sm font-medium text-muted-foreground">{query ? "No servers match" : "No MCP Servers"}</h3>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              Add an MCP server to extend the agent with external tools. Supports stdio (local process) and HTTP/SSE (remote).
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {filtered.map((s) => {
              const st = stateFor(s.name);
              const count = toolsFor(s.name).length;
              return (
                <button
                  key={s.name}
                  onClick={() => setDetail(s)}
                  className="group flex w-full items-start gap-3 rounded-lg border border-card-border bg-background px-3 py-2.5 text-left transition-all duration-150 hover:-translate-y-px hover:border-primary/40 hover:bg-card hover:shadow-md"
                >
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:bg-primary/15 group-hover:text-primary">
                    <Server className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{s.name}</span>
                      <StatusBadge status={st?.status ?? (s.enabled ? "connecting" : "disabled")} />
                      {count > 0 && (
                        <span className="flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          <Wrench className="size-2.5" />{count}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
                      {s.config.type === "stdio" || !s.config.type
                        ? `${s.config.command} ${(s.config.args ?? []).join(" ")}`
                        : s.config.url ?? ""}
                    </p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); void toggleServer(s.name, !s.enabled); }}
                    className="mt-0.5 shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted"
                    title={s.enabled ? "Disable" : "Enable"}
                  >
                    {s.enabled ? <Power className="size-3.5 text-green-500" /> : <PowerOff className="size-3.5" />}
                  </button>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Summary footer */}
      {tools.length > 0 && (
        <div className="shrink-0 border-t border-border px-5 py-2">
          <p className="text-[10px] text-muted-foreground">
            {tools.length} tool{tools.length !== 1 ? "s" : ""} available from {states.filter((s) => s.status === "connected").length} connected server{states.filter((s) => s.status === "connected").length !== 1 ? "s" : ""}
          </p>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    connected: "bg-green-500/15 text-green-600",
    connecting: "bg-yellow-500/15 text-yellow-600",
    failed: "bg-destructive/15 text-destructive",
    disabled: "bg-muted text-muted-foreground",
  };
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium", styles[status] ?? styles.disabled)}>
      {status === "connected" && <span className="size-1.5 rounded-full bg-green-500" />}
      {status === "connecting" && <Loader2 className="size-2.5 animate-spin" />}
      {status === "failed" && <AlertCircle className="size-2.5" />}
      {status}
    </span>
  );
}
