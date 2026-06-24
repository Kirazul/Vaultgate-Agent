import type { NextRequest } from "next/server";
import { createWorkspaceCheckpoint } from "@/lib/runtime/checkpoints";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { chatId?: string; messageId?: string; createdAt?: number };
  if (!body.chatId || !body.messageId) return Response.json({ error: "chatId and messageId required" }, { status: 400 });
  try {
    const checkpoint = createWorkspaceCheckpoint(body.chatId, body.messageId, typeof body.createdAt === "number" ? body.createdAt : Date.now());
    return Response.json({ ok: true, checkpoint });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Failed to create checkpoint" }, { status: 500 });
  }
}
