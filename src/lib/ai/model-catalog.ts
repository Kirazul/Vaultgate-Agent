import "server-only";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getDataDir } from "@/lib/config/env";
import type { ModelInfoSummary } from "@/types";

interface CatalogCostTier {
  input: number;
  output: number;
  cache_read?: number;
  cache_write?: number;
  tier: { type: "context"; size: number };
}

interface CatalogCost {
  input: number;
  output: number;
  cache_read?: number;
  cache_write?: number;
  tiers?: CatalogCostTier[];
  context_over_200k?: {
    input: number;
    output: number;
    cache_read?: number;
    cache_write?: number;
  };
}

interface CatalogModel {
  id: string;
  name: string;
  family?: string;
  release_date?: string;
  attachment?: boolean;
  reasoning?: boolean;
  temperature?: boolean;
  tool_call?: boolean;
  cost?: CatalogCost;
  limit: { context: number; input?: number; output: number };
  modalities?: { input?: string[]; output?: string[] };
  status?: "alpha" | "beta" | "deprecated" | "active";
  provider?: { npm?: string; api?: string };
  experimental?: {
    modes?: Record<string, { cost?: CatalogCost; provider?: { body?: Record<string, unknown>; headers?: Record<string, string> } }>;
  };
}

interface CatalogProvider {
  api?: string;
  name: string;
  env: string[];
  id: string;
  npm?: string;
  models: Record<string, CatalogModel>;
}

export interface ModelCost {
  input: number;
  output: number;
  cache: { read: number; write: number };
  tiers?: Array<{ input: number; output: number; cache: { read: number; write: number }; tier: { type: "context"; size: number } }>;
  experimentalOver200K?: { input: number; output: number; cache: { read: number; write: number } };
}

export interface ModelCatalogInfo {
  providerId: string;
  apiId: string;
  id: string;
  name: string;
  family?: string;
  status: "alpha" | "beta" | "deprecated" | "active";
  limit: {
    context: number;
    input?: number;
    output: number;
  };
  cost: ModelCost;
  capabilities: {
    tools: boolean;
    reasoning: boolean;
    attachment: boolean;
    temperature: boolean;
    input: string[];
    output: string[];
  };
}

export interface UsageTokens {
  input: number;
  output: number;
  reasoning?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

const SOURCE = process.env.VAULTGATE_MODELS_URL || "https://models.dev";
const TTL_MS = 5 * 60_000;
let memory: { loadedAt: number; data: Record<string, CatalogProvider> } | null = null;

export async function getModelCatalog(force = false): Promise<Record<string, CatalogProvider>> {
  if (!force && memory && Date.now() - memory.loadedAt < TTL_MS) return memory.data;
  const file = catalogPath();
  const disk = !force ? readFreshDisk(file) : null;
  if (disk) {
    memory = { loadedAt: Date.now(), data: disk };
    return disk;
  }
  const fetched = await fetchCatalog().catch(() => readAnyDisk(file) ?? {});
  memory = { loadedAt: Date.now(), data: fetched };
  return fetched;
}

export async function refreshModelCatalog(): Promise<Record<string, CatalogProvider>> {
  const fetched = await fetchCatalog();
  memory = { loadedAt: Date.now(), data: fetched };
  return fetched;
}

export async function resolveModelInfo(endpoint: string, model: string): Promise<ModelCatalogInfo | null> {
  const catalog = await getModelCatalog();
  return findModelInfo(catalog, endpoint, model);
}

export async function modelMetadataForProvider(endpoint: string, models: string[]): Promise<Record<string, ModelInfoSummary>> {
  if (!endpoint || models.length === 0) return {};
  const catalog = await getModelCatalog();
  return Object.fromEntries(
    models
      .map((model) => [model, findModelInfo(catalog, endpoint, model)] as const)
      .filter((entry): entry is readonly [string, ModelCatalogInfo] => Boolean(entry[1]))
      .map(([model, info]) => [model, publicInfo(info)]),
  );
}

export function usableContextTokens(info: ModelCatalogInfo | null, requested?: number): number {
  if (!info?.limit.context) return requested ?? 0;
  const output = info.limit.output || 0;
  const reserved = Math.min(20_000, output || 20_000);
  const usable = info.limit.input ? Math.max(0, info.limit.input - reserved) : Math.max(0, info.limit.context - output);
  return requested ? Math.min(requested, usable) : usable;
}

export function estimateContextChars(info: ModelCatalogInfo | null, input: { maxChars?: number; maxTokens?: number }): number {
  const tokenBudget = usableContextTokens(info, input.maxTokens);
  if (tokenBudget > 0) return Math.max(32_000, Math.min(input.maxChars ?? Number.MAX_SAFE_INTEGER, tokenBudget * 4));
  return input.maxChars ?? 180_000;
}

export function calculateCost(info: ModelCatalogInfo | null, usage: UsageTokens): number | undefined {
  if (!info) return undefined;
  const contextTokens = usage.input + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
  const costInfo = selectCost(info.cost, contextTokens);
  const total =
    safe(usage.input) * costInfo.input / 1_000_000 +
    safe(usage.output) * costInfo.output / 1_000_000 +
    safe(usage.cacheRead) * costInfo.cache.read / 1_000_000 +
    safe(usage.cacheWrite) * costInfo.cache.write / 1_000_000 +
    safe(usage.reasoning) * costInfo.output / 1_000_000;
  return Number.isFinite(total) ? total : undefined;
}

function catalogPath(): string {
  const dir = path.join(getDataDir(), "cache");
  mkdirSync(dir, { recursive: true });
  return path.join(dir, SOURCE === "https://models.dev" ? "models.json" : `models-${hashFast(SOURCE)}.json`);
}

async function fetchCatalog(): Promise<Record<string, CatalogProvider>> {
  const res = await fetch(`${SOURCE.replace(/\/+$/, "")}/api.json`, { headers: { "User-Agent": "vaultgate/1.0" }, cache: "no-store" });
  if (!res.ok) throw new Error(`models.dev returned ${res.status}`);
  const text = await res.text();
  const parsed = JSON.parse(text) as Record<string, CatalogProvider>;
  writeFileSync(catalogPath(), text, "utf-8");
  return parsed;
}

function readFreshDisk(file: string): Record<string, CatalogProvider> | null {
  try {
    if (!existsSync(file)) return null;
    if (Date.now() - statSync(file).mtimeMs >= TTL_MS) return null;
    return JSON.parse(readFileSync(file, "utf-8")) as Record<string, CatalogProvider>;
  } catch {
    return null;
  }
}

function readAnyDisk(file: string): Record<string, CatalogProvider> | null {
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, "utf-8")) as Record<string, CatalogProvider>;
  } catch {
    return null;
  }
}

function findModelInfo(catalog: Record<string, CatalogProvider>, endpoint: string, modelId: string): ModelCatalogInfo | null {
  const normalizedEndpoint = normalizeApi(endpoint);
  const requested = normalizeModelId(modelId);
  const matchingProviders = Object.values(catalog).filter((provider) => {
    if (normalizeApi(provider.api || "") === normalizedEndpoint) return true;
    return Object.values(provider.models).some((model) => normalizeApi(model.provider?.api || "") === normalizedEndpoint);
  });
  for (const provider of matchingProviders) {
    const found = findProviderModel(provider, requested);
    if (found) return toInfo(provider, found);
  }
  for (const provider of Object.values(catalog)) {
    const found = findProviderModel(provider, requested);
    if (found) return toInfo(provider, found);
  }
  return null;
}

function findProviderModel(provider: CatalogProvider, requested: string): CatalogModel | null {
  const exact = provider.models[requested] ?? Object.values(provider.models).find((model) => normalizeModelId(model.id) === requested);
  if (exact) return exact;
  const withoutProvider = requested.startsWith(`${provider.id}/`) ? requested.slice(provider.id.length + 1) : requested;
  return provider.models[withoutProvider] ?? Object.values(provider.models).find((model) => normalizeModelId(model.id) === withoutProvider) ?? null;
}

function toInfo(provider: CatalogProvider, model: CatalogModel): ModelCatalogInfo {
  return {
    providerId: provider.id,
    id: model.id,
    apiId: model.id,
    name: model.name,
    family: model.family,
    status: model.status ?? "active",
    limit: {
      context: model.limit.context,
      input: model.limit.input,
      output: model.limit.output,
    },
    cost: normalizeCost(model.cost),
    capabilities: {
      tools: model.tool_call ?? true,
      reasoning: model.reasoning ?? false,
      attachment: model.attachment ?? false,
      temperature: model.temperature ?? false,
      input: [...(model.modalities?.input ?? [])],
      output: [...(model.modalities?.output ?? [])],
    },
  };
}

function normalizeCost(cost: CatalogCost | undefined): ModelCost {
  return {
    input: cost?.input ?? 0,
    output: cost?.output ?? 0,
    cache: {
      read: cost?.cache_read ?? 0,
      write: cost?.cache_write ?? 0,
    },
    tiers: cost?.tiers?.map((tier) => ({
      input: tier.input,
      output: tier.output,
      cache: {
        read: tier.cache_read ?? 0,
        write: tier.cache_write ?? 0,
      },
      tier: tier.tier,
    })),
    experimentalOver200K: cost?.context_over_200k ? {
      input: cost.context_over_200k.input,
      output: cost.context_over_200k.output,
      cache: {
        read: cost.context_over_200k.cache_read ?? 0,
        write: cost.context_over_200k.cache_write ?? 0,
      },
    } : undefined,
  };
}

function publicInfo(info: ModelCatalogInfo): ModelInfoSummary {
  return {
    id: info.id,
    name: info.name,
    family: info.family,
    status: info.status,
    limit: info.limit,
    cost: {
      input: info.cost.input,
      output: info.cost.output,
      cacheRead: info.cost.cache.read,
      cacheWrite: info.cost.cache.write,
    },
    capabilities: info.capabilities,
  };
}

function selectCost(cost: ModelCost, contextTokens: number): { input: number; output: number; cache: { read: number; write: number } } {
  const tier = cost.tiers
    ?.filter((item) => item.tier.type === "context" && contextTokens > item.tier.size)
    .sort((a, b) => b.tier.size - a.tier.size)[0];
  if (tier) return tier;
  if (cost.experimentalOver200K && contextTokens > 200_000) return cost.experimentalOver200K;
  return cost;
}

function normalizeApi(value: string): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/+$/, "").toLowerCase();
  } catch {
    return value.trim().replace(/\/+$/, "").toLowerCase();
  }
}

function normalizeModelId(value: string): string {
  return value.trim().toLowerCase();
}

function safe(value: number | undefined): number {
  return Number.isFinite(value) && value ? value : 0;
}

function hashFast(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) hash = (hash * 33) ^ value.charCodeAt(i);
  return (hash >>> 0).toString(36);
}
