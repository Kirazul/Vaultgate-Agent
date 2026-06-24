// Workspace file operations (server-only). All paths traversal-guarded.
import "server-only";
import path from "node:path";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolveWorkspacePath, workspaceMetaRoot } from "./paths";
import { resolvedRoot } from "./resolved-roots";

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
  size?: number;
}

export const MENTION_TREE_IGNORE = new Set([
  ".data",
  "node_modules",
  ".next",
  ".git",
  ".turbo",
  ".cache",
  ".venv",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  "__pycache__",
  "dist",
  "build",
  "out",
  "skills",
  "bin",
  "AppData",
  "Application Data",
  "Local Settings",
  "Cookies",
  "Recent",
  "SendTo",
]);

const MAX_TREE_DEPTH = 6;
const MAX_TREE_NODES = 10000;

interface LsTreeOptions {
  recursive?: boolean;
  maxDepth?: number;
  maxNodes?: number;
  ignoreNames?: ReadonlySet<string>;
}

export function lsTree(chatId: string, sub?: string, options: LsTreeOptions = {}): FileNode[] {
  const root = resolvedRoot(chatId);
  if (!existsSync(root)) return [];
  const target = sub ? resolveWorkspacePath(sub, root, workspaceMetaRoot(chatId)) : root;
  const maxDepth = options.recursive ? options.maxDepth ?? MAX_TREE_DEPTH : 0;
  return buildTree(target, root, 0, {
    count: 0,
    maxDepth,
    maxNodes: options.maxNodes ?? MAX_TREE_NODES,
    ignoreNames: options.ignoreNames,
  });
}

function buildTree(dir: string, root: string, depth: number, state: { count: number; maxDepth: number; maxNodes: number; ignoreNames?: ReadonlySet<string> }): FileNode[] {
  if (depth > state.maxDepth || state.count >= state.maxNodes) return [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const nodes: FileNode[] = [];
  const sorted = entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const entry of sorted) {
    if (state.count >= state.maxNodes) break;
    if (entry.isSymbolicLink()) continue;
    if (state.ignoreNames?.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).replace(/\\/g, "/");
    state.count++;
    if (entry.isDirectory()) {
      const node: FileNode = { name: entry.name, path: rel, type: "directory" };
      if (depth < state.maxDepth) node.children = buildTree(full, root, depth + 1, state);
      nodes.push(node);
    } else {
      let size: number | undefined;
      try {
        size = statSync(full).size;
      } catch {
        /* ignore */
      }
      nodes.push({ name: entry.name, path: rel, type: "file", size });
    }
  }
  return nodes;
}

export function readWorkspaceFile(chatId: string, filePath: string): string {
  const resolved = resolveWorkspacePath(filePath, resolvedRoot(chatId), workspaceMetaRoot(chatId));
  if (!existsSync(resolved)) throw new Error(`File not found: ${filePath}`);
  return readFileSync(resolved, "utf-8");
}

export function readWorkspaceFileBuffer(chatId: string, filePath: string): Buffer {
  const resolved = resolveWorkspacePath(filePath, resolvedRoot(chatId), workspaceMetaRoot(chatId));
  if (!existsSync(resolved)) throw new Error(`File not found: ${filePath}`);
  return readFileSync(resolved);
}

export function writeWorkspaceFile(chatId: string, filePath: string, content: string): void {
  const resolved = resolveWorkspacePath(filePath, resolvedRoot(chatId), workspaceMetaRoot(chatId));
  mkdirSync(path.dirname(resolved), { recursive: true });
  writeFileSync(resolved, content, "utf-8");
}
