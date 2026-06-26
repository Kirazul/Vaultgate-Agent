"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, FileArchive, FileQuestion } from "lucide-react";
import { Markdown } from "@/components/markdown/Markdown";
import { ExcalidrawPreview } from "@/components/renderers/ExcalidrawPreview";
import { cn } from "@/lib/utils";

export type PreviewKind = "text" | "markdown" | "excalidraw" | "pdf" | "image" | "audio" | "video" | "document" | "spreadsheet" | "presentation" | "archive" | "binary" | "unsupported";

type PreviewData =
  | { kind: "document"; text: string; messages?: string[] }
  | { kind: "spreadsheet" | "table"; sheets: Array<{ name: string; rows: unknown[][] }>; truncated?: boolean }
  | { kind: "presentation"; slides: Array<{ title: string; lines: string[] }>; truncated?: boolean }
  | { kind: "archive"; entries: Array<{ name: string; size: number | null }>; truncated?: boolean }
  | { kind: "binary"; name: string; size: number; reason: string };

export interface FilePreviewState {
  kind: PreviewKind;
  content?: string;
  data?: PreviewData;
  error?: string;
}

const TEXT_EXTENSIONS = new Set([
  "bat",
  "c",
  "cmd",
  "conf",
  "cpp",
  "cs",
  "css",
  "csv",
  "env",
  "go",
  "graphql",
  "h",
  "html",
  "ini",
  "java",
  "js",
  "json",
  "jsx",
  "log",
  "mjs",
  "php",
  "ps1",
  "py",
  "rb",
  "rs",
  "scss",
  "sh",
  "sql",
  "svg",
  "toml",
  "ts",
  "tsx",
  "txt",
  "xml",
  "yaml",
  "yml",
]);
const TEXT_FILENAMES = new Set(["dockerfile", "makefile", "readme", "license", ".gitignore", ".env", ".env.local"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "m4a", "flac"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "mkv"]);
const DOCUMENT_EXTENSIONS = new Set(["doc", "docx", "odt", "rtf"]);
const SPREADSHEET_EXTENSIONS = new Set(["xls", "xlsx", "ods"]);
const PRESENTATION_EXTENSIONS = new Set(["ppt", "pptx", "odp"]);
const ARCHIVE_EXTENSIONS = new Set(["zip", "jar", "epub"]);
const EXECUTABLE_EXTENSIONS = new Set(["exe", "msi", "com", "scr", "dll", "so", "dylib", "app", "dmg", "pkg", "deb", "rpm", "bin"]);
const BINARY_EXTENSIONS = new Set([
  "7z",
  "gz",
  "iso",
  "rar",
  "tar",
  "wasm",
]);

export function previewKindForPath(filePath: string): PreviewKind {
  const name = filePath.split(/[\\/]/).pop()?.toLowerCase() || "";
  const ext = name.includes(".") ? name.split(".").pop() || "" : "";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "excalidraw") return "excalidraw";
  if (ext === "pdf") return "pdf";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (DOCUMENT_EXTENSIONS.has(ext)) return "document";
  if (SPREADSHEET_EXTENSIONS.has(ext) || ext === "csv") return "spreadsheet";
  if (PRESENTATION_EXTENSIONS.has(ext)) return "presentation";
  if (ARCHIVE_EXTENSIONS.has(ext)) return "archive";
  if (EXECUTABLE_EXTENSIONS.has(ext)) return "binary";
  if (TEXT_EXTENSIONS.has(ext) || TEXT_FILENAMES.has(name) || !ext) return "text";
  if (BINARY_EXTENSIONS.has(ext)) return "binary";
  return "binary";
}

function languageForPath(filePath: string): string {
  const name = filePath.split(/[\\/]/).pop()?.toLowerCase() || "";
  const ext = name.includes(".") ? name.split(".").pop() || "" : name;
  const map: Record<string, string> = {
    bat: "Batch",
    cmd: "Batch",
    css: "CSS",
    html: "HTML",
    js: "JavaScript",
    jsx: "React JSX",
    json: "JSON",
    md: "Markdown",
    mjs: "JavaScript",
    ps1: "PowerShell",
    py: "Python",
    sh: "Shell",
    sql: "SQL",
    ts: "TypeScript",
    tsx: "React TSX",
    xml: "XML",
    yaml: "YAML",
    yml: "YAML",
  };
  if (name === "dockerfile") return "Dockerfile";
  return map[ext] || ext.toUpperCase() || "Text";
}

function tokenClass(token: string): string {
  if (/^\s+$/.test(token)) return "";
  if (/^\/\//.test(token) || /^#/.test(token) || /^<!--/.test(token)) return "text-zinc-500";
  if (/^["'`]/.test(token)) return "text-emerald-300";
  if (/^-?\d/.test(token)) return "text-amber-300";
  if (/^(true|false|null|undefined|None|nil)$/i.test(token)) return "text-purple-300";
  if (/^(import|export|from|const|let|var|function|return|async|await|class|interface|type|extends|implements|if|else|for|while|switch|case|break|continue|try|catch|finally|throw|new|public|private|protected|static|def|print|param|foreach|in|do|then|fi|select|insert|update|delete|where|join|create|table|alter|drop)$/i.test(token)) return "text-sky-300";
  if (/^[{}[\]();,.<>/=:+\-*|&!?]+$/.test(token)) return "text-zinc-400";
  return "";
}

function highlightLine(line: string, filePath: string): React.ReactNode {
  const name = filePath.split(/[\\/]/).pop()?.toLowerCase() || "";
  if (name.endsWith(".md")) {
    if (/^#{1,6}\s/.test(line)) return <span className="font-semibold text-violet-300">{line}</span>;
    if (/^\s*[-*+]\s/.test(line)) return <span className="text-sky-200">{line}</span>;
    if (/^\s*```/.test(line)) return <span className="text-amber-300">{line}</span>;
  }

  const tokens = line.match(/(\/\/.*|#.*|<!--.*?-->|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b[A-Za-z_$][\w$-]*\b|-?\b\d+(?:\.\d+)?\b|\s+|[{}[\]();,.<>/=:+\-*|&!?]+)/g) || [line];
  return tokens.map((token, index) => (
    <span key={index} className={tokenClass(token)}>
      {token}
    </span>
  ));
}

function rawUrl(chatId: string, filePath: string): string {
  return `/api/workspace/files/raw?chatId=${encodeURIComponent(chatId)}&filePath=${encodeURIComponent(filePath)}`;
}

function formatSize(size: number | null | undefined): string {
  if (!size || size < 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function cellText(value: unknown): string {
  if (value instanceof Date) return value.toLocaleDateString();
  if (value === null || value === undefined) return "";
  return String(value);
}

function DocumentPreview({ data }: { data?: PreviewData }) {
  const doc = data?.kind === "document" ? data : null;
  const paragraphs = (doc?.text || "").split(/\n{2,}/).filter((part) => part.trim());
  return (
    <div className="h-full overflow-auto bg-zinc-100 p-6 text-zinc-950">
      <article className="mx-auto min-h-full max-w-3xl rounded-xl bg-white px-10 py-8 shadow-xl shadow-black/10">
        {paragraphs.length ? paragraphs.map((paragraph, index) => <p key={index} className="mb-4 whitespace-pre-wrap text-sm leading-7 text-zinc-800">{paragraph}</p>) : <p className="text-sm text-zinc-500">No readable text found in this document.</p>}
      </article>
    </div>
  );
}

function SpreadsheetPreview({ data }: { data?: PreviewData }) {
  const book = data?.kind === "spreadsheet" || data?.kind === "table" ? data : null;
  const [sheet] = book?.sheets ?? [];
  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{sheet?.name || "Spreadsheet"}</span>
        {book?.truncated && <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase">truncated</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {sheet?.rows?.length ? (
          <table className="min-w-full border-separate border-spacing-0 text-xs">
            <tbody>
              {sheet.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  <th className="sticky left-0 z-10 border-b border-r border-border bg-muted px-2 py-1 text-right font-mono text-[10px] text-muted-foreground">{rowIndex + 1}</th>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="max-w-80 whitespace-pre-wrap border-b border-r border-border px-2 py-1 align-top text-foreground">
                      {cellText(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">No readable cells found.</div>
        )}
      </div>
    </div>
  );
}

function PresentationPreview({ data }: { data?: PreviewData }) {
  const deck = data?.kind === "presentation" ? data : null;
  return (
    <div className="h-full overflow-auto bg-[#0b0d12] p-5">
      <div className="mx-auto grid max-w-5xl gap-4">
        {deck?.slides?.length ? deck.slides.map((slide, index) => (
          <section key={index} className="aspect-video rounded-2xl border border-white/10 bg-white p-8 text-zinc-950 shadow-2xl shadow-black/30">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">Slide {index + 1}</p>
            <h3 className="mb-5 text-2xl font-semibold tracking-tight">{slide.lines[0] || slide.title}</h3>
            <ul className="space-y-2 text-base leading-6 text-zinc-700">
              {slide.lines.slice(slide.lines[0] ? 1 : 0).map((line, lineIndex) => <li key={lineIndex}>{line}</li>)}
            </ul>
          </section>
        )) : <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">No readable slides found.</div>}
      </div>
    </div>
  );
}

function ArchivePreview({ data }: { data?: PreviewData }) {
  const archive = data?.kind === "archive" ? data : null;
  return (
    <div className="h-full overflow-auto bg-background p-4">
      <div className="mx-auto max-w-3xl rounded-xl border border-border bg-card p-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground"><FileArchive className="size-4" /> Archive contents</div>
        <div className="divide-y divide-border rounded-lg border border-border">
          {archive?.entries?.length ? archive.entries.map((entry, index) => (
            <div key={`${entry.name}-${index}`} className="flex items-center gap-3 px-3 py-2 text-xs">
              <span className="min-w-0 flex-1 truncate font-mono text-foreground/90">{entry.name}</span>
              <span className="shrink-0 text-muted-foreground">{formatSize(entry.size)}</span>
            </div>
          )) : <p className="p-3 text-sm text-muted-foreground">No readable archive entries found.</p>}
        </div>
      </div>
    </div>
  );
}

function BinaryPreview({ data, filePath }: { data?: PreviewData; filePath: string }) {
  const info = data?.kind === "binary" ? data : null;
  return (
    <div className="flex h-full items-center justify-center p-6 text-center">
      <div className="max-w-sm rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground shadow-sm">
        <FileQuestion className="mx-auto mb-3 size-8 text-muted-foreground" />
        <p className="font-medium text-foreground">Safe preview unavailable</p>
        <p className="mt-1">{info?.reason || `VaultGate will not render ${filePath.split(".").pop()?.toUpperCase() || "this"} files in the code panel.`}</p>
        {info?.size ? <p className="mt-2 text-xs">Size: {formatSize(info.size)}</p> : null}
      </div>
    </div>
  );
}

function PreviewModeBar({ raw, setRaw, label }: { raw: boolean; setRaw: (raw: boolean) => void; label: string }) {
  return (
    <div className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-sidebar px-3 text-xs">
      <span className="truncate font-medium text-muted-foreground">{label}</span>
      <div className="flex rounded-lg border border-border bg-background p-0.5">
        <button type="button" onClick={() => setRaw(false)} className={cn("rounded-md px-2 py-1 transition", !raw ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}>Rendered</button>
        <button type="button" onClick={() => setRaw(true)} className={cn("rounded-md px-2 py-1 transition", raw ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}>Raw</button>
      </div>
    </div>
  );
}

function RawTextPreview({ content, filePath }: { content: string; filePath: string }) {
  const lines = content.split("\n");
  return (
    <div className="h-full overflow-auto bg-[#08090d] text-[12.5px] text-zinc-200">
      <pre className="w-full min-w-0 p-0 font-mono leading-relaxed">
        {lines.map((line, index) => (
          <div key={index} className="group flex min-h-[1.45rem] pl-3 pr-8 hover:bg-white/[0.035]">
            <span className="mr-4 w-10 shrink-0 select-none text-right text-zinc-600 group-hover:text-zinc-500">{index + 1}</span>
            <code className={cn("min-w-0 flex-1 whitespace-pre-wrap break-words", line.length === 0 && "text-zinc-700")}>{line.length ? highlightLine(line, filePath) : " "}</code>
          </div>
        ))}
      </pre>
    </div>
  );
}

export function FilePreview({ chatId, filePath, preview, token }: { chatId: string; filePath: string; preview: FilePreviewState; token: number }) {
  const [rawMode, setRawMode] = useState(false);
  const [rawContent, setRawContent] = useState("");
  const [rawError, setRawError] = useState("");
  const [rawLoading, setRawLoading] = useState(false);

  useEffect(() => {
    setRawMode(false);
    setRawContent("");
    setRawError("");
  }, [filePath, preview.kind]);

  useEffect(() => {
    if (!rawMode || preview.kind !== "excalidraw") return;
    let cancelled = false;
    setRawLoading(true);
    setRawError("");
    fetch(rawUrl(chatId, filePath), { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return res.text();
      })
      .then((text) => {
        if (!cancelled) setRawContent(text);
      })
      .catch((err) => {
        if (!cancelled) setRawError(err instanceof Error ? err.message : "Failed to load raw file.");
      })
      .finally(() => {
        if (!cancelled) setRawLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [chatId, filePath, preview.kind, rawMode]);

  if (preview.error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div className="max-w-sm rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertTriangle className="mx-auto mb-2 size-5" />
          {preview.error}
        </div>
      </div>
    );
  }

  if (preview.kind === "pdf") {
    return <iframe key={`${filePath}:${token}`} src={rawUrl(chatId, filePath)} className="h-full w-full bg-white" title={filePath} />;
  }

  if (preview.kind === "markdown") {
    const content = preview.content ?? "";
    return (
      <div className="flex h-full flex-col bg-background">
        <PreviewModeBar raw={rawMode} setRaw={setRawMode} label={filePath} />
        <div className="min-h-0 flex-1 overflow-hidden">
          {rawMode ? <RawTextPreview content={content} filePath={filePath} /> : <div className="h-full overflow-auto p-5"><Markdown content={content} chatId={chatId} className="mx-auto max-w-4xl" /></div>}
        </div>
      </div>
    );
  }

  if (preview.kind === "excalidraw") {
    return (
      <div className="flex h-full flex-col bg-background">
        <PreviewModeBar raw={rawMode} setRaw={setRawMode} label={filePath} />
        <div className="min-h-0 flex-1 overflow-hidden">
          {rawMode ? (
            rawLoading ? <p className="p-4 text-xs text-muted-foreground">Loading raw file…</p> : rawError ? <p className="p-4 text-xs text-destructive">{rawError}</p> : <RawTextPreview content={rawContent} filePath={filePath} />
          ) : (
            <ExcalidrawPreview src={rawUrl(chatId, filePath)} title={filePath} />
          )}
        </div>
      </div>
    );
  }

  if (preview.kind === "image") {
    return (
      <div className="flex h-full items-center justify-center overflow-auto bg-zinc-950 p-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- Workspace files are dynamic local URLs, not Next image assets. */}
        <img src={rawUrl(chatId, filePath)} alt={filePath} className="max-h-full max-w-full rounded-md object-contain shadow-2xl" />
      </div>
    );
  }

  if (preview.kind === "audio") {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <audio src={rawUrl(chatId, filePath)} controls className="w-full max-w-xl" />
      </div>
    );
  }

  if (preview.kind === "video") {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-950 p-4">
        <video src={rawUrl(chatId, filePath)} controls className="max-h-full max-w-full rounded-md" />
      </div>
    );
  }

  if (preview.kind === "document") return <DocumentPreview data={preview.data} />;
  if (preview.kind === "spreadsheet") return <SpreadsheetPreview data={preview.data} />;
  if (preview.kind === "presentation") return <PresentationPreview data={preview.data} />;
  if (preview.kind === "archive") return <ArchivePreview data={preview.data} />;
  if (preview.kind === "binary" || preview.kind === "unsupported") return <BinaryPreview data={preview.data} filePath={filePath} />;

  const lines = (preview.content ?? "").split("\n");
  return (
    <div className="h-full overflow-auto bg-[#08090d] text-[12.5px] text-zinc-200">
      <div className="sticky top-0 z-10 flex h-9 items-center justify-between border-b border-zinc-800 bg-[#08090d]/95 px-3 text-xs backdrop-blur">
        <span className="truncate text-zinc-400">{filePath}</span>
        <span className="rounded border border-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500">{languageForPath(filePath)}</span>
      </div>
      <pre className="w-full min-w-0 p-0 font-mono leading-relaxed">
        {lines.map((line, index) => (
          <div key={index} className="group flex min-h-[1.45rem] pl-3 pr-8 hover:bg-white/[0.035]">
            <span className="mr-4 w-10 shrink-0 select-none text-right text-zinc-600 group-hover:text-zinc-500">{index + 1}</span>
            <code className={cn("min-w-0 flex-1 whitespace-pre-wrap break-words", line.length === 0 && "text-zinc-700")}>{line.length ? highlightLine(line, filePath) : " "}</code>
          </div>
        ))}
      </pre>
    </div>
  );
}
