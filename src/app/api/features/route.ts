import type { NextRequest } from "next/server";
import { listFeatures } from "@/lib/runtime/features";
import type { ChatMode } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const mode = new URL(request.url).searchParams.get("mode") as ChatMode | null;
  return Response.json({ features: listFeatures(mode ?? undefined) });
}
