"use client";
import { useEffect, useState } from "react";

/**
 * Live elapsed-time display.
 *
 * The streaming pipeline only re-renders a message when new tokens
 * arrive (the rAF flush is gated on a `dirty` flag). That means any
 * duration derived purely from render time freezes between token
 * bursts and then visibly *jumps* (e.g. "1s" → "5s") when the next
 * burst lands — and stays frozen entirely while the agent is waiting
 * on a tool result.
 *
 * This hook owns its own 1s interval while `active`, so the counter
 * advances 1 → 2 → 3 … in real time regardless of stream activity.
 * Once `active` is false it returns the frozen final value.
 *
 * @param active     whether the work this timer measures is ongoing
 * @param startedAt  epoch ms when the work began
 * @param finalMs    authoritative duration to show once finished
 */
export function useElapsed(active: boolean, startedAt: number | undefined, finalMs?: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active || !startedAt) return;
    // Snap immediately, then tick once per second on a 1s grid so every
    // mounted timer advances in lockstep (no staggered, jittery updates).
    setNow(Date.now());
    let intervalId: ReturnType<typeof setInterval> | undefined;
    const align = 1000 - (Date.now() % 1000);
    const timeoutId = setTimeout(() => {
      setNow(Date.now());
      intervalId = setInterval(() => setNow(Date.now()), 1000);
    }, align);
    return () => {
      clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, [active, startedAt]);

  if (active && startedAt) return Math.max(0, now - startedAt);
  if (typeof finalMs === "number") return finalMs;
  if (startedAt) return Math.max(0, Date.now() - startedAt);
  return 0;
}

/** Format an elapsed duration as a compact, human label (e.g. "5s", "1m 3s"). */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}
