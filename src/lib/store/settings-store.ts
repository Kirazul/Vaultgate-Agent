"use client";
import { create } from "zustand";
import type {
  ApprovalSettings,
  Capability,
  ChatFeatures,
  ChatMode,
  ProviderSettings,
  ProviderSummary,
  ProvidersSettings,
  RoleAssignment,
} from "@/types";
import { DEFAULT_MODE } from "@/lib/modes";

const MODE_STORAGE_KEY = "vaultgate:mode";
const AUTO_STORAGE_KEY = "vaultgate:autoMode";
const FEATURES_STORAGE_KEY = "vaultgate:features";
const AGENT_PARAMS_STORAGE_KEY = "vaultgate:agentParams";
const APPROVAL_STORAGE_KEY = "vaultgate:approval";

const DEFAULT_FEATURES: ChatFeatures = { deepThink: true, webSearch: false, autoImprove: true, planFirst: false };
const DEFAULT_AGENT_PARAMS = {
  temperature: 1,
  maxIterations: 128,
  subAgentMaxIterations: 64,
  maxContextChars: 180000,
  providerRetryCount: 10,
  providerRetryDelayMs: 5000,
};
const DEFAULT_APPROVAL: ApprovalSettings = {
  mode: "auto-safe",
  askForUnknownMcp: true,
  askForExternalActions: true,
  hardBlockDangerous: true,
};

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<T>;
    return { ...(fallback as Record<string, unknown>), ...(parsed as Record<string, unknown>) } as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota — setting still applies for this session */
  }
}

/** Derive the legacy "chat provider" view (endpoint/keySet/model) that the
 * composer model selector and welcome screen still read. */
function deriveChat(settings: ProvidersSettings): { provider: ProviderSettings; models: string[] } {
  const chat = settings.roles.chat;
  const p = settings.providers.find((x) => x.id === chat?.providerId) ?? settings.providers[0];
  return {
    provider: { endpoint: p?.endpoint ?? "", keySet: p?.keySet ?? false, model: chat?.model ?? "" },
    models: p?.models ?? [],
  };
}

interface SettingsState {
  // Derived chat view (kept for ModelSelector / WelcomeScreen / ChatApp).
  provider: ProviderSettings;
  models: string[];
  modelsLoading: boolean;
  // Full registry.
  providers: ProviderSummary[];
  roles: Partial<Record<Capability, RoleAssignment>>;

  features: ChatFeatures;
  mode: ChatMode;
  autoMode: boolean;

  // Agent tuning parameters (exposed in Settings → Agent tab)
  agentParams: {
    temperature: number;
    maxIterations: number;
    subAgentMaxIterations: number;
    maxContextChars: number;
    providerRetryCount: number;
    providerRetryDelayMs: number;
  };
  setAgentParam: <K extends keyof SettingsState["agentParams"]>(key: K, value: SettingsState["agentParams"][K]) => void;

  approval: ApprovalSettings;
  setApproval: <K extends keyof ApprovalSettings>(key: K, value: ApprovalSettings[K]) => void;

  loadProvider: () => Promise<void>;
  saveProvider: (patch: { endpoint?: string; apiKey?: string; model?: string }) => Promise<void>;
  fetchModels: () => Promise<void>;
  setModel: (model: string) => void;

  // Registry actions (Settings dialog).
  upsertProvider: (patch: { id?: string; name?: string; endpoint?: string; apiKey?: string }) => Promise<string | null>;
  removeProvider: (id: string) => Promise<void>;
  assignRole: (capability: Capability, assignment: RoleAssignment | null) => Promise<void>;
  fetchModelsFor: (providerId: string) => Promise<string[]>;

  setFeature: <K extends keyof ChatFeatures>(key: K, value: ChatFeatures[K]) => void;
  setMode: (mode: ChatMode) => void;
  setAutoMode: (auto: boolean) => void;
  hydratePrefs: () => void;
  resetPrefs: () => void;
}

function applySettings(set: (partial: Partial<SettingsState>) => void, data: ProvidersSettings) {
  const { provider, models } = deriveChat(data);
  set({ providers: data.providers, roles: data.roles, provider, models });
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  provider: { endpoint: "", keySet: false, model: "" },
  models: [],
  modelsLoading: false,
  providers: [],
  roles: {},
  features: DEFAULT_FEATURES,
  mode: DEFAULT_MODE,
  autoMode: true,
  agentParams: DEFAULT_AGENT_PARAMS,
  approval: DEFAULT_APPROVAL,
  setAgentParam: (key, value) => set((s) => {
    const agentParams = { ...s.agentParams, [key]: value };
    writeJson(AGENT_PARAMS_STORAGE_KEY, agentParams);
    return { agentParams };
  }),
  setApproval: (key, value) => set((s) => {
    const approval = { ...s.approval, [key]: value };
    writeJson(APPROVAL_STORAGE_KEY, approval);
    return { approval };
  }),

  loadProvider: async () => {
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as ProvidersSettings;
      applySettings(set, data);
    } catch {
      /* offline / first run */
    }
  },

  saveProvider: async (patch) => {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) applySettings(set, (await res.json()) as ProvidersSettings);
  },

  fetchModels: async () => {
    set({ modelsLoading: true });
    try {
      const chatProviderId = get().roles.chat?.providerId;
      const url = chatProviderId ? `/api/models?providerId=${encodeURIComponent(chatProviderId)}` : "/api/models";
      const res = await fetch(url, { cache: "no-store" });
      const data = (await res.json()) as { models?: string[]; modelInfo?: ProviderSummary["modelInfo"]; error?: string };
      set({ models: data.models ?? [] });
      if (!get().provider.model && data.models?.length) await get().saveProvider({ model: data.models[0] });
    } catch {
      set({ models: [] });
    } finally {
      set({ modelsLoading: false });
    }
  },

  setModel: (model) => {
    set((s) => ({ provider: { ...s.provider, model } }));
    void get().saveProvider({ model });
  },

  upsertProvider: async (patch) => {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "upsertProvider", provider: patch }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as ProvidersSettings;
    applySettings(set, data);
    // Return the id of the matching provider (by endpoint, for new creates).
    const match = data.providers.find((p) => p.id === patch.id) ?? data.providers.find((p) => p.endpoint === (patch.endpoint ?? "").trim().replace(/\/+$/, ""));
    return match?.id ?? null;
  },

  removeProvider: async (id) => {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "deleteProvider", id }),
    });
    if (res.ok) applySettings(set, (await res.json()) as ProvidersSettings);
  },

  assignRole: async (capability, assignment) => {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "setRole", capability, assignment }),
    });
    if (res.ok) applySettings(set, (await res.json()) as ProvidersSettings);
  },

  fetchModelsFor: async (providerId) => {
    try {
      const res = await fetch(`/api/models?providerId=${encodeURIComponent(providerId)}`, { cache: "no-store" });
      const data = (await res.json()) as { models?: string[]; modelInfo?: ProviderSummary["modelInfo"] };
      const models = data.models ?? [];
      // Reflect the freshly cached models in local state.
      set((s) => ({ providers: s.providers.map((p) => (p.id === providerId ? { ...p, models, modelInfo: data.modelInfo ?? p.modelInfo } : p)) }));
      if (get().roles.chat?.providerId === providerId) set({ models });
      return models;
    } catch {
      return [];
    }
  },

  setFeature: (key, value) => set((s) => {
    const features = { ...s.features, [key]: value };
    writeJson(FEATURES_STORAGE_KEY, features);
    return { features };
  }),

  setMode: (mode) => {
    if (get().mode === mode) return;
    set({ mode });
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(MODE_STORAGE_KEY, mode);
      } catch {
        /* private mode / quota — mode still applies for the session */
      }
    }
  },

  setAutoMode: (auto) => {
    if (get().autoMode === auto) return;
    set({ autoMode: auto });
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(AUTO_STORAGE_KEY, auto ? "true" : "false");
      } catch {
        /* private mode / quota — still applies for the session */
      }
    }
  },

  hydratePrefs: () => {
    let mode = DEFAULT_MODE;
    let autoMode = true;
    if (typeof window === "undefined") return;
    try {
      const storedMode = window.localStorage.getItem(MODE_STORAGE_KEY);
      if (storedMode === "agent" || storedMode === "code" || storedMode === "chat") mode = storedMode;
      const storedAuto = window.localStorage.getItem(AUTO_STORAGE_KEY);
      if (storedAuto === "true" || storedAuto === "false") autoMode = storedAuto === "true";
    } catch {
      /* preferences still apply for this session */
    }
    set({
      mode,
      autoMode,
      features: readJson(FEATURES_STORAGE_KEY, DEFAULT_FEATURES),
      agentParams: readJson(AGENT_PARAMS_STORAGE_KEY, DEFAULT_AGENT_PARAMS),
      approval: readJson(APPROVAL_STORAGE_KEY, DEFAULT_APPROVAL),
    });
  },

  resetPrefs: () => {
    set({ mode: DEFAULT_MODE, autoMode: true, features: DEFAULT_FEATURES, agentParams: DEFAULT_AGENT_PARAMS, approval: DEFAULT_APPROVAL });
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(MODE_STORAGE_KEY, DEFAULT_MODE);
      window.localStorage.setItem(AUTO_STORAGE_KEY, "true");
    } catch {
      /* reset still applies for this session */
    }
    writeJson(FEATURES_STORAGE_KEY, DEFAULT_FEATURES);
    writeJson(AGENT_PARAMS_STORAGE_KEY, DEFAULT_AGENT_PARAMS);
    writeJson(APPROVAL_STORAGE_KEY, DEFAULT_APPROVAL);
  },
}));
