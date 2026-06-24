// GET  /api/settings — the provider registry (keys masked).
// POST /api/settings — registry mutations (action-based) or legacy single-provider patch.
import type { NextRequest } from "next/server";
import {
  getProvidersSettings,
  setProviderConfig,
  upsertProvider,
  deleteProvider,
  setRole,
  type ProviderPatch,
} from "@/lib/config/settings";
import type { Capability, RoleAssignment } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await getProvidersSettings());
}

type Body =
  | { action: "upsertProvider"; provider: ProviderPatch }
  | { action: "deleteProvider"; id: string }
  | { action: "setRole"; capability: Capability; assignment: RoleAssignment | null }
  | { endpoint?: string; apiKey?: string; model?: string };

export async function POST(request: NextRequest) {
  const body = (await request.json()) as Body;

  if ("action" in body) {
    switch (body.action) {
      case "upsertProvider": {
        const { settings } = await upsertProvider(body.provider ?? {});
        return Response.json(settings);
      }
      case "deleteProvider":
        return Response.json(await deleteProvider(body.id));
      case "setRole":
        return Response.json(await setRole(body.capability, body.assignment));
      default:
        return Response.json({ error: "Unknown action" }, { status: 400 });
    }
  }

  // Legacy single-provider patch (chat model selector, first-run setup).
  await setProviderConfig(body);
  return Response.json(await getProvidersSettings());
}
