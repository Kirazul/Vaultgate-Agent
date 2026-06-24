export interface WorkspaceFileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: WorkspaceFileNode[];
  size?: number;
}

export interface FileMentionSuggestion {
  path: string;
  name: string;
  type: "file" | "directory";
  size?: number;
}

interface ParsedPathRef {
  raw: string;
  path: string;
  lineStart?: number;
  lineEnd?: number;
  source: "mention" | "path";
}

const MAX_FILE_CHARS = 12000;
const MAX_TOTAL_CHARS = 45000;
const MAX_DIR_ENTRIES = 300;

export function activeSlashToken(value: string, cursor: number): { start: number; end: number; query: string } | null {
  const before = value.slice(0, cursor);
  const match = before.match(/(?:^|\s)\/([A-Za-z0-9_-]*)$/);
  if (!match || match.index === undefined) return null;
  const slashOffset = match[0].lastIndexOf("/");
  const start = match.index + slashOffset;
  return { start, end: cursor, query: match[1] ?? "" };
}

export function activeFileMentionToken(value: string, cursor: number): { start: number; end: number; query: string; quoted: boolean } | null {
  const before = value.slice(0, cursor);
  const quoted = before.match(/(?:^|\s)@"([^"]*)$/);
  if (quoted?.index !== undefined) {
    const atOffset = quoted[0].lastIndexOf('@"');
    return { start: quoted.index + atOffset, end: cursor, query: quoted[1] ?? "", quoted: true };
  }
  const regular = before.match(/(?:^|\s)@([^\s"]*)$/);
  if (!regular || regular.index === undefined) return null;
  const atOffset = regular[0].lastIndexOf("@");
  return { start: regular.index + atOffset, end: cursor, query: regular[1] ?? "", quoted: false };
}

export async function fetchWorkspaceTree(chatId: string): Promise<WorkspaceFileNode[]> {
  const res = await fetch(`/api/workspace/files/tree?chatId=${encodeURIComponent(chatId)}&recursive=1&purpose=mentions`, { cache: "no-store" });
  if (!res.ok) return [];
  const data = (await res.json()) as { tree?: WorkspaceFileNode[] };
  return data.tree ?? [];
}

export function flattenWorkspaceTree(nodes: WorkspaceFileNode[]): FileMentionSuggestion[] {
  const out: FileMentionSuggestion[] = [];
  const visit = (node: WorkspaceFileNode) => {
    out.push({ path: node.path, name: node.name, type: node.type, size: node.size });
    for (const child of node.children ?? []) visit(child);
  };
  for (const node of nodes) visit(node);
  return out;
}

export function fileMentionSuggestions(query: string, files: FileMentionSuggestion[], limit = 12): FileMentionSuggestion[] {
  const q = normalizePath(query.replace(/^@/, "").replace(/^"|"$/g, ""));
  const scored = files
    .map((file, index) => ({ file, index, score: fileScore(file, q) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.file.path.length - b.file.path.length || a.index - b.index);
  return scored.slice(0, limit).map((item) => item.file);
}

export function insertedFileMention(path: string): string {
  return /\s/.test(path) ? `@"${path}" ` : `@${path} `;
}

export async function expandWorkspaceReferences(chatId: string, input: string): Promise<string> {
  const refs = extractPathReferences(input);
  if (refs.length === 0) return input;

  const tree = await fetchWorkspaceTree(chatId);
  const files = flattenWorkspaceTree(tree);
  if (files.length === 0) return input;

  const resolved = uniqueRefs(refs)
    .map((ref) => ({ ref, node: resolveRef(ref.path, files) }))
    .filter((item): item is { ref: ParsedPathRef; node: FileMentionSuggestion } => Boolean(item.node));
  if (resolved.length === 0) return input;

  let total = 0;
  const blocks: string[] = [];
  for (const { ref, node } of resolved.slice(0, 12)) {
    if (total >= MAX_TOTAL_CHARS) break;
    if (node.type === "directory") {
      const listing = directoryListing(node.path, tree);
      const body = listing.slice(0, MAX_DIR_ENTRIES).map((entry) => `- ${entry}`).join("\n");
      const truncated = listing.length > MAX_DIR_ENTRIES ? `\n- ... ${listing.length - MAX_DIR_ENTRIES} more entries` : "";
      const block = `Path: ${node.path}/\nType: directory\nContents:\n${body}${truncated}`;
      total += block.length;
      blocks.push(block);
      continue;
    }

    try {
      const res = await fetch(`/api/workspace/files/read?chatId=${encodeURIComponent(chatId)}&path=${encodeURIComponent(node.path)}`, { cache: "no-store" });
      const data = (await res.json()) as { content?: string; error?: string };
      if (!res.ok || typeof data.content !== "string") {
        blocks.push(`Path: ${node.path}\nType: file\nNote: ${data.error || "Could not read this file as text."}`);
        continue;
      }
      const selected = selectLines(data.content, ref.lineStart, ref.lineEnd);
      const room = Math.max(0, MAX_TOTAL_CHARS - total);
      const clipped = clipText(selected.content, Math.min(MAX_FILE_CHARS, room));
      const range = selected.label ? `\nRange: ${selected.label}` : "";
      const truncated = clipped.length < selected.content.length ? "\n[truncated]" : "";
      const block = `Path: ${node.path}\nType: file${range}\nContent:\n\`\`\`\n${clipped}\n\`\`\`${truncated}`;
      total += block.length;
      blocks.push(block);
    } catch {
      blocks.push(`Path: ${node.path}\nType: file\nNote: Could not read this file as text.`);
    }
  }

  if (blocks.length === 0) return input;
  return `${input.trim()}\n\nReferenced workspace context:\n${blocks.map((block) => `---\n${block}`).join("\n")}`;
}

function extractPathReferences(input: string): ParsedPathRef[] {
  const refs: ParsedPathRef[] = [];
  const quotedAt = /(^|\s)@"([^"]+)"/g;
  const regularAt = /(^|\s)@([^\s"`]+)\b/g;
  const backtickedPath = /`([^`]+)`/g;
  let match: RegExpExecArray | null;

  while ((match = quotedAt.exec(input))) refs.push(parsePathRef(match[2] || "", "mention"));
  while ((match = regularAt.exec(input))) {
    const raw = match[2] || "";
    if (!raw.startsWith('"')) refs.push(parsePathRef(raw, "mention"));
  }
  while ((match = backtickedPath.exec(input))) {
    const raw = match[1] || "";
    if (looksLikePath(raw)) refs.push(parsePathRef(raw, "path"));
  }

  const naked = input.match(/(?:^|\s)((?:\.?\.?\/|[A-Za-z0-9_.-]+\/)[^\s,;]+)/g) ?? [];
  for (const item of naked) {
    const raw = item.trim().replace(/[.)\]]+$/, "");
    if (looksLikePath(raw)) refs.push(parsePathRef(raw, "path"));
  }

  return refs.filter((ref) => ref.path && !/^https?:\/\//i.test(ref.path));
}

function parsePathRef(raw: string, source: ParsedPathRef["source"]): ParsedPathRef {
  const cleaned = raw.trim().replace(/^workspace-file:/, "");
  const decoded = safeDecode(cleaned);
  const match = decoded.match(/^([^#]+)(?:#L(\d+)(?:-(\d+))?)?(?:#[^#]*)?$/i);
  if (!match) return { raw, path: normalizePath(decoded), source };
  const lineStart = match[2] ? Number(match[2]) : undefined;
  const lineEnd = match[3] ? Number(match[3]) : lineStart;
  return { raw, path: normalizePath(match[1] || decoded), lineStart, lineEnd, source };
}

function uniqueRefs(refs: ParsedPathRef[]): ParsedPathRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.path}:${ref.lineStart ?? ""}:${ref.lineEnd ?? ""}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolveRef(path: string, files: FileMentionSuggestion[]): FileMentionSuggestion | null {
  const target = normalizePath(path).replace(/^\.\//, "").replace(/^\/+/, "");
  const lower = target.toLowerCase();
  return (
    files.find((file) => file.path === target) ??
    files.find((file) => file.path.toLowerCase() === lower) ??
    files.find((file) => file.path.endsWith(`/${target}`)) ??
    files.find((file) => file.name.toLowerCase() === lower) ??
    null
  );
}

function directoryListing(path: string, tree: WorkspaceFileNode[]): string[] {
  const root = findNode(path, tree);
  if (!root) return [];
  const out: string[] = [];
  const visit = (node: WorkspaceFileNode) => {
    for (const child of node.children ?? []) {
      out.push(`${child.type === "directory" ? "dir " : "file"} ${child.path}${child.type === "directory" ? "/" : ""}`);
      if (out.length >= MAX_DIR_ENTRIES) return;
      if (child.type === "directory") visit(child);
    }
  };
  visit(root);
  return out;
}

function findNode(path: string, nodes: WorkspaceFileNode[]): WorkspaceFileNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    const found = node.children ? findNode(path, node.children) : null;
    if (found) return found;
  }
  return null;
}

function selectLines(content: string, start?: number, end?: number): { content: string; label?: string } {
  if (!start) return { content };
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const from = Math.max(1, start);
  const to = Math.max(from, Math.min(end ?? from, lines.length));
  return { content: lines.slice(from - 1, to).join("\n"), label: `L${from}${to !== from ? `-L${to}` : ""}` };
}

function clipText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  if (limit <= 2000) return text.slice(0, limit);
  const head = text.slice(0, Math.floor(limit * 0.7));
  const tail = text.slice(text.length - Math.floor(limit * 0.25));
  return `${head}\n\n... clipped ${text.length - head.length - tail.length} chars ...\n\n${tail}`;
}

function fileScore(file: FileMentionSuggestion, query: string): number {
  if (!query) return file.type === "directory" ? 8 : 6;
  const path = normalizePath(file.path).toLowerCase();
  const name = file.name.toLowerCase();
  if (path === query) return 100;
  if (name === query) return 92;
  if (path.startsWith(query)) return 80;
  if (name.startsWith(query)) return 70;
  if (path.includes(query)) return 45;
  if (fuzzyIncludes(path, query)) return 20;
  return 0;
}

function fuzzyIncludes(value: string, query: string): boolean {
  let i = 0;
  for (const char of value) {
    if (char === query[i]) i++;
    if (i === query.length) return true;
  }
  return false;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "").trim();
}

function looksLikePath(value: string): boolean {
  if (/^https?:\/\//i.test(value)) return false;
  return value.includes("/") || value.includes("\\") || /\.[A-Za-z0-9]{1,8}(?:#L\d+(?:-\d+)?)?$/.test(value);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
