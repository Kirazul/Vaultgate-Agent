import type { NextRequest } from "next/server";
import { startSubAgentTask } from "@/lib/ai/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { chatId?: string; prompt?: string; description?: string; subagentType?: string };
  if (!body.chatId || !body.prompt?.trim()) return Response.json({ error: "chatId and prompt required" }, { status: 400 });
  const id = crypto.randomUUID();
  const description = (body.description || firstLine(body.prompt) || "Background task").trim().slice(0, 120);
  const result = await startSubAgentTask(body.chatId, description, body.prompt.trim(), {
    subagentType: body.subagentType || "general",
    subAgentChatId: id,
  });
  return Response.json({ ok: true, id, result });
}

function firstLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
