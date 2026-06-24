import type { NextRequest } from "next/server";
import { MENTION_TREE_IGNORE, lsTree } from "@/lib/runtime/files";
import { resolveWorkspaceRoot } from "@/lib/runtime/workspace";
import { defaultWorkspaceRoot } from "@/lib/runtime/paths";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const chatId = request.nextUrl.searchParams.get("chatId");
  if (!chatId) return Response.json({ error: "chatId required" }, { status: 400 });
  try {
    const rootDir = await resolveWorkspaceRoot(chatId);
    const subPath = request.nextUrl.searchParams.get("path") || undefined;
    const recursive = request.nextUrl.searchParams.get("recursive") === "1";
    const purpose = request.nextUrl.searchParams.get("purpose");
    return Response.json({
      tree: lsTree(chatId, subPath, {
        recursive,
        maxNodes: recursive ? 2500 : 10000,
        ignoreNames: purpose === "mentions" ? MENTION_TREE_IGNORE : undefined,
      }),
      rootDir,
      rootName: samePath(rootDir, defaultWorkspaceRoot()) ? "Home" : path.basename(rootDir) || rootDir,
    });
  } catch (err) {
    return Response.json({ tree: [], error: err instanceof Error ? err.message : "error" }, { status: 400 });
  }
}

function samePath(a: string, b: string): boolean {
  const left = path.resolve(/* turbopackIgnore: true */ a);
  const right = path.resolve(/* turbopackIgnore: true */ b);
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}
