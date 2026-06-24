"use client";

import { modelProviderIcon } from "@/lib/ai/provider-icons";
import { cn } from "@/lib/utils";

/**
 * Renders a model/provider brand logo from the sprite at
 * /public/provider-icons.svg (the same sprite opencode ships), keyed by the
 * provider inferred from a model id. Pass `model` for a model id like
 * "claude-opus-4-8" or `id` for an explicit provider symbol.
 */
export function ProviderIcon({ model, id, className, size = 14 }: { model?: string; id?: string; className?: string; size?: number }) {
  const symbol = id ?? modelProviderIcon(model ?? "");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      aria-hidden="true"
      className={cn("shrink-0", className)}
      // Monochrome marks (no per-path fill, or fill="currentColor") follow the
      // text color so they stay legible in light AND dark themes; full-color
      // logos keep their own per-path fills.
      style={{ display: "inline-block", fill: "currentColor" }}
    >
      <use href={`/provider-icons.svg#${symbol}`} />
    </svg>
  );
}
