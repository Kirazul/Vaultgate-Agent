// ============================================================
// Client-side SSE reader for OUR protocol.
// Reads the Response body in a tight loop and parses each
// `data: <json>` frame into a typed StreamEvent. This loop does
// NOT touch React — the caller batches updates (see use-chat-stream).
// ============================================================
import type { StreamEvent } from "@/types";

export async function readEventStream(
  response: Response,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!response.body) {
    onEvent({ type: "error", message: "No response body" });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      for (const f of frames) parseFrame(f, onEvent);
    }
    if (buffer.trim()) parseFrame(buffer, onEvent);
  } catch (err) {
    if (!signal?.aborted) {
      onEvent({ type: "error", message: err instanceof Error ? err.message : "Stream error" });
    }
  }
}

function parseFrame(raw: string, onEvent: (event: StreamEvent) => void): void {
  const dataLines: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trimEnd();
    if (!trimmed || trimmed.startsWith(":")) continue;
    if (trimmed.startsWith("data:")) dataLines.push(trimmed.slice(5).replace(/^\s/, ""));
  }
  const data = dataLines.join("\n").trim();
  if (!data) return;
  if (data === "[DONE]") {
    onEvent({ type: "done" });
    return;
  }
  try {
    onEvent(JSON.parse(data) as StreamEvent);
  } catch {
    /* ignore malformed frame */
  }
}
