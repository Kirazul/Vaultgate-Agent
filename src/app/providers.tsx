"use client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Toaster } from "sonner";

type ResolvedTheme = "dark" | "light";

interface ThemeContextValue {
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ResolvedTheme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const THEME_STORAGE_KEY = "vaultgate:theme";

export function useAppTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useAppTheme must be used within Providers");
  return value;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("dark");

  useEffect(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "dark" || stored === "light") {
      setResolvedTheme(stored);
      return;
    }

    setResolvedTheme(window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  const value = useMemo<ThemeContextValue>(() => ({
    resolvedTheme,
    setTheme: (theme) => {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
      setResolvedTheme(theme);
    },
  }), [resolvedTheme]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
      <Toaster position="top-center" richColors />
    </ThemeContext.Provider>
  );
}
