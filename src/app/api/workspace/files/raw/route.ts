import type { NextRequest } from "next/server";
import { readWorkspaceFileBuffer } from "@/lib/runtime/files";
import { resolveWorkspaceRoot } from "@/lib/runtime/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  json: "application/json",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  html: "text/html; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  excalidraw: "application/json; charset=utf-8",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  doc: "application/msword",
  ppt: "application/vnd.ms-powerpoint",
  xls: "application/vnd.ms-excel",
};

export async function GET(request: NextRequest) {
  const chatId = request.nextUrl.searchParams.get("chatId");
  const filePath = request.nextUrl.searchParams.get("filePath") || request.nextUrl.searchParams.get("path");
  if (!chatId || !filePath) return new Response("chatId and filePath required", { status: 400 });
  try {
    await resolveWorkspaceRoot(chatId);
    const buf = readWorkspaceFileBuffer(chatId, filePath);
    const ext = filePath.split(".").pop()?.toLowerCase() || "";
    return new Response(new Uint8Array(buf), {
      headers: { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "no-store" },
    });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "read failed", { status: 404 });
  }
}
