import type { NextRequest } from "next/server";
import { deleteMessagesFrom, listMessages } from "@/lib/db/repo";
import { restoreWorkspaceCheckpoint } from "@/lib/runtime/checkpoints";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json()) as { messageId?: string; createdAt?: number };
  if (!body.messageId) return Response.json({ error: "messageId required" }, { status: 400 });

  try {
    const messages = await listMessages(id);
    const target = messages.find((message) => message.id === body.messageId);
    const cutoff = target?.createdAt ?? body.createdAt;
    if (typeof cutoff !== "number") return Response.json({ error: "Rollback point was not found." }, { status: 404 });

    const checkpoint = restoreWorkspaceCheckpoint(id, body.messageId);
    await deleteMessagesFrom(id, cutoff);
    return Response.json({ ok: true, checkpoint, messages: await listMessages(id) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Rollback failed" }, { status: 500 });
  }
}
