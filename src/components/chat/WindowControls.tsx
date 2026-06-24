"use client";

import { useEffect, useState } from "react";
import { Minus, Square, Maximize2, X } from "lucide-react";

type WindowControlsApi = NonNullable<Window["vaultgate"]>["window"];

export function WindowControls() {
  const [controls, setControls] = useState<WindowControlsApi | null>(null);

  useEffect(() => {
    setControls(window.vaultgate?.window ?? null);
  }, []);

  if (!controls) return null;

  return (
    <div className="app-no-drag ml-1 flex items-center gap-0.5 pl-1">
      <button
        onClick={() => controls.minimize()}
        className="flex size-6 items-center justify-center rounded-md text-foreground/70 transition-colors hover:bg-secondary hover:text-foreground"
        title="Minimize"
        aria-label="Minimize window"
      >
        <Minus className="size-4" />
      </button>
      <button
        onClick={() => controls.toggleMaximize()}
        className="flex size-6 items-center justify-center rounded-md text-foreground/70 transition-colors hover:bg-secondary hover:text-foreground"
        title="Maximize / Restore"
        aria-label="Maximize or restore window"
      >
        <Square className="size-3" />
      </button>
      <button
        onClick={() => controls.toggleFullscreen()}
        className="flex size-6 items-center justify-center rounded-md text-foreground/70 transition-colors hover:bg-secondary hover:text-foreground"
        title="Fullscreen"
        aria-label="Toggle fullscreen"
      >
        <Maximize2 className="size-3.5" />
      </button>
      <button
        onClick={() => controls.close()}
        className="flex size-6 items-center justify-center rounded-md text-foreground/70 transition-colors hover:bg-destructive hover:text-white"
        title="Close"
        aria-label="Close window"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
