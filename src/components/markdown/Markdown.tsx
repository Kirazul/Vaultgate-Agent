"use client";
import { isValidElement, memo, type ReactNode } from "react";
import { Streamdown, type Components } from "streamdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { cn } from "@/lib/utils";
import { ExcalidrawPreview } from "@/components/renderers/ExcalidrawPreview";
import { FileSymbolIcon } from "@/components/icons/FileSymbolIcon";
import { baseName } from "@/lib/ai/tool-display";
import { useWorkspaceStore } from "@/lib/store/workspace-store";

const WORKSPACE_PATH_RE = /(^|[\s([{:>])((?:\.vaultgate\/(?:download|upload|scripts)|src|app|public|scripts|components|lib|pages|styles|assets|docs)(?:\/[A-Za-z0-9._@-]+)+\/?)(?=$|[\s\]).,;!?}])/g;
const IMAGE_RE = /\.(?:png|jpe?g|gif|webp|bmp|ico|svg)$/i;
const EXCALIDRAW_RE = /\.excalidraw$/i;

function workspacePathFromHref(href: string): string | null {
  const m = /^workspace-file:(.*)$/.exec(href);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]).replace(/^\/+/, "");
  } catch {
    return m[1].replace(/^\/+/, "");
  }
}

function rawWorkspaceUrl(chatId: string, filePath: string): string {
  return `/api/workspace/files/raw?chatId=${encodeURIComponent(chatId)}&filePath=${encodeURIComponent(filePath)}`;
}

function decodeWorkspacePath(encoded: string): string {
  try {
    return decodeURIComponent(encoded).replace(/^\/+/, "");
  } catch {
    return encoded.replace(/^\/+/, "");
  }
}

function workspaceImageAlt(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback.split("/").pop() || "Workspace image";
}

function WorkspaceImagePreview({ href, src, alt }: { href: string; src: string; alt: string }) {
  return (
    <a
      href={href}
      title="Open image in Workspace"
      className="not-prose group my-3 inline-flex max-w-full cursor-zoom-in overflow-hidden rounded-2xl border border-border/80 bg-zinc-950 shadow-lg shadow-black/20 ring-1 ring-white/[0.04] transition hover:border-ring/70 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- Dynamic local workspace image URL. */}
      <img src={src} alt={alt} className="block max-h-[34rem] max-w-full object-contain" />
    </a>
  );
}

function childText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(childText).join("");
  if (isValidElement(node)) return childText((node.props as { children?: ReactNode }).children);
  return "";
}

function openWorkspacePath(chatId: string | undefined, path: string) {
  if (!chatId) return;
  const detail = path.replace(/\\/g, "/").replace(/^\/+/, "");
  useWorkspaceStore.getState().activate(chatId, "code");
  const emit = () => {
    window.dispatchEvent(new CustomEvent("vaultgate:open-workspace-path", { detail }));
    window.dispatchEvent(new CustomEvent("vaultgate:open-file", { detail }));
  };
  emit();
  window.setTimeout(emit, 50);
}

function WorkspaceFileMention({ path, chatId, children }: { path: string; chatId?: string; children: ReactNode }) {
  const label = childText(children).trim() || baseName(path);
  return (
    <span className="context-scope-mention">
      <button
        type="button"
        draggable="true"
        onClick={(event) => {
          event.preventDefault();
          openWorkspacePath(chatId, path);
        }}
        className="inline-flex translate-y-[-1.5px] cursor-pointer select-none appearance-none items-center gap-0.5 rounded-md border-0 bg-transparent p-0 align-middle text-sm font-medium transition-[opacity,background-color] hover:bg-secondary"
        style={{ padding: "1px 0.25rem 1px 0.125rem" }}
      >
        <FileSymbolIcon path={path} />
        <span className="inline-flex items-center gap-1 break-all leading-tight select-text">{label}</span>
      </button>
    </span>
  );
}

function markdownComponents(chatId?: string): Components {
  return {
    a({ href, children, node, ...rest }) {
      void node;
      const h = typeof href === "string" ? href : "";
      const workspacePath = workspacePathFromHref(h);
      const internal = Boolean(workspacePath || h.startsWith("#"));
      const image = workspacePath && chatId && IMAGE_RE.test(workspacePath);
      const excalidraw = workspacePath && chatId && EXCALIDRAW_RE.test(workspacePath);
      if (image) {
        return (
          <WorkspaceImagePreview href={h} src={rawWorkspaceUrl(chatId, workspacePath)} alt={workspaceImageAlt(children, workspacePath)} />
        );
      }
      if (excalidraw) {
        return (
          <div title="Rendered Excalidraw file" className="not-prose my-3 block max-w-full">
            <ExcalidrawPreview src={rawWorkspaceUrl(chatId, workspacePath)} title={workspacePath} compact />
          </div>
        );
      }
      if (workspacePath) {
        return <WorkspaceFileMention path={workspacePath} chatId={chatId}>{children}</WorkspaceFileMention>;
      }
      return (
        <a href={h} {...(internal ? {} : { target: "_blank", rel: "noopener noreferrer" })} {...rest}>
          {children}
        </a>
      );
    },
    img({ src, alt, node, ...rest }) {
      void node;
      const s = typeof src === "string" ? src : "";
      const workspacePath = workspacePathFromHref(s);
      const finalSrc = workspacePath && chatId ? rawWorkspaceUrl(chatId, workspacePath) : s;
      if (!finalSrc) return null;
      if (workspacePath && chatId) {
        return <WorkspaceImagePreview href={s} src={finalSrc} alt={alt || workspaceImageAlt(null, workspacePath)} />;
      }
      return (
        // eslint-disable-next-line @next/next/no-img-element -- Markdown images may point at dynamic workspace files.
        <img src={finalSrc} alt={alt || workspacePath || "image"} className="my-3 max-h-[30rem] max-w-full rounded-xl border border-border object-contain shadow-sm" {...rest} />
      );
    },
  };
}

function linkWorkspacePaths(content: string): string {
  let inFence = false;
  return content
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return line;
      }
      const linked = inFence || line.includes("workspace-file:") ? line : line.replace(WORKSPACE_PATH_RE, (match, prefix: string, filePath: string) => {
        if (match.includes("](") || filePath.includes("//")) return match;
        return `${prefix}[${filePath}](workspace-file:${encodeURIComponent(filePath)})`;
      });
      return stripImageLinkLabel(linked);
    })
    .join("\n");
}

function stripImageLinkLabel(line: string): string {
  const m = /^(\s*)(?:\*\*)?(?:Link|Screenshot|Image|File|Artifact)(?:\*\*)?\s*:\s*(\[[^\]]+\]\(workspace-file:([^)]+)\))\s*$/i.exec(line);
  if (!m) return line;
  const workspacePath = decodeWorkspacePath(m[3]);
  return IMAGE_RE.test(workspacePath) || EXCALIDRAW_RE.test(workspacePath) ? `${m[1]}${m[2]}` : line;
}

/**
 * Streaming-safe markdown. Streamdown tolerates partial/unterminated
 * markdown (open code fences, half tables) so streaming never flickers
 * into broken layout. Memoized on the content string.
 */
function MarkdownImpl({ content, className, chatId }: { content: string; className?: string; chatId?: string }) {
  return (
    <Streamdown
      linkSafety={{ enabled: false }}
      components={markdownComponents(chatId)}
      className={cn(
        "prose-vaultgate max-w-none text-[15px] leading-relaxed",
        "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_ul]:my-3 [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:pl-6 [&_p]:mb-3",
        "[&_a]:text-primary [&_a]:underline-offset-4 hover:[&_a]:underline",
        "[&_h1]:mt-7 [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:tracking-tight",
        "[&_h2]:mt-7 [&_h2]:mb-3 [&_h2]:border-t [&_h2]:border-border/70 [&_h2]:pt-5 [&_h2]:text-xl [&_h2]:font-semibold",
        "[&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold",
        "[&_li]:mb-1.5 [&_li::marker]:text-muted-foreground",
        "[&_strong]:font-semibold [&_strong]:text-foreground",
        "[&_code]:rounded [&_code]:border [&_code]:border-amber-500/15 [&_code]:bg-amber-500/10 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.88em] [&_code]:text-amber-200",
        "[&_pre]:my-4 [&_pre]:max-h-[32rem] [&_pre]:overflow-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-border [&_pre]:bg-[#090a0d] [&_pre]:p-4 [&_pre]:shadow-inner",
        "[&_pre_code]:border-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-zinc-200",
        "[&_blockquote]:my-4 [&_blockquote]:rounded-r-lg [&_blockquote]:border-l-2 [&_blockquote]:border-ring [&_blockquote]:bg-muted/30 [&_blockquote]:py-2 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground",
        "[&_table]:my-4 [&_table]:w-full [&_table]:overflow-hidden [&_table]:rounded-lg [&_table]:border [&_table]:border-border [&_th]:border-b [&_th]:border-border [&_th]:bg-muted/40 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_td]:border-t [&_td]:border-border/60 [&_td]:px-3 [&_td]:py-2",
        className,
      )}
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
    >
      {linkWorkspacePaths(content)}
    </Streamdown>
  );
}

export const Markdown = memo(MarkdownImpl);
