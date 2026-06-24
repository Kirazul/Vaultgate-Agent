"use client";
import { useEffect, useRef, useState } from "react";
import { useSettingsStore } from "@/lib/store/settings-store";
import { modeDef } from "@/lib/modes";
import type { ChatMode } from "@/types";

/**
 * The cinematic mode "transformation" overlay. Watches the active mode and,
 * whenever it changes, plays a full-viewport sweep — accent recolor, scanline,
 * tech grid, and the mode's name/tagline — so the whole app visibly evolves
 * into the new mode. Pointer-events stay off so the app is never blocked.
 */
export function ModeTransition() {
  const mode = useSettingsStore((s) => s.mode);
  const prev = useRef<ChatMode>(mode);
  const armed = useRef(false);
  const [active, setActive] = useState<ChatMode | null>(null);

  // Arm only after the post-mount pref hydration has settled, so restoring a
  // persisted mode on page load doesn't fire the overlay.
  useEffect(() => {
    const t = setTimeout(() => {
      armed.current = true;
    }, 400);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (prev.current === mode) return;
    prev.current = mode;
    if (!armed.current) return;
    setActive(mode);
    const timer = setTimeout(() => setActive(null), 1150);
    return () => clearTimeout(timer);
  }, [mode]);

  if (!active) return null;
  const def = modeDef(active);
  const Icon = def.icon;

  return (
    <div
      key={active}
      className="mode-transition pointer-events-none fixed inset-0 z-[200] flex items-center justify-center overflow-hidden"
      style={{ ["--mode-accent" as string]: def.accent } as React.CSSProperties}
      aria-hidden
    >
      <div className="mode-transition-grid" />
      <div className="mode-transition-scan" />
      <div className="mode-transition-core flex flex-col items-center gap-3 text-center">
        <span className="mode-transition-icon">
          <Icon className="size-12" strokeWidth={1.5} />
        </span>
        <span className="mode-transition-title">{def.label}</span>
        <span className="mode-transition-tag">{def.tagline}</span>
      </div>
    </div>
  );
}
