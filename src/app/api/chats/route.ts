// GET /api/chats — list chats (optionally filtered by project).
// POST /api/chats — create a chat.
import type { NextRequest } from "next/server";
import { createChat, listChats, listChatsForProject } from "@/lib/db/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (projectId) {
    return Response.json(await listChatsForProject(projectId));
  }
  return Response.json(await listChats());
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { id: string; title?: string; model?: string; parentId?: string; type?: string; projectId?: string };
  const chat = await createChat({
    id: body.id,
    title: body.title || "New Chat",
    model: body.model || "",
    parentId: body.parentId,
    type: body.type,
    projectId: body.projectId,
  });
  return Response.json(chat, { status: 201 });
}
