// ============================================================
// Progressive content-block builder.
// Accumulates streamed deltas into ordered blocks
// (reasoning / text / tool_calls). Mutated in place during a
// stream; `snapshot()` returns a fresh array for committing to
// the store on each rAF flush.
// ============================================================
import type { ContentBlock, ToolCall } from "@/types";

export class BlockBuilder {
  private blocks: ContentBlock[] = [];
  private text: ContentBlock | null = null;
  private reasoning: ContentBlock | null = null;
  private tools: ContentBlock | null = null;
  private plainText = "";
  private reasoningStartedAt = 0;
  private toolStartedAt = new Map<string, number>();
  private toolBlockById = new Map<string, ContentBlock>();
  private toolCallById = new Map<string, ToolCall>();
  private resultBlockById = new Map<string, ContentBlock>();

  private closeReasoning(): void {
    if (this.reasoning && this.reasoningStartedAt) {
      this.reasoning.durationMs = Math.max(0, Date.now() - this.reasoningStartedAt);
      this.reasoningStartedAt = 0;
    }
  }

  appendText(chunk: string): void {
    if (!chunk) return;
    this.closeReasoning();
    this.reasoning = null;
    this.tools = null;
    if (!this.text) {
      this.text = { type: "text", content: "" };
      this.blocks.push(this.text);
    }
    this.text.content += chunk;
    this.plainText += chunk;
  }

  appendReasoning(chunk: string): void {
    if (!chunk) return;
    this.text = null;
    this.tools = null;
    if (!this.reasoning) {
      this.reasoningStartedAt = Date.now();
      this.reasoning = { type: "reasoning", content: "", startedAt: this.reasoningStartedAt };
      this.blocks.push(this.reasoning);
    }
    this.reasoning.content += chunk;
    if (this.reasoningStartedAt) this.reasoning.durationMs = Math.max(0, Date.now() - this.reasoningStartedAt);
  }

  // ── Tool support (used from Phase 2) ──────────────────────
  addToolCall(call: ToolCall): void {
    const existing = this.toolCallById.get(call.id);
    if (existing) {
      existing.name = call.name || existing.name;
      existing.arguments = call.arguments || existing.arguments;
      return;
    }

    this.closeReasoning();
    this.text = null;
    this.reasoning = null;
    if (!this.tools) {
      this.tools = { type: "tool_calls", content: "", toolCalls: [], results: [] };
      this.blocks.push(this.tools);
    }
    const startedAt = call.startedAt ?? Date.now();
    const next = { ...call, startedAt };
    this.toolStartedAt.set(call.id, startedAt);
    this.tools.toolCalls!.push(next);
    this.toolCallById.set(call.id, next);
    this.toolBlockById.set(call.id, this.tools);
  }

  addToolResult(id: string, status: "running" | "completed" | "error", content: string): void {
    const target = this.resultBlockById.get(id) || this.toolBlockById.get(id) || this.tools;
    if (!target) {
      this.tools = { type: "tool_calls", content: "", toolCalls: [], results: [] };
      this.blocks.push(this.tools);
    }
    const block = target || this.tools!;
    const existing = block.results!.find((r) => r.toolCallId === id);
    const durationMs = Math.max(0, Date.now() - (this.toolStartedAt.get(id) ?? Date.now()));
    if (existing) {
      existing.status = status;
      existing.content = content;
      existing.durationMs = durationMs;
    } else {
      block.results!.push({ toolCallId: id, status, content, durationMs });
      this.resultBlockById.set(id, block);
    }
  }

  /** Fresh array (new refs) so React sees a changed value. */
  snapshot(): ContentBlock[] {
    return this.blocks.map((b) => ({
      ...b,
      durationMs: b.type === "reasoning" && this.reasoning === b && this.reasoningStartedAt ? Math.max(0, Date.now() - this.reasoningStartedAt) : b.durationMs,
      toolCalls: b.toolCalls ? b.toolCalls.map((c) => ({ ...c })) : undefined,
      results: b.results ? b.results.map((r) => ({ ...r })) : undefined,
    }));
  }

  /** Flattened plain answer text (no reasoning, no tools). */
  plain(): string {
    return this.plainText;
  }
}
