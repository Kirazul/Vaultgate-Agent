"use client";
import { Fragment, type ReactNode } from "react";

// Lightweight, language-agnostic highlighter. One regex pass per line — fast
// enough to run on streaming previews without re-introducing render lag (a full
// tokenizer/shiki would). Covers comments, strings, numbers, and common keywords
// across JS/TS/Python/Rust/Go/etc.
const TOKEN =
  /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(0x[0-9a-fA-F]+|\d[\d_.]*)\b|\b(const|let|var|function|fn|def|func|return|if|else|elif|for|while|do|switch|case|break|continue|import|export|from|as|default|class|extends|implements|interface|type|enum|struct|impl|trait|new|await|async|yield|throw|try|catch|finally|in|of|public|private|protected|static|readonly|void|true|false|null|undefined|None|True|False|self|this|super|pub|use|mod|match|package|namespace)\b/g;

function classFor(comment?: string, str?: string, num?: string): string {
  if (comment) return "text-zinc-500 italic";
  if (str) return "text-amber-300";
  if (num) return "text-sky-300";
  return "text-violet-300"; // keyword
}

/** Render one line of code as syntax-highlighted inline nodes. */
export function HiLine({ code }: { code: string }): ReactNode {
  if (!code) return null;
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(code)) !== null) {
    if (m.index > last) nodes.push(<Fragment key={`t${last}`}>{code.slice(last, m.index)}</Fragment>);
    const [full, comment, str, num] = m;
    nodes.push(
      <span key={m.index} className={classFor(comment, str, num)}>
        {full}
      </span>,
    );
    last = m.index + full.length;
    if (full.length === 0) TOKEN.lastIndex++; // guard against zero-width matches
  }
  if (last < code.length) nodes.push(<Fragment key={`t${last}`}>{code.slice(last)}</Fragment>);
  return <>{nodes}</>;
}

/** Multi-line highlighted code block, with an optional trailing streaming caret. */
export function HighlightedCode({ code, cursor, className }: { code: string; cursor?: boolean; className?: string }) {
  const lines = code.split("\n");
  return (
    <pre className={className}>
      {lines.map((line, i) => (
        <div key={i} className="whitespace-pre-wrap break-words">
          {line ? <HiLine code={line} /> : " "}
          {cursor && i === lines.length - 1 && <span className="streaming-cursor" />}
        </div>
      ))}
    </pre>
  );
}
