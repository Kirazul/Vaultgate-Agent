"use client";
import { create } from "zustand";
import type { Project } from "@/types";

const ACTIVE_PROJECT_KEY = "vaultgate:activeProjectId";

interface ProjectState {
  projects: Project[];
  activeProjectId: string | null;
  projectSelectorOpen: boolean;
  loading: boolean;

  load: () => Promise<void>;
  setActive: (id: string | null) => void;
  createProject: (path: string, name?: string) => Promise<Project | null>;
  updateProject: (id: string, patch: { name?: string; path?: string }) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  setProjectSelectorOpen: (open: boolean) => void;
  activeProject: () => Project | undefined;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  activeProjectId: null,
  projectSelectorOpen: false,
  loading: false,

  load: async () => {
    set({ loading: true });
    try {
      const res = await fetch("/api/projects", { cache: "no-store" });
      if (!res.ok) return;
      const projects = (await res.json()) as Project[];
      set({ projects });

      // Restore last active project from localStorage.
      if (typeof window !== "undefined") {
        try {
          const saved = window.localStorage.getItem(ACTIVE_PROJECT_KEY);
          if (saved && projects.some((p) => p.id === saved)) {
            set({ activeProjectId: saved });
          } else if (!get().activeProjectId || !projects.some((p) => p.id === get().activeProjectId)) {
            window.localStorage.removeItem(ACTIVE_PROJECT_KEY);
            set({ activeProjectId: null });
          }
        } catch {
          /* private mode */
        }
      }
    } catch {
      /* offline / first run */
    } finally {
      set({ loading: false });
    }
  },

  setActive: (id) => {
    set({ activeProjectId: id });
    if (typeof window !== "undefined") {
      try {
        if (id) window.localStorage.setItem(ACTIVE_PROJECT_KEY, id);
        else window.localStorage.removeItem(ACTIVE_PROJECT_KEY);
      } catch {
        /* private mode */
      }
    }
  },

  createProject: async (path, name) => {
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, name }),
      });
      if (!res.ok) return null;
      const project = (await res.json()) as Project;
      set((s) => {
        const exists = s.projects.some((p) => p.id === project.id);
        return {
          projects: exists ? s.projects.map((p) => (p.id === project.id ? project : p)) : [project, ...s.projects],
          activeProjectId: project.id,
        };
      });
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(ACTIVE_PROJECT_KEY, project.id);
        } catch {
          /* private mode */
        }
      }
      return project;
    } catch {
      return null;
    }
  },

  updateProject: async (id, patch) => {
    try {
      await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", id, ...patch }),
      });
      set((s) => ({
        projects: s.projects.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p)),
      }));
    } catch {
      /* ignore */
    }
  },

  deleteProject: async (id) => {
    try {
      await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id }),
      });
      set((s) => {
        const projects = s.projects.filter((p) => p.id !== id);
        const activeProjectId = s.activeProjectId === id ? (projects[0]?.id ?? null) : s.activeProjectId;
        if (typeof window !== "undefined") {
          try {
            if (activeProjectId) window.localStorage.setItem(ACTIVE_PROJECT_KEY, activeProjectId);
            else window.localStorage.removeItem(ACTIVE_PROJECT_KEY);
          } catch {
            /* private mode */
          }
        }
        return { projects, activeProjectId };
      });
    } catch {
      /* ignore */
    }
  },

  setProjectSelectorOpen: (open) => set({ projectSelectorOpen: open }),

  activeProject: () => {
    const { projects, activeProjectId } = get();
    return projects.find((p) => p.id === activeProjectId);
  },
}));
