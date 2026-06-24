// POST /api/chat — streamed agentic chat completion (our SSE protocol).
import type { NextRequest } from "next/server";
import { streamAgent } from "@/lib/ai/agent";
import type { ChatRequest } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as ChatRequest;
  const stream = streamAgent(body);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform, must-revalidate",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
