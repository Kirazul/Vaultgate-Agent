"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertTriangle, Crosshair, FileJson, Loader2, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";

interface ExcalidrawElement {
  id?: string;
  type?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  points?: Array<[number, number]>;
  startElementId?: string;
  endElementId?: string;
  strokeColor?: string;
  backgroundColor?: string;
  strokeWidth?: number;
  strokeStyle?: string;
  opacity?: number;
  text?: string;
  fontSize?: number;
  isDeleted?: boolean;
}

interface ExcalidrawFile {
  type?: string;
  elements?: ExcalidrawElement[];
}

interface PreparedScene {
  elements: ExcalidrawElement[];
  bounds: { minX: number; minY: number; width: number; height: number };
  byId: Map<string, ExcalidrawElement>;
}

function isTransparent(value: string | undefined): boolean {
  return !value || value === "transparent" || value === "#00000000";
}

function elementBounds(element: ExcalidrawElement): { minX: number; minY: number; maxX: number; maxY: number } {
  const x = Number(element.x ?? 0);
  const y = Number(element.y ?? 0);
  if (element.points?.length) {
    const xs = element.points.map((point) => x + Number(point[0] ?? 0));
    const ys = element.points.map((point) => y + Number(point[1] ?? 0));
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  }
  const width = Math.max(1, Number(element.width ?? 1));
  const height = Math.max(1, Number(element.height ?? 1));
  return { minX: x, minY: y, maxX: x + width, maxY: y + height };
}

function prepareScene(source: ExcalidrawFile | null): PreparedScene | null {
  const elements = (source?.elements ?? []).filter((element) => !element.isDeleted && element.type);
  if (!elements.length) return null;
  const byId = new Map(elements.flatMap((element) => (element.id ? [[element.id, element] as const] : [])));
  const boxes = elements.map(elementBounds);
  const minX = Math.min(...boxes.map((box) => box.minX)) - 80;
  const minY = Math.min(...boxes.map((box) => box.minY)) - 80;
  const maxX = Math.max(...boxes.map((box) => box.maxX)) + 80;
  const maxY = Math.max(...boxes.map((box) => box.maxY)) + 80;
  return { elements, byId, bounds: { minX, minY, width: Math.max(320, maxX - minX), height: Math.max(220, maxY - minY) } };
}

function centerOf(element: ExcalidrawElement): [number, number] {
  return [Number(element.x ?? 0) + Number(element.width ?? 0) / 2, Number(element.y ?? 0) + Number(element.height ?? 0) / 2];
}

function textLines(text: string | undefined): string[] {
  return String(text || "").split(/\r?\n/).filter((line) => line.length > 0);
}

function ShapeLabel({ element }: { element: ExcalidrawElement }) {
  const lines = textLines(element.text);
  if (!lines.length) return null;
  const fontSize = Math.max(10, Number(element.fontSize ?? 16));
  const x = Number(element.x ?? 0) + Number(element.width ?? 0) / 2;
  const startY = Number(element.y ?? 0) + Number(element.height ?? 0) / 2 - ((lines.length - 1) * fontSize * 1.2) / 2;
  return (
    <text x={x} y={startY} textAnchor="middle" dominantBaseline="middle" fill={element.strokeColor || "#111827"} fontSize={fontSize} fontFamily="Inter, ui-sans-serif, system-ui" fontWeight={500}>
      {lines.map((line, index) => (
        <tspan key={index} x={x} dy={index === 0 ? 0 : fontSize * 1.2}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

function renderElement(element: ExcalidrawElement, scene: PreparedScene, markerId: string): React.ReactNode {
  const type = element.type || "";
  const x = Number(element.x ?? 0);
  const y = Number(element.y ?? 0);
  const width = Math.max(1, Number(element.width ?? 1));
  const height = Math.max(1, Number(element.height ?? 1));
  const stroke = element.strokeColor || "#1f2937";
  const fill = isTransparent(element.backgroundColor) ? "none" : element.backgroundColor;
  const strokeWidth = Math.max(1, Number(element.strokeWidth ?? 2));
  const opacity = Math.max(0, Math.min(100, Number(element.opacity ?? 100))) / 100;
  const dash = element.strokeStyle === "dashed" ? "10 8" : element.strokeStyle === "dotted" ? "2 8" : undefined;

  if (type === "rectangle") {
    return (
      <g key={element.id || `${type}-${x}-${y}`} opacity={opacity}>
        <rect x={x} y={y} width={width} height={height} rx={10} fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeDasharray={dash} />
        <ShapeLabel element={element} />
      </g>
    );
  }

  if (type === "ellipse") {
    return (
      <g key={element.id || `${type}-${x}-${y}`} opacity={opacity}>
        <ellipse cx={x + width / 2} cy={y + height / 2} rx={width / 2} ry={height / 2} fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeDasharray={dash} />
        <ShapeLabel element={element} />
      </g>
    );
  }

  if (type === "diamond") {
    const points = `${x + width / 2},${y} ${x + width},${y + height / 2} ${x + width / 2},${y + height} ${x},${y + height / 2}`;
    return (
      <g key={element.id || `${type}-${x}-${y}`} opacity={opacity}>
        <polygon points={points} fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeDasharray={dash} />
        <ShapeLabel element={element} />
      </g>
    );
  }

  if (type === "text") {
    const lines = textLines(element.text);
    const fontSize = Math.max(10, Number(element.fontSize ?? 18));
    return (
      <text key={element.id || `${type}-${x}-${y}`} x={x} y={y + fontSize} fill={stroke} fontSize={fontSize} fontFamily="Inter, ui-sans-serif, system-ui" fontWeight={600}>
        {lines.map((line, index) => (
          <tspan key={index} x={x} dy={index === 0 ? 0 : fontSize * 1.25}>
            {line}
          </tspan>
        ))}
      </text>
    );
  }

  if (type === "arrow" || type === "line") {
    let points: Array<[number, number]> = [];
    const start = element.startElementId ? scene.byId.get(element.startElementId) : null;
    const end = element.endElementId ? scene.byId.get(element.endElementId) : null;
    if (start && end) points = [centerOf(start), centerOf(end)];
    else if (element.points?.length) points = element.points.map((point) => [x + Number(point[0] ?? 0), y + Number(point[1] ?? 0)]);
    else points = [[x, y], [x + width, y + height]];
    const d = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point[0]} ${point[1]}`).join(" ");
    const mid = points[Math.floor(points.length / 2)] || points[0];
    return (
      <g key={element.id || `${type}-${x}-${y}`} opacity={opacity}>
        <path d={d} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeDasharray={dash} markerEnd={type === "arrow" ? `url(#${markerId})` : undefined} />
        {element.text && (
          <text x={mid[0]} y={mid[1] - 8} textAnchor="middle" fill={stroke} fontSize={Math.max(10, Number(element.fontSize ?? 13))} fontFamily="Inter, ui-sans-serif, system-ui" paintOrder="stroke" stroke="#ffffff" strokeWidth={4}>
            {element.text}
          </text>
        )}
      </g>
    );
  }

  return null;
}

export function ExcalidrawPreview({ src, data, title, className, compact = false }: { src?: string; data?: ExcalidrawFile | null; title?: string; className?: string; compact?: boolean }) {
  const markerId = `vg-excalidraw-arrow-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const surfaceRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);
  const [loaded, setLoaded] = useState<ExcalidrawFile | null>(data ?? null);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(Boolean(src && !data));
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!src || data) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(src, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return (await res.json()) as ExcalidrawFile;
      })
      .then((next) => {
        if (!cancelled) setLoaded(next);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load Excalidraw file.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [data, src]);

  const scene = useMemo(() => prepareScene(loaded), [loaded]);
  const height = compact ? "h-72" : "h-full";
  const viewBox = useMemo(() => {
    if (!scene) return "0 0 100 100";
    const visibleWidth = scene.bounds.width / zoom;
    const visibleHeight = scene.bounds.height / zoom;
    const centerX = scene.bounds.minX + scene.bounds.width / 2 + offset.x;
    const centerY = scene.bounds.minY + scene.bounds.height / 2 + offset.y;
    return `${centerX - visibleWidth / 2} ${centerY - visibleHeight / 2} ${visibleWidth} ${visibleHeight}`;
  }, [offset.x, offset.y, scene, zoom]);

  const center = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  const adjustZoom = (next: number) => setZoom(Math.max(0.35, Math.min(4, next)));

  const panScale = () => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!scene || !rect?.width || !rect.height) return { x: 1, y: 1 };
    return { x: scene.bounds.width / zoom / rect.width, y: scene.bounds.height / zoom / rect.height };
  };

  return (
    <div className={cn("flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-[#f8f9fa] text-foreground", height, className)}>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-white/80 px-3 text-xs backdrop-blur">
        <FileJson className="size-3.5 text-primary" />
        <span className="truncate font-medium">{title || "Excalidraw"}</span>
        <span className="ml-auto rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">.excalidraw</span>
      </div>
      <div
        ref={surfaceRef}
        className="relative min-h-0 flex-1 cursor-grab overflow-hidden bg-[radial-gradient(circle_at_1px_1px,rgba(15,23,42,0.14)_1px,transparent_0)] [background-size:22px_22px] active:cursor-grabbing"
        title="Click to center, drag to pan, wheel to zoom"
        onClick={() => {
          if (!dragRef.current?.moved) center();
        }}
        onWheel={(event) => {
          if (!scene) return;
          event.preventDefault();
          adjustZoom(zoom * (event.deltaY > 0 ? 0.9 : 1.1));
        }}
        onPointerDown={(event) => {
          if (!scene) return;
          (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
          dragRef.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y, moved: false };
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag) return;
          const dx = event.clientX - drag.x;
          const dy = event.clientY - drag.y;
          if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
          const scale = panScale();
          setOffset({ x: drag.ox - dx * scale.x, y: drag.oy - dy * scale.y });
        }}
        onPointerUp={(event) => {
          (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
          window.setTimeout(() => {
            dragRef.current = null;
          }, 0);
        }}
      >
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading diagram
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-destructive">
            <div className="max-w-sm rounded-lg border border-destructive/30 bg-destructive/10 p-4">
              <AlertTriangle className="mx-auto mb-2 size-5" />
              {error}
            </div>
          </div>
        ) : scene ? (
          <>
          <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-lg border border-border bg-white/90 p-1 shadow-sm backdrop-blur" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <button type="button" className="rounded-md p-1 text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-950" title="Zoom out" onClick={() => adjustZoom(zoom / 1.2)}>
              <ZoomOut className="size-3.5" />
            </button>
            <span className="min-w-10 text-center text-[11px] font-medium text-zinc-500">{Math.round(zoom * 100)}%</span>
            <button type="button" className="rounded-md p-1 text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-950" title="Zoom in" onClick={() => adjustZoom(zoom * 1.2)}>
              <ZoomIn className="size-3.5" />
            </button>
            <button type="button" className="rounded-md p-1 text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-950" title="Center diagram" onClick={center}>
              <Crosshair className="size-3.5" />
            </button>
          </div>
          <svg viewBox={viewBox} className="h-full min-h-[18rem] w-full" role="img" aria-label={title || "Excalidraw diagram"}>
            <defs>
              <marker id={markerId} markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto" markerUnits="strokeWidth">
                <path d="M2,2 L10,6 L2,10 Z" fill="context-stroke" />
              </marker>
            </defs>
            {scene.elements.map((element) => renderElement(element, scene, markerId))}
          </svg>
          </>
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">No renderable Excalidraw elements found.</div>
        )}
      </div>
    </div>
  );
}
