"use client";
import { create } from "zustand";

interface UiState {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebar: (open: boolean) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  inventoryOpen: boolean;
  setInventoryOpen: (open: boolean) => void;
  inventoryTab: string;
  setInventoryTab: (tab: string) => void;
  settingsTab: string;
  setSettingsTab: (tab: string) => void;
  /** Which project groups are collapsed in the sidebar (by project id). */
  collapsedProjects: Set<string>;
  toggleProjectCollapsed: (id: string) => void;
  /** Open Project dialog for adding new projects. */
  addProjectOpen: boolean;
  setAddProjectOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebar: (open) => set({ sidebarOpen: open }),
  settingsOpen: false,
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  inventoryOpen: false,
  setInventoryOpen: (open) => set({ inventoryOpen: open }),
  inventoryTab: "features",
  setInventoryTab: (tab) => set({ inventoryTab: tab }),
  settingsTab: "providers",
  setSettingsTab: (tab) => set({ settingsTab: tab }),
  collapsedProjects: new Set<string>(),
  toggleProjectCollapsed: (id) =>
    set((s) => {
      const next = new Set(s.collapsedProjects);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { collapsedProjects: next };
    }),
  addProjectOpen: false,
  setAddProjectOpen: (open) => set({ addProjectOpen: open }),
}));
