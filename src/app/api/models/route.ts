// GET /api/models[?providerId=…] — list models from a provider.
// No providerId → the main chat provider. Caches the result on the provider.
import type { NextRequest } from "next/server";
import { getCapabilityConfig, resolveProviderById, setProviderModels } from "@/lib/config/settings";
import { modelMetadataForProvider, refreshModelCatalog } from "@/lib/ai/model-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function endpointAndKeyFor(providerId: string | null): Promise<{ endpoint: string; apiKey: string } | null> {
  const resolved = providerId ? await resolveProviderById(providerId) : await getCapabilityConfig("chat");
  return resolved && resolved.endpoint ? { endpoint: resolved.endpoint, apiKey: resolved.apiKey } : null;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const providerId = url.searchParams.get("providerId");
  const refresh = url.searchParams.get("refresh") === "1";
  const resolved = await endpointAndKeyFor(providerId);
  if (!resolved) return Response.json({ models: [], error: "No endpoint configured" }, { status: 400 });

  try {
    if (refresh) await refreshModelCatalog().catch(() => undefined);
    const headers: Record<string, string> = {};
    if (resolved.apiKey) headers.Authorization = `Bearer ${resolved.apiKey}`;
    const res = await fetch(`${resolved.endpoint.replace(/\/+$/, "")}/models`, { headers, cache: "no-store" });
    if (!res.ok) return Response.json({ models: [], error: `Provider returned ${res.status}` }, { status: 502 });
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    const models = (data.data ?? []).map((m) => m.id).filter(Boolean).sort();
    if (providerId) await setProviderModels(providerId, models);
    const modelInfo = await modelMetadataForProvider(resolved.endpoint, models).catch(() => ({}));
    return Response.json({ models, modelInfo });
  } catch (err) {
    return Response.json({ models: [], error: err instanceof Error ? err.message : "Failed to fetch models" }, { status: 502 });
  }
}
