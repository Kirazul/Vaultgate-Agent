import type { NextRequest } from "next/server";
import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { ensureWorkspace, resolvedRoot } from "@/lib/runtime/workspace";
import { resolveWorkspacePath, workspaceMetaRoot } from "@/lib/runtime/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeName(value: string): string {
  const base = path
    .basename(value || "upload.bin")
    .split("")
    .map((char) => (char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? "_" : char))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return base.slice(0, 180) || "upload.bin";
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const chatId = String(form.get("chatId") || request.nextUrl.searchParams.get("chatId") || "");
  if (!chatId) return Response.json({ error: "chatId required" }, { status: 400 });

  const files = form.getAll("files").filter((item): item is File => typeof item === "object" && item !== null && "arrayBuffer" in item && "name" in item);
  if (files.length === 0) return Response.json({ error: "No files uploaded" }, { status: 400 });

  await ensureWorkspace(chatId);
  const root = resolvedRoot(chatId);
  const metaRoot = workspaceMetaRoot(chatId);
  const folder = `.vaultgate/upload/${stamp()}`;
  const outDir = resolveWorkspacePath(folder, root, metaRoot);
  mkdirSync(outDir, { recursive: true });

  const uploaded = [];
  for (const file of files) {
    const name = safeName(file.name);
    const rel = `${folder}/${name}`;
    const full = resolveWorkspacePath(rel, root, metaRoot);
    writeFileSync(full, Buffer.from(await file.arrayBuffer()));
    uploaded.push({ name, path: rel, size: file.size, type: file.type || undefined });
  }

  return Response.json({ uploaded });
}
