import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind class names with conflict resolution. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Stable unique id (works in browser and Node). */
export function uid(): string {
  return crypto.randomUUID();
}

/** Derive a short chat title from the first user message. */
export function deriveTitle(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "New Chat";
  return cleaned.length > 48 ? cleaned.slice(0, 48) + "…" : cleaned;
}

/**
 * Remove ANSI escape codes (terminal colors) from text.
 * Built via RegExp from an ASCII-only source string so the
 * control-character literals (ESC = ) are unambiguous.
 */
export function stripAnsi(value: string): string {
  const pattern =
    "[\\u001B\\u009B][[\\]()#;?]*(?:(?:[a-zA-Z\\d]*(?:;[a-zA-Z\\d]*)*)?\\u0007|(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~])";
  return value.replace(new RegExp(pattern, "g"), "");
}

/** Best-effort parse of possibly-partial JSON (streaming tool args). */
export function parseJsonLoose(value: string): Record<string, unknown> | null {
  if (!value?.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    let s = value.trim();
    if ((s.match(/"/g)?.length ?? 0) % 2 !== 0) s += '"';
    const stack: string[] = [];
    let inStr = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '"' && s[i - 1] !== "\\") inStr = !inStr;
      if (!inStr) {
        if (c === "{" || c === "[") stack.push(c);
        else if (c === "}" && stack[stack.length - 1] === "{") stack.pop();
        else if (c === "]" && stack[stack.length - 1] === "[") stack.pop();
      }
    }
    while (stack.length) s += stack.pop() === "{" ? "}" : "]";
    try {
      const parsed = JSON.parse(s);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}
