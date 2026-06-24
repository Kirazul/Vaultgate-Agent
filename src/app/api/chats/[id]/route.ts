// GET /api/chats/:id (with messages)  ·  PATCH (title/model)  ·  DELETE
import type { NextRequest } from "next/server";
import { deleteChat, getChat, updateChat, updateChatProject } from "@/lib/db/repo";
import { releaseWorkspace } from "@/lib/runtime/workspace";
import { clearResolvedRoot } from "@/lib/runtime/resolved-roots";
import { cancelSubAgentRun, cancelSubAgentRunsForParent } from "@/lib/ai/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const chat = await getChat(id);
  if (!chat) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(chat);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const patch = (await request.json()) as { title?: string; model?: string; projectId?: string | null };
  try {
    await updateChat(id, patch);
    if ("projectId" in patch) {
      await updateChatProject(id, patch.projectId ?? null);
      clearResolvedRoot(id);
    }
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Update failed";
    if (message.includes("workspace root is locked")) return Response.json({ error: message }, { status: 409 });
    throw error;
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  cancelSubAgentRun(id);
  cancelSubAgentRunsForParent(id);
  // Best-effort workspace cleanup; never let a lingering file lock block the
  // chat deletion itself. Any orphaned directory is harmless and GC-able later.
  let workspaceRemoved = true;
  try {
    workspaceRemoved = (await releaseWorkspace(id)).removed;
  } catch {
    workspaceRemoved = false;
  }
  await deleteChat(id);
  return Response.json({ ok: true, workspaceRemoved });
}
