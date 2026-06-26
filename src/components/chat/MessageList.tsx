"use client";
import { useEffect } from "react";
import { EMPTY_MESSAGES, useChatStore } from "@/lib/store/chat-store";
import { MessageBubble } from "./MessageBubble";
import { useAutoScroll } from "@/hooks/use-auto-scroll";
import { cn } from "@/lib/utils";
import type { Message } from "@/types";

function messageRenderSignature(message: Message | undefined): string {
  if (!message) return "empty";
  const blockSig = message.blocks
    .map((block) => {
      if (block.type === "tool_calls") {
        const calls = block.toolCalls?.length ?? 0;
        const results = (block.results ?? []).map((r) => `${r.toolCallId}:${r.status}:${r.content.length}`).join("|");
        return `tools:${calls}:${results}`;
      }
      return `${block.type}:${block.content.length}`;
    })
    .join(";");
  return `${message.status}:${message.content.length}:${blockSig}`;
}

/** Group the flat message stream into user→reply turns for clean sticky pinning. */
function groupTurns(messages: Message[]): Message[][] {
  const turns: Message[][] = [];
  for (const message of messages) {
    if (message.role === "user" || turns.length === 0) turns.push([message]);
    else turns[turns.length - 1].push(message);
  }
  return turns;
}

export function MessageList({ chatId, onRegenerate }: { chatId: string; onRegenerate?: (message: Message) => void }) {
  const messages = useChatStore((s) => s.messagesByChat[chatId] ?? EMPTY_MESSAGES);
  const isStreaming = useChatStore((s) => Boolean(s.streamingByChat[chatId]));
  const last = messages[messages.length - 1];
  const { containerRef: scrollRef, scrollToBottom } = useAutoScroll(`${messages.length}:${messageRenderSignature(last)}`, { wasStreaming: isStreaming });
  const turns = groupTurns(messages);

  // Scroll to bottom when user focuses composer (detected via custom event)
  useEffect(() => {
    const handler = () => scrollToBottom();
    window.addEventListener("vaultgate:composer-focus", handler);
    return () => window.removeEventListener("vaultgate:composer-focus", handler);
  }, [scrollToBottom]);

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto scrollbar-none bg-transparent [container-type:size]">
      <div className="mx-auto flex w-full max-w-[var(--composer-width)] flex-col px-3 pt-3">
        {turns.map((turn, index) => (
          <div
            key={turn[0].id}
            className={cn(
              "flex flex-col scroll-mt-2",
              index === turns.length - 1 && "min-h-[calc(100cqh-var(--thread-last-message-clearance))] pb-[var(--thread-last-message-clearance)]",
            )}
          >
            {turn.map((m) => (
              <MessageBubble key={m.id} message={m} onRegenerate={onRegenerate} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
