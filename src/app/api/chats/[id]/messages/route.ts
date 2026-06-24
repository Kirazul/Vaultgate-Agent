// POST /api/chats/:id/messages — upsert a message (create or update on stream finish).
// DELETE /api/chats/:id/messages — remove specific messages by id.
import type { NextRequest } from "next/server";
import { upsertMessage, deleteMessagesByIds } from "@/lib/db/repo";
import { sanitizeAssistantMessage } from "@/lib/ai/tool-leak-sanitizer";
import type { ContentBlock, Message, Role } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: chatId } = await params;
  const body = (await request.json()) as {
    id: string;
    role: Role;
    content: string;
    blocks: ContentBlock[];
    status: Message["status"];
    model?: string;
    createdAt: number;
  };

  const message = sanitizeAssistantMessage({
    id: body.id,
    chatId,
    role: body.role,
    content: body.content,
    blocks: body.blocks ?? [],
    status: body.status ?? "complete",
    model: body.model,
    createdAt: body.createdAt ?? Date.now(),
  });
  await upsertMessage(message);

  return Response.json({ ok: true }, { status: 201 });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: chatId } = await params;
  const body = (await request.json()) as { ids: string[] };
  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return Response.json({ error: "ids required" }, { status: 400 });
  }
  await deleteMessagesByIds(chatId, body.ids);
  return Response.json({ ok: true });
}
