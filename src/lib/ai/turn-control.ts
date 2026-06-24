import "server-only";

const steerByChat = new Map<string, string[]>();

export function addTurnSteer(chatId: string, note: string): number {
  const trimmed = note.trim();
  if (!trimmed) return steerByChat.get(chatId)?.length ?? 0;
  const list = steerByChat.get(chatId) ?? [];
  list.push(trimmed);
  steerByChat.set(chatId, list.slice(-8));
  return steerByChat.get(chatId)?.length ?? 0;
}

export function drainTurnSteer(chatId: string): string[] {
  const list = steerByChat.get(chatId) ?? [];
  steerByChat.delete(chatId);
  return list;
}
