"use client";
import { Moon, Sun } from "lucide-react";
import { useAppTheme } from "@/app/providers";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useAppTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <button
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="app-no-drag flex size-6 items-center justify-center rounded-md text-foreground/70 transition-colors hover:bg-secondary hover:text-foreground"
      title="Toggle theme"
    >
      {mounted && resolvedTheme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
