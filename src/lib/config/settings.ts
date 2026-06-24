// ============================================================
// Provider registry service (server-only).
//
// Holds an unlimited list of OpenAI-compatible providers (each an
// endpoint + key + cached models) and a set of capability ROLE
// assignments (chat / vision / image) → (provider, model).
//
// Persisted in the SQLite `settings` table under "providers";
// migrated once from the legacy single-provider "provider" key.
// API keys never leave the server — the client only learns `keySet`.
// ============================================================
import "server-only";
import { getSetting, setSetting } from "@/lib/db/repo";
import { getProviderDefaults } from "./env";
import { modelMetadataForProvider } from "@/lib/ai/model-catalog";
import type { Capability, ProviderSummary, ProvidersSettings, RoleAssignment } from "@/types";

const KEY = "providers";
const LEGACY_KEY = "provider";

/** Internal record — includes the secret key (server-only). */
interface StoredProvider {
  id: string;
  name: string;
  endpoint: string;
  apiKey: string;
  models: string[];
}
interface StoredConfig {
  providers: StoredProvider[];
  roles: Partial<Record<Capability, RoleAssignment>>;
}

/** Resolved endpoint+key+model for one capability (server-only). */
export interface ResolvedProvider {
  endpoint: string;
  apiKey: string;
  model: string;
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

function normalizeEndpoint(value: string): string {
  return (value || "").trim().replace(/\/+$/, "");
}

function parse(raw: string | null): StoredConfig | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as Partial<StoredConfig>;
    if (!obj || !Array.isArray(obj.providers)) return null;
    return {
      providers: obj.providers.map((p) => ({
        id: String(p.id || newId()),
        name: String(p.name || "Provider"),
        endpoint: normalizeEndpoint(String(p.endpoint || "")),
        apiKey: typeof p.apiKey === "string" ? p.apiKey : "",
        models: Array.isArray(p.models) ? p.models.filter((m): m is string => typeof m === "string") : [],
      })),
      roles: (obj.roles && typeof obj.roles === "object" ? obj.roles : {}) as StoredConfig["roles"],
    };
  } catch {
    return null;
  }
}

/** Build the initial registry from the legacy single-provider config + env defaults. */
async function buildInitial(): Promise<StoredConfig> {
  const defaults = getProviderDefaults();
  let legacy: { endpoint?: string; apiKey?: string; model?: string } = {};
  try {
    const raw = await getSetting(LEGACY_KEY);
    if (raw) legacy = JSON.parse(raw) as typeof legacy;
  } catch {
    /* ignore malformed legacy */
  }
  const endpoint = normalizeEndpoint(legacy.endpoint ?? defaults.endpoint);
  const apiKey = legacy.apiKey ?? defaults.apiKey;
  const model = (legacy.model ?? defaults.model ?? "").trim();

  if (!endpoint && !apiKey && !model) return { providers: [], roles: {} };

  const provider: StoredProvider = { id: newId(), name: "Default", endpoint, apiKey, models: [] };
  return { providers: [provider], roles: { chat: { providerId: provider.id, model } } };
}

async function load(): Promise<StoredConfig> {
  const existing = parse(await getSetting(KEY));
  if (existing) return existing;
  const initial = await buildInitial();
  await persist(initial);
  return initial;
}

async function persist(config: StoredConfig): Promise<void> {
  await setSetting(KEY, JSON.stringify(config));
}

function findProvider(config: StoredConfig, id: string | undefined): StoredProvider | undefined {
  return id ? config.providers.find((p) => p.id === id) : undefined;
}

/** Resolve the (endpoint, key, model) for a capability, falling back to the
 * chat role and then the first provider. */
function resolveCapability(config: StoredConfig, cap: Capability): ResolvedProvider {
  const role = config.roles[cap] ?? config.roles.chat;
  const provider = findProvider(config, role?.providerId) ?? config.providers[0];
  if (!provider) return { endpoint: "", apiKey: "", model: "" };
  // Use the role's model if it belongs to the resolved provider's role;
  // otherwise fall back to the chat model, then empty.
  const model = role?.model || config.roles.chat?.model || provider.models[0] || "";
  return { endpoint: provider.endpoint, apiKey: provider.apiKey, model };
}

// ── Public: capability/legacy resolvers (server-only) ────────

/** Backward-compatible: the main chat provider's endpoint/key/model. */
export async function getProviderConfig(): Promise<ResolvedProvider> {
  return resolveCapability(await load(), "chat");
}

/** The chat provider plus its full discovered model list (server-only).
 * Used by the MultiModel tool to fan a prompt across several models on the
 * same endpoint and synthesize a consensus answer. */
export async function getChatProvider(): Promise<ResolvedProvider & { models: string[] }> {
  const config = await load();
  const resolved = resolveCapability(config, "chat");
  const role = config.roles.chat;
  const provider = findProvider(config, role?.providerId) ?? config.providers[0];
  return { ...resolved, models: provider?.models ?? [] };
}

/** Endpoint/key/model for a specific capability (vision/image/chat). */
export async function getCapabilityConfig(cap: Capability): Promise<ResolvedProvider> {
  return resolveCapability(await load(), cap);
}

/** Endpoint/key for a specific provider id (server-only; used to fetch models). */
export async function resolveProviderById(id: string): Promise<ResolvedProvider | null> {
  const provider = findProvider(await load(), id);
  if (!provider) return null;
  return { endpoint: provider.endpoint, apiKey: provider.apiKey, model: provider.models[0] || "" };
}

// ── Public: client-facing registry (keys masked) ────────────

async function toSummary(p: StoredProvider): Promise<ProviderSummary> {
  return {
    id: p.id,
    name: p.name,
    endpoint: p.endpoint,
    keySet: Boolean(p.apiKey),
    models: p.models,
    modelInfo: await modelMetadataForProvider(p.endpoint, p.models).catch(() => ({})),
  };
}

async function toSettings(config: StoredConfig): Promise<ProvidersSettings> {
  return { providers: await Promise.all(config.providers.map(toSummary)), roles: config.roles };
}

export async function getProvidersSettings(): Promise<ProvidersSettings> {
  const config = await load();
  return toSettings(config);
}

// ── Public: registry mutations ───────────────────────────────

export interface ProviderPatch {
  id?: string;
  name?: string;
  endpoint?: string;
  apiKey?: string;
  models?: string[];
}

/** Create or update a provider. Returns its id. A blank apiKey is ignored on
 * update (keeps the stored key); pass an explicit empty string only via clearKey. */
export async function upsertProvider(patch: ProviderPatch): Promise<{ id: string; settings: ProvidersSettings }> {
  const config = await load();
  let provider = findProvider(config, patch.id);
  if (!provider) {
    provider = { id: patch.id || newId(), name: patch.name || "Provider", endpoint: "", apiKey: "", models: [] };
    config.providers.push(provider);
    // First provider auto-becomes the chat role if none set.
    if (!config.roles.chat) config.roles.chat = { providerId: provider.id, model: "" };
  }
  if (patch.name !== undefined) provider.name = patch.name.trim() || provider.name;
  if (patch.endpoint !== undefined) provider.endpoint = normalizeEndpoint(patch.endpoint);
  if (patch.apiKey !== undefined && patch.apiKey !== "") provider.apiKey = patch.apiKey;
  if (patch.models !== undefined) provider.models = patch.models.filter(Boolean);
  await persist(config);
  return { id: provider.id, settings: await toSettings(config) };
}

export async function deleteProvider(id: string): Promise<ProvidersSettings> {
  const config = await load();
  config.providers = config.providers.filter((p) => p.id !== id);
  // Drop roles pointing at the removed provider.
  for (const cap of Object.keys(config.roles) as Capability[]) {
    if (config.roles[cap]?.providerId === id) delete config.roles[cap];
  }
  // Keep chat pointing somewhere if possible.
  if (!config.roles.chat && config.providers[0]) {
    config.roles.chat = { providerId: config.providers[0].id, model: config.providers[0].models[0] || "" };
  }
  await persist(config);
  return toSettings(config);
}

/** Assign a capability to a (provider, model). Pass model:"" / providerId:"" to clear. */
export async function setRole(cap: Capability, assignment: RoleAssignment | null): Promise<ProvidersSettings> {
  const config = await load();
  if (!assignment || (!assignment.providerId && !assignment.model)) {
    delete config.roles[cap];
  } else {
    config.roles[cap] = { providerId: assignment.providerId, model: assignment.model };
  }
  await persist(config);
  return toSettings(config);
}

/** Cache the discovered model list for a provider. */
export async function setProviderModels(id: string, models: string[]): Promise<void> {
  const config = await load();
  const provider = findProvider(config, id);
  if (!provider) return;
  provider.models = models.filter(Boolean);
  await persist(config);
}

// ── Backward-compatible single-provider mutation (legacy callers) ──
export async function setProviderConfig(patch: { endpoint?: string; apiKey?: string; model?: string }): Promise<ResolvedProvider> {
  const config = await load();
  let provider = findProvider(config, config.roles.chat?.providerId) ?? config.providers[0];
  if (!provider) {
    provider = { id: newId(), name: "Default", endpoint: "", apiKey: "", models: [] };
    config.providers.push(provider);
    config.roles.chat = { providerId: provider.id, model: "" };
  }
  if (patch.endpoint !== undefined) provider.endpoint = normalizeEndpoint(patch.endpoint);
  if (patch.apiKey !== undefined && patch.apiKey !== "") provider.apiKey = patch.apiKey;
  if (patch.model !== undefined) {
    config.roles.chat = { providerId: provider.id, model: patch.model.trim() };
  }
  await persist(config);
  return resolveCapability(config, "chat");
}
