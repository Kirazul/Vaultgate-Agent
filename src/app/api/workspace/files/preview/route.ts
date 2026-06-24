import type { NextRequest } from "next/server";
import JSZip from "jszip";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { readWorkspaceFileBuffer } from "@/lib/runtime/files";
import { resolveWorkspaceRoot } from "@/lib/runtime/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXECUTABLE_EXTENSIONS = new Set(["exe", "msi", "com", "scr", "dll", "so", "dylib", "app", "dmg", "pkg", "deb", "rpm", "bin"]);

function extOf(filePath: string): string {
  return filePath.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase() || "";
}

function decodeXml(value: string): string {
  return value
    .replace(/<a:br\s*\/?\s*>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function xmlTextRuns(xml: string): string[] {
  const runs: string[] = [];
  const re = /<(?:a|w):t[^>]*>([\s\S]*?)<\/(?:a|w):t>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) {
    const text = decodeXml(match[1] || "");
    if (text) runs.push(text);
  }
  return runs;
}

async function previewPptx(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)/i)?.[1] || 0) - Number(b.match(/slide(\d+)/i)?.[1] || 0));
  const slides = [];
  for (const file of slideFiles.slice(0, 80)) {
    const xml = await zip.file(file)?.async("string");
    const title = file.split("/").pop()?.replace(/\.xml$/i, "") || "slide";
    slides.push({ title, lines: xml ? xmlTextRuns(xml).slice(0, 80) : [] });
  }
  return { kind: "presentation", slides, truncated: slideFiles.length > slides.length };
}

async function previewZip(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => ({ name: entry.name, size: null }))
    .slice(0, 300);
  return { kind: "archive", entries, truncated: Object.keys(zip.files).length > entries.length };
}

function previewWorkbook(buffer: Buffer, ext: string) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, dense: false });
  const sheets = workbook.SheetNames.slice(0, 20).map((name) => {
    const rows = XLSX.utils.sheet_to_json<Array<string | number | boolean | Date | null>>(workbook.Sheets[name], { header: 1, defval: "", blankrows: false }).slice(0, 200);
    return { name, rows };
  });
  return { kind: ext === "csv" ? "table" : "spreadsheet", sheets, truncated: workbook.SheetNames.length > sheets.length };
}

async function previewDocx(buffer: Buffer) {
  const extracted = await mammoth.extractRawText({ buffer });
  const text = extracted.value.replace(/\n{3,}/g, "\n\n").trim();
  return { kind: "document", text, messages: extracted.messages?.map((message) => message.message).filter(Boolean) ?? [] };
}

function binaryInfo(filePath: string, buffer: Buffer, reason?: string) {
  return { kind: "binary", name: filePath.split(/[\\/]/).pop() || filePath, size: buffer.length, reason: reason || "No safe renderer is available for this binary file." };
}

export async function GET(request: NextRequest) {
  const chatId = request.nextUrl.searchParams.get("chatId");
  const filePath = request.nextUrl.searchParams.get("filePath") || request.nextUrl.searchParams.get("path");
  if (!chatId || !filePath) return Response.json({ error: "chatId and filePath required" }, { status: 400 });

  try {
    await resolveWorkspaceRoot(chatId);
    const buffer = readWorkspaceFileBuffer(chatId, filePath);
    const ext = extOf(filePath);
    if (EXECUTABLE_EXTENSIONS.has(ext)) return Response.json(binaryInfo(filePath, buffer, "Executable files are intentionally not rendered."));
    if (ext === "docx") return Response.json(await previewDocx(buffer));
    if (ext === "xlsx" || ext === "xls" || ext === "csv") return Response.json(previewWorkbook(buffer, ext));
    if (ext === "pptx") return Response.json(await previewPptx(buffer));
    if (ext === "zip" || ext === "jar" || ext === "epub") return Response.json(await previewZip(buffer));
    if (ext === "doc" || ext === "ppt") return Response.json(binaryInfo(filePath, buffer, "Legacy Office binary files cannot be safely rendered here. Convert to .docx/.pptx or PDF for a full preview."));
    return Response.json(binaryInfo(filePath, buffer));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "preview failed" }, { status: 404 });
  }
}
