"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Message, ToolCall, ToolResult } from "@/types";
import { cn } from "@/lib/utils";
import { useUsageStore } from "@/lib/store/usage-store";

type StatusMode = "requesting" | "thinking" | "responding" | "tool-input" | "tool-use";

const STREAMING_VERBS = [
  "Accomplishing", "Architecting", "Baking", "Bootstrapping", "Brewing",
  "Calculating", "Caramelizing", "Cascading", "Cerebrating", "Choreographing",
  "Churning", "Coalescing", "Cogitating", "Composing", "Computing",
  "Concocting", "Contemplating", "Cooking", "Crafting", "Creating",
  "Crunching", "Crystallizing", "Cultivating", "Deciphering", "Deliberating",
  "Enchanting", "Envisioning", "Fermenting", "Flambéing", "Forging",
  "Generating", "Harmonizing", "Hatching", "Imagining", "Incubating",
  "Inferring", "Manifesting", "Marinating", "Mulling", "Orchestrating",
  "Percolating", "Pondering", "Processing", "Puzzling", "Ruminating",
  "Sautéing", "Seasoning", "Simmering", "Sketching", "Smooshing",
  "Spinning", "Synthesizing", "Tempering", "Tinkering", "Transmuting",
  "Whirring", "Whisking", "Working", "Wrangling", "Zesting",
];

const COMPLETION_VERBS = ["Baked", "Brewed", "Churned", "Cogitated", "Cooked", "Crunched", "Sautéed", "Worked"];

const SPINNER_FRAME_RATE_MS = 80;
const SPINNER_FRAMES = [
  "⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏",
];
const COMPLETED_SYMBOL = "⣿";
const COMPLETED_LINGER_MS = 8000;
const SHOW_TOKENS_AFTER_MS = 5000;
const STALL_THRESHOLD_MS = 3000;

export function TurnStatusLine({ message }: { message?: Message }) {
  const streaming = message?.status === "streaming";
  const verbIdx = useMemo(() => (message ? hashString(message.id) % STREAMING_VERBS.length : 0), [message?.id]);
  const completionIdx = useMemo(() => (message ? hashString(message.id) % COMPLETION_VERBS.length : 0), [message?.id]);
  const [time, setTime] = useState(0);
  const [completed, setCompleted] = useState<{ durationMs: number } | null>(null);
  const [visible, setVisible] = useState(false);
  const [displayTokens, setDisplayTokens] = useState(0);
  const startedAtRef = useRef(message?.createdAt ?? Date.now());
  const lastTokenUpdateRef = useRef(Date.now());
  const realTokens = useUsageStore((s) => s.streamingTokens);

  const mode = useMemo(() => (streaming && message ? detectStatusMode(message) : null), [message, streaming]);

  useEffect(() => {
    if (streaming && message) {
      startedAtRef.current = message.createdAt;
      setCompleted(null);
      setVisible(true);
      setDisplayTokens(0);
    }
  }, [streaming, message?.id]);

  // Live timer + smooth token counter during streaming
  useEffect(() => {
    if (!streaming) return;
    setTime(Date.now() - startedAtRef.current);
    const interval = window.setInterval(() => {
      setTime(Date.now() - startedAtRef.current);
      // Smooth token counter: approach realTokens gradually
      setDisplayTokens((prev) => {
        const target = realTokens;
        if (prev >= target) return target;
        const gap = target - prev;
        let increment: number;
        if (gap < 70) increment = 3;
        else if (gap <= 200) increment = Math.max(8, Math.ceil(gap * 0.15));
        else increment = 50;
        return Math.min(prev + increment, target);
      });
    }, SPINNER_FRAME_RATE_MS);
    return () => window.clearInterval(interval);
  }, [streaming, realTokens]);

  // Track last token update for stall detection
  useEffect(() => {
    if (realTokens > 0) lastTokenUpdateRef.current = Date.now();
  }, [realTokens]);

  // Transition to completed state
  useEffect(() => {
    if (!streaming && visible && !completed) {
      const duration = message?.durationMs ?? Math.max(0, Date.now() - startedAtRef.current);
      setCompleted({ durationMs: duration });
      const timer = setTimeout(() => setVisible(false), COMPLETED_LINGER_MS);
      return () => clearTimeout(timer);
    }
  }, [streaming, visible, completed, message?.durationMs]);

  if (!visible) return null;

  // ── Completed state: ✻ Cooked for 2m 15s ──
  if (completed) {
    return (
      <div className="mx-auto flex w-full max-w-3xl justify-center px-4 pb-1 font-mono text-[13px] leading-6 animate-in fade-in duration-300">
        <div className="flex select-none items-center gap-1.5 text-muted-foreground/60 transition-opacity duration-1000">
          <span className="text-[rgb(215,119,87)]/60">{COMPLETED_SYMBOL}</span>
          <span>{COMPLETION_VERBS[completionIdx]} for {formatDuration(completed.durationMs)}</span>
        </div>
      </div>
    );
  }

  // ── Streaming state ──
  const elapsed = Math.max(0, Math.round(time / 1000));
  const frame = Math.floor(time / SPINNER_FRAME_RATE_MS) % SPINNER_FRAMES.length;
  const showTokens = time > SHOW_TOKENS_AFTER_MS && displayTokens > 0;
  const stalled = realTokens > 0 && Date.now() - lastTokenUpdateRef.current > STALL_THRESHOLD_MS;
  const spinnerColor = stalled ? "text-red-400" : getModeColor(mode);

  const infoParts: string[] = [];
  if (mode === "thinking") infoParts.push("thinking");
  if (elapsed > 0) infoParts.push(formatElapsedCompact(elapsed));
  if (showTokens) infoParts.push(`↓ ${formatTokenCount(displayTokens)} tokens`);

  return (
    <div className="mx-auto flex w-full max-w-3xl justify-center px-4 pb-1 font-mono text-[13px] leading-6">
      <div className="flex min-w-0 max-w-full select-none items-center justify-center gap-1.5">
        <span className={cn("inline-flex w-4 shrink-0 justify-center transition-colors duration-300", spinnerColor)}>
          {SPINNER_FRAMES[frame]}
        </span>
        <span className={cn("shrink-0 font-semibold transition-colors duration-300", spinnerColor)}>
          {STREAMING_VERBS[verbIdx]}…
        </span>
        {infoParts.length > 0 && (
          <span className="min-w-0 truncate text-muted-foreground tabular-nums">
            ({infoParts.join(" · ")})
          </span>
        )}
      </div>
    </div>
  );
}

function getModeColor(mode: StatusMode | null): string {
  switch (mode) {
    case "thinking": return "text-violet-400";
    case "responding": return "text-[rgb(215,119,87)]";
    case "tool-use": return "text-amber-400";
    case "tool-input": return "text-amber-400/70";
    default: return "text-[rgb(215,119,87)]/70";
  }
}

function formatElapsedCompact(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatDuration(ms: number): string {
  const totalSec = Math.max(1, Math.round(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

function detectStatusMode(message: Message): StatusMode {
  const lastBlock = message.blocks[message.blocks.length - 1];
  if (!lastBlock) return "requesting";
  if (lastBlock.type === "reasoning") return "thinking";
  if (lastBlock.type === "text" && lastBlock.content.length > 0) return "responding";
  if (lastBlock.type === "tool_calls") return detectToolMode(lastBlock.toolCalls ?? [], lastBlock.results ?? []);
  return "requesting";
}

function detectToolMode(calls: ToolCall[], results: ToolResult[]): StatusMode {
  if (calls.length === 0) return "requesting";
  for (const call of calls) {
    const result = results.find((item) => item.toolCallId === call.id);
    if (!result) return "tool-input";
    if (result.status === "running") return "tool-use";
  }
  return "tool-use";
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash;
}
