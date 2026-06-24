import type { NextRequest } from "next/server";
import { readWorkspaceFile } from "@/lib/runtime/files";
import { resolveWorkspaceRoot } from "@/lib/runtime/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const chatId = request.nextUrl.searchParams.get("chatId");
  const path = request.nextUrl.searchParams.get("path");
  if (!chatId || !path) return Response.json({ error: "chatId and path required" }, { status: 400 });
  try {
    await resolveWorkspaceRoot(chatId);
    return Response.json({ content: readWorkspaceFile(chatId, path) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "read failed" }, { status: 404 });
  }
}
