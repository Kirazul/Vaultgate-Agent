import type { NextRequest } from "next/server";
import { cancelSubAgentRun, getSubAgentRun } from "@/lib/ai/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return Response.json(getSubAgentRun(id) ?? { id, status: "unknown" });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return Response.json({ ok: cancelSubAgentRun(id) });
}
