import type { NextRequest } from "next/server";
import { addTurnSteer } from "@/lib/ai/turn-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { chatId?: string; note?: string };
  if (!body.chatId || !body.note?.trim()) return Response.json({ error: "chatId and note required" }, { status: 400 });
  const pending = addTurnSteer(body.chatId, body.note);
  return Response.json({ ok: true, pending });
}
