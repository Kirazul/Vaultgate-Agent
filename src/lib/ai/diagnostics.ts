// ============================================================
// Post-edit diagnostics (server-only).
//
// After every Write/Edit/MultiEdit/ApplyPatch, the changed file is checked for
// errors and a concise, code-framed report is appended to the tool result — so
// the agent sees a broken edit immediately and fixes it in the SAME turn,
// instead of finding out turns later when a build fails.
//
// Unlike an LSP integration (Claude Code / opencode), this needs ZERO setup:
//   • TS/JS → real syntactic diagnostics from the bundled TypeScript compiler
//             (in-process, instant), with a structural-balance fallback.
//   • JSON  → strict parse with line/col.
//   • CSS   → brace/paren balance.
// It works in an empty project, never spawns a process, and is wrapped so a
// diagnostics failure can never break the edit itself.
// ============================================================
import "server-only";
import path from "node:path";

export interface Diagnostic {
  line: number; // 1-based
  col: number; // 1-based
  message: string;
  severity: "error" | "warning";
}

const TS_EXT = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const JSON_EXT = new Set([".json", ".jsonc"]);
const CSS_EXT = new Set([".css", ".scss", ".less"]);

/** Languages we can check instantly & reliably. Everything else returns []. */
export function isDiagnosable(file: string): boolean {
  const ext = path.extname(file).toLowerCase();
  return TS_EXT.has(ext) || JSON_EXT.has(ext) || CSS_EXT.has(ext);
}

export async function diagnoseFile(absPath: string, content: string): Promise<Diagnostic[]> {
  try {
    const ext = path.extname(absPath).toLowerCase();
    if (TS_EXT.has(ext)) return await diagnoseTs(absPath, content, ext);
    if (JSON_EXT.has(ext)) return diagnoseJson(content, ext === ".jsonc");
    if (CSS_EXT.has(ext)) return diagnoseBalanced(content);
    return [];
  } catch {
    // Diagnostics must never break an edit.
    return [];
  }
}

// ── TypeScript / JavaScript: real parser diagnostics ─────────
async function diagnoseTs(absPath: string, content: string, ext: string): Promise<Diagnostic[]> {
  try {
    const ts = await import("typescript");
    const kind =
      ext === ".tsx" || ext === ".jsx"
        ? ts.ScriptKind.TSX
        : ext === ".js" || ext === ".mjs" || ext === ".cjs"
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(path.basename(absPath), content, ts.ScriptTarget.Latest, /*setParentNodes*/ false, kind);
    // `parseDiagnostics` carries syntax errors detected while parsing.
    const raw = (sf as unknown as { parseDiagnostics?: Array<{ start?: number; messageText: unknown }> }).parseDiagnostics ?? [];
    const diags: Diagnostic[] = [];
    for (const d of raw) {
      const pos = typeof d.start === "number" ? sf.getLineAndCharacterOfPosition(d.start) : { line: 0, character: 0 };
      diags.push({ line: pos.line + 1, col: pos.character + 1, message: flattenTsMessage(ts, d.messageText), severity: "error" });
    }
    return diags;
  } catch {
    // TypeScript unavailable (e.g. trimmed packaged runtime) → structural check.
    return diagnoseBalanced(content);
  }
}

function flattenTsMessage(ts: typeof import("typescript"), messageText: unknown): string {
  if (typeof messageText === "string") return messageText;
  try {
    return ts.flattenDiagnosticMessageText(messageText as import("typescript").DiagnosticMessageChain, " ");
  } catch {
    return String(messageText);
  }
}

// ── JSON: strict parse with location ─────────────────────────
function diagnoseJson(content: string, allowComments: boolean): Diagnostic[] {
  const text = allowComments ? stripJsonComments(content) : content;
  if (!text.trim()) return [];
  try {
    JSON.parse(text);
    return [];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // V8 messages include "... at position N" and/or "line X column Y".
    const lc = /line (\d+) column (\d+)/i.exec(message);
    if (lc) return [{ line: Number(lc[1]), col: Number(lc[2]), message: cleanJsonMessage(message), severity: "error" }];
    const posMatch = /at position (\d+)/i.exec(message);
    const pos = posMatch ? Number(posMatch[1]) : 0;
    const { line, col } = offsetToLineCol(content, pos);
    return [{ line, col, message: cleanJsonMessage(message), severity: "error" }];
  }
}

function cleanJsonMessage(message: string): string {
  return message.replace(/ in JSON at position \d+.*/i, "").replace(/^JSON\.parse: /i, "").trim() || "Invalid JSON";
}

function stripJsonComments(text: string): string {
  // Replace // and /* */ comments with spaces (preserving offsets), skipping strings.
  let out = "";
  let inStr = false;
  let strCh = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inStr) {
      out += c;
      if (c === "\\") {
        out += next ?? "";
        i++;
      } else if (c === strCh) {
        inStr = false;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = true;
      strCh = c;
      out += c;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") {
        out += " ";
        i++;
      }
      if (i < text.length) out += "\n";
      continue;
    }
    if (c === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
        out += text[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += "  ";
      i++;
      continue;
    }
    out += c;
  }
  return out;
}

// ── Structural balance (CSS, and TS/JS fallback) ─────────────
function diagnoseBalanced(content: string): Diagnostic[] {
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  const opens = new Set(["(", "[", "{"]);
  const stack: Array<{ ch: string; line: number; col: number }> = [];
  let line = 1;
  let col = 1;
  let inStr: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;
  let inTemplate = false;

  const text = content;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    const advance = () => {
      if (c === "\n") {
        line++;
        col = 1;
      } else col++;
    };

    if (inLineComment) {
      if (c === "\n") inLineComment = false;
      advance();
      continue;
    }
    if (inBlockComment) {
      if (c === "*" && next === "/") {
        i++;
        col++;
        inBlockComment = false;
      }
      advance();
      continue;
    }
    if (inStr) {
      if (c === "\\") {
        i++;
        col += 2;
        continue;
      }
      if (c === inStr) inStr = null;
      advance();
      continue;
    }
    if (inTemplate) {
      if (c === "\\") {
        i++;
        col += 2;
        continue;
      }
      if (c === "`") inTemplate = false;
      advance();
      continue;
    }
    if (c === "/" && next === "/") {
      inLineComment = true;
      advance();
      continue;
    }
    if (c === "/" && next === "*") {
      inBlockComment = true;
      advance();
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      advance();
      continue;
    }
    if (c === "`") {
      inTemplate = true;
      advance();
      continue;
    }
    if (opens.has(c)) {
      stack.push({ ch: c, line, col });
    } else if (pairs[c]) {
      const top = stack.pop();
      if (!top) return [{ line, col, message: `Unexpected closing '${c}' — no matching '${pairs[c]}'.`, severity: "error" }];
      if (top.ch !== pairs[c]) {
        return [{ line, col, message: `Mismatched bracket: expected to close '${top.ch}' from line ${top.line}, found '${c}'.`, severity: "error" }];
      }
    }
    advance();
  }
  if (inStr) return [{ line, col, message: "Unterminated string literal.", severity: "error" }];
  if (inTemplate) return [{ line, col, message: "Unterminated template literal.", severity: "error" }];
  if (stack.length) {
    const top = stack[stack.length - 1];
    return [{ line: top.line, col: top.col, message: `Unclosed '${top.ch}' — missing matching '${closerFor(top.ch)}'.`, severity: "error" }];
  }
  return [];
}

function closerFor(open: string): string {
  return open === "(" ? ")" : open === "[" ? "]" : "}";
}

function offsetToLineCol(text: string, offset: number): { line: number; col: number } {
  let line = 1;
  let col = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") {
      line++;
      col = 1;
    } else col++;
  }
  return { line, col };
}

// ── Formatting for the tool result ───────────────────────────
const MAX_SHOWN = 8;

export function formatDiagnostics(relPath: string, diags: Diagnostic[], content: string): string {
  if (diags.length === 0) return "";
  const lines = content.split("\n");
  const shown = diags.slice(0, MAX_SHOWN);
  const body = shown
    .map((d) => {
      const src = lines[d.line - 1] ?? "";
      const frame = src.trim() ? `\n      ${src.trimEnd().slice(0, 120)}\n      ${" ".repeat(Math.max(0, Math.min(d.col - 1, 120) - leadingTrim(src)))}^` : "";
      return `  L${d.line}:${d.col}  ${d.message}${frame}`;
    })
    .join("\n");
  const more = diags.length > shown.length ? `\n  …and ${diags.length - shown.length} more.` : "";
  const count = `${diags.length} error${diags.length === 1 ? "" : "s"}`;
  return `\n\n⚠ Diagnostics — ${count} in ${relPath}:\n${body}${more}\nFix these now (re-Read the file if needed); don't move on with a broken file.`;
}

function leadingTrim(src: string): number {
  return src.length - src.trimStart().length;
}

/** Convenience: diagnose one file's content and return the formatted suffix
 *  (empty string when clean or not diagnosable). Never throws. */
export async function diagnosticsSuffix(absPath: string, relPath: string, content: string): Promise<string> {
  try {
    if (!isDiagnosable(absPath)) return "";
    const diags = await diagnoseFile(absPath, content);
    return formatDiagnostics(relPath, diags, content);
  } catch {
    return "";
  }
}
