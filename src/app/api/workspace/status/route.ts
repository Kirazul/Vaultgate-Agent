import type { NextRequest } from "next/server";
import { workspaceStatus } from "@/lib/runtime/workspace";
import { readRuntimeStatus } from "@/lib/runtime/execution-runtime";
import { listManagedProcesses } from "@/lib/runtime/process-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const chatId = request.nextUrl.searchParams.get("chatId");
  if (!chatId) return Response.json({ error: "chatId required" }, { status: 400 });
  try {
    const status = await workspaceStatus(chatId);
    const runtime = readRuntimeStatus(chatId);
    const processes = listManagedProcesses(chatId);
    return Response.json({ status: status.status, rootDir: status.rootDir, runtime, processes });
  } catch {
    return Response.json({ status: "not_found" });
  }
}
