"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Search, Plus, Trash2, Check, Loader2, User, Package, Puzzle, ChevronLeft, FileUp, Globe, FolderOpen } from "lucide-react";
import { useProjectStore } from "@/lib/store/project-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Markdown } from "@/components/markdown/Markdown";
import { cn } from "@/lib/utils";

interface SkillEntry {
  name: string;
  description: string;
  source: "user" | "bundled";
}

interface SkillDetail extends SkillEntry {
  content: string;
}

type SkillSubTab = "global" | "project";

function splitFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const m = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
  }
  return { meta, body: m[2] };
}

export function SkillsTab() {
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [subTab, setSubTab] = useState<SkillSubTab>("global");
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [fileName, setFileName] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const projects = useProjectStore((s) => s.projects);
  const activeProject = useProjectStore((s) => {
    const id = s.activeProjectId;
    return id ? s.projects.find((p) => p.id === id) : undefined;
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/skills", { cache: "no-store" });
      const data = (await res.json()) as { skills?: SkillEntry[] };
      setSkills(data.skills ?? []);
    } catch {
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openDetail = async (entry: SkillEntry) => {
    setDetailLoading(true);
    setDetail({ ...entry, content: "" });
    try {
      const res = await fetch(`/api/skills?name=${encodeURIComponent(entry.name)}`, { cache: "no-store" });
      const data = (await res.json()) as { content?: string };
      setDetail({ ...entry, content: data.content ?? "(could not load this skill)" });
    } catch {
      setDetail({ ...entry, content: "(could not load this skill)" });
    } finally {
      setDetailLoading(false);
    }
  };

  const resetImport = () => {
    setContent("");
    setFileName("");
    setError(null);
    setImporting(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      setContent(text);
      setFileName(file.name);
      setError(null);
    } catch {
      setError("Could not read that file.");
    }
  };

  const importSkill = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import", content, filename: fileName || undefined }),
      });
      const data = (await res.json()) as { skills?: SkillEntry[]; error?: string };
      if (!res.ok) { setError(data.error ?? "Could not import the skill."); return; }
      setSkills(data.skills ?? skills);
      resetImport();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (skillName: string) => {
    setBusy(true);
    try {
      const res = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", name: skillName }),
      });
      const data = (await res.json()) as { skills?: SkillEntry[] };
      if (res.ok) setSkills(data.skills ?? skills);
    } finally {
      setBusy(false);
    }
  };

  // ── Detail view ──
  if (detail) {
    const { meta, body } = splitFrontmatter(detail.content);
    return (
      <div key={detail.name} className="vg-slide-in flex h-full flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-5 py-3">
          <button onClick={() => setDetail(null)} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <ChevronLeft className="size-3.5" />Back
          </button>
          <div className="flex min-w-0 items-center gap-2">
            <Puzzle className="size-4 shrink-0 text-primary" />
            <span className="truncate text-sm font-medium">{detail.name}</span>
            <SourceBadge source={detail.source} />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {detailLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="size-4 animate-spin" /></div>
          ) : (
            <>
              {meta.description && <p className="mb-4 border-l-2 border-primary/40 pl-3 text-xs italic text-muted-foreground">{meta.description}</p>}
              <div className="text-sm leading-relaxed [&_h1]:mt-0"><Markdown content={body.trim()} /></div>
            </>
          )}
        </div>
      </div>
    );
  }

  // Global = ALL skills from the API (both bundled and user-created — they're all global)
  const globalSkills = skills;
  const filtered = globalSkills.filter(
    (s) => s.name.toLowerCase().includes(query.toLowerCase()) || s.description.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="flex h-full flex-col">
      {/* Sub-tabs */}
      <div className="flex shrink-0 gap-1 border-b border-border/60 px-3 pt-1">
        <SubTabButton active={subTab === "global"} onClick={() => setSubTab("global")} icon={<Globe className="size-3" />} label="Global Skills" count={globalSkills.length} />
        <SubTabButton active={subTab === "project"} onClick={() => setSubTab("project")} icon={<FolderOpen className="size-3" />} label="Project Skills" />
      </div>

      {subTab === "global" ? (
        <>
          {/* Toolbar */}
          <div className="flex shrink-0 items-center gap-2 px-5 py-3">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search skills…" className="pl-8" />
            </div>
            <Button size="sm" onClick={() => (importing ? resetImport() : setImporting(true))} variant={importing ? "outline" : "default"}>
              <Plus className="size-3.5" />{importing ? "Close" : "Add skill"}
            </Button>
          </div>

          {/* Import panel */}
          {importing && (
            <div className="vg-slide-in mx-5 mb-3 shrink-0 space-y-2.5 rounded-lg border border-dashed border-border p-3">
              <p className="text-[11px] text-muted-foreground">
                A skill is just a <code className="rounded bg-muted px-1">SKILL.md</code> (markdown + a <code className="rounded bg-muted px-1">name</code>/<code className="rounded bg-muted px-1">description</code> header). Load a file or paste one below.
              </p>
              <input ref={fileRef} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" className="hidden" onChange={(e) => void onPickFile(e.target.files?.[0])} />
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}><FileUp className="size-3.5" />Choose SKILL.md</Button>
                {fileName && <span className="truncate text-[11px] text-muted-foreground">{fileName}</span>}
              </div>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={"…or paste a SKILL.md here:\n\n---\nname: my-skill\ndescription: What it does.\n---\n\n# My skill\n\nSteps…"}
                rows={8}
                className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 font-mono text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {error && <p className="text-xs text-destructive">{error}</p>}
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => void importSkill()} disabled={busy || !content.trim()}>
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}Add skill
                </Button>
                <Button size="sm" variant="outline" onClick={resetImport} disabled={busy}>Cancel</Button>
              </div>
            </div>
          )}

          {/* Global skill list */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
            {loading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="size-4 animate-spin" /></div>
            ) : filtered.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">{query ? "No skills match your search." : "No skills installed."}</p>
            ) : (
              <div className="space-y-3">
                {/* User-created skills section */}
                {filtered.some((s) => s.source === "user") && (
                  <div>
                    <div className="flex items-center gap-1.5 pb-1.5">
                      <User className="size-3 text-primary opacity-70" />
                      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Your Skills</span>
                    </div>
                    <div className="space-y-1.5">
                      {filtered.filter((s) => s.source === "user").map((s) => (
                        <SkillCard key={s.name} skill={s} onDetail={openDetail} onRemove={remove} />
                      ))}
                    </div>
                  </div>
                )}
                {/* Built-in skills section */}
                {filtered.some((s) => s.source === "bundled") && (
                  <div>
                    <div className="flex items-center gap-1.5 pb-1.5">
                      <Package className="size-3 opacity-50" />
                      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Built-in Skills</span>
                      <span className="text-[9px] text-muted-foreground/50">— shipped with VaultGate</span>
                    </div>
                    <div className="space-y-1.5">
                      {filtered.filter((s) => s.source === "bundled").map((s) => (
                        <SkillCard key={s.name} skill={s} onDetail={openDetail} onRemove={remove} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      ) : (
        /* Project Skills tab */
        <ProjectSkillsView projects={projects} activeProject={activeProject} />
      )}
    </div>
  );
}

function ProjectSkillsView({ projects, activeProject }: {
  projects: Array<{ id: string; name: string; path: string }>;
  activeProject?: { id: string; name: string; path: string };
}) {
  const [selectedProjectId, setSelectedProjectId] = useState<string>(activeProject?.id ?? "");

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  return (
    <div className="flex h-full flex-col">
      {projects.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <FolderOpen className="size-8 text-muted-foreground/40" />
          <h3 className="mt-3 text-sm font-medium text-muted-foreground">No Projects</h3>
          <p className="mt-1 max-w-xs text-xs text-muted-foreground">
            Add a project first, then install custom skills from the global Skills tab. Project roots stay clean.
          </p>
        </div>
      ) : (
        <>
          {/* Project selector */}
          <div className="shrink-0 px-5 py-3">
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring [&>option]:bg-popover [&>option]:text-popover-foreground"
            >
              <option value="">Select a project…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{activeProject?.id === p.id ? " (active)" : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Project skill content */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
            {!selectedProject ? (
              <p className="py-10 text-center text-xs text-muted-foreground">Select a project above to see its skills.</p>
            ) : (
              <div className="space-y-3">
                <div className="rounded-lg border border-dashed border-border px-4 py-4 text-center">
                  <FolderOpen className="mx-auto size-6 text-muted-foreground/40" />
                  <p className="mt-2 text-xs text-muted-foreground">
                    Project-specific skill isolation is managed by VaultGate Home:
                  </p>
                  <code className="mt-1 block rounded bg-muted px-2 py-1 text-[11px] text-foreground">
                    {selectedProject.name} conversations load global/user skills without writing runtime files into {selectedProject.path}
                  </code>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    This keeps selected folders production-clean while preserving per-project context through the workspace root.
                  </p>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SubTabButton({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-1.5 text-[11px] font-medium transition-colors",
        active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}{label}
      {count !== undefined && <span className="rounded bg-muted px-1 py-px text-[9px] text-muted-foreground">{count}</span>}
    </button>
  );
}

function SkillCard({ skill: s, onDetail, onRemove }: { skill: SkillEntry; onDetail: (s: SkillEntry) => void; onRemove: (name: string) => void }) {
  return (
    <button
      onClick={() => void onDetail(s)}
      className="group flex w-full items-start gap-3 rounded-lg border border-card-border bg-background px-3 py-2.5 text-left transition-all duration-150 hover:-translate-y-px hover:border-primary/40 hover:bg-card hover:shadow-md"
    >
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:bg-primary/15 group-hover:text-primary">
        <Puzzle className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{s.name}</span>
          <SourceBadge source={s.source} />
        </div>
        {s.description && <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{s.description}</p>}
      </div>
      {s.source === "user" && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); void onRemove(s.name); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); void onRemove(s.name); } }}
          className="mt-0.5 shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-destructive group-hover:opacity-100"
          title="Delete skill"
        >
          <Trash2 className="size-3.5" />
        </span>
      )}
    </button>
  );
}

function SourceBadge({ source }: { source: "user" | "bundled" }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px]", source === "user" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>
      {source === "user" ? <User className="size-2.5" /> : <Package className="size-2.5" />}
      {source === "user" ? "custom" : "built-in"}
    </span>
  );
}
