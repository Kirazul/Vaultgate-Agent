// ============================================================
// In-process media generation (server-only).
//
// Vision / image-gen / image-edit / transcription all run through the GLOBAL
// models configured in Settings (Providers → capability roles), called directly
// over the provider's OpenAI-compatible HTTP API. This replaces the old
// `vaultgate <cmd>` CLI shim (which no longer exists) and the skills' attempts
// to `curl $OPENAI_API_KEY` from the shell (the key is intentionally stripped
// from agent shells). The API key is only ever read here, server-side.
//
// Every entry point first checks that a model is configured for its capability
// and, if not, returns a clear message and does NOTHING — so the agent never
// fires a broken request against an unconfigured provider.
// ============================================================
import "server-only";
import path from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { getCapabilityConfig } from "@/lib/config/settings";
import type { Capability } from "@/types";

export type MediaResult = { ok: true; text: string } | { ok: false; error: string };

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".gif": "image/gif", ".bmp": "image/bmp", ".svg": "image/svg+xml",
};
const AUDIO_MIME: Record<string, string> = {
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".mp4": "audio/mp4",
  ".webm": "audio/webm", ".ogg": "audio/ogg", ".flac": "audio/flac", ".aac": "audio/aac",
};

function mimeFor(file: string, table: Record<string, string>, fallback: string): string {
  return table[path.extname(file).toLowerCase()] ?? fallback;
}

function authHeaders(apiKey: string, json = true): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h["Content-Type"] = "application/json";
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
}

function endpointBase(endpoint: string): string {
  return endpoint.replace(/\/+$/, "");
}

/** Friendly "configure a model" guard shared by every entry point. */
async function requireModel(cap: Capability, label: string): Promise<{ endpoint: string; apiKey: string; model: string } | { error: string }> {
  const cfg = await getCapabilityConfig(cap);
  if (!cfg.endpoint || !cfg.model) {
    return { error: `No ${label} model is configured. Open Settings → Providers, add a provider, and assign a ${cap} model — then try again. (Nothing was sent.)` };
  }
  return { endpoint: cfg.endpoint, apiKey: cfg.apiKey, model: cfg.model };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function readErr(res: Response): Promise<string> {
  const body = await res.text().catch(() => "");
  let detail = body.slice(0, 400);
  try {
    const json = JSON.parse(body) as { error?: { message?: string } | string };
    detail = (typeof json.error === "string" ? json.error : json.error?.message) || detail;
  } catch {
    /* keep raw */
  }
  if (res.status === 401 || res.status === 403) return `the provider rejected the request (${res.status}). Check the API key/model in Settings.`;
  if (res.status === 404) return `the model/endpoint doesn't support this (${res.status}). Pick a capable model in Settings.`;
  return `${res.status} ${detail}`.trim();
}

// ── Image generation ─────────────────────────────────────────
export async function generateImages(opts: { prompt: string; outputPath: string; size?: string; count?: number; signal?: AbortSignal }): Promise<MediaResult> {
  const cfg = await requireModel("image", "image-generation");
  if ("error" in cfg) return { ok: false, error: cfg.error };

  const n = Math.max(1, Math.min(opts.count ?? 1, 4));
  const body: Record<string, unknown> = { model: cfg.model, prompt: opts.prompt, n };
  if (opts.size) body.size = opts.size;

  let res: Response;
  try {
    res = await fetchWithTimeout(`${endpointBase(cfg.endpoint)}/images/generations`, { method: "POST", headers: authHeaders(cfg.apiKey), body: JSON.stringify(body) }, 180_000, opts.signal);
  } catch (err) {
    return { ok: false, error: `image request failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!res.ok) return { ok: false, error: `Image generation failed — ${await readErr(res)}` };

  const json = (await res.json().catch(() => null)) as { data?: Array<{ b64_json?: string; url?: string }> } | null;
  const items = json?.data ?? [];
  if (items.length === 0) return { ok: false, error: "the provider returned no image data." };

  const saved: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const target = items.length === 1 ? opts.outputPath : numbered(opts.outputPath, i + 1);
    mkdirSync(path.dirname(target), { recursive: true });
    const item = items[i];
    if (item.b64_json) {
      writeFileSync(target, Buffer.from(item.b64_json, "base64"));
    } else if (item.url) {
      const dl = await fetch(item.url, { signal: opts.signal }).catch(() => null);
      if (!dl?.ok) return { ok: false, error: `could not download generated image from ${item.url}` };
      writeFileSync(target, Buffer.from(await dl.arrayBuffer()));
    } else {
      return { ok: false, error: "the provider returned an image with neither base64 data nor a URL." };
    }
    saved.push(target);
  }
  return { ok: true, text: `Generated ${saved.length} image${saved.length === 1 ? "" : "s"} with ${cfg.model}:\n${saved.map((s) => `- ${s}`).join("\n")}` };
}

function numbered(p: string, i: number): string {
  const ext = path.extname(p);
  return `${p.slice(0, p.length - ext.length)}-${i}${ext}`;
}

// ── Image edit ───────────────────────────────────────────────
export async function editImage(opts: { prompt: string; inputPath: string; outputPath: string; size?: string; signal?: AbortSignal }): Promise<MediaResult> {
  const cfg = await requireModel("image", "image-editing");
  if ("error" in cfg) return { ok: false, error: cfg.error };
  if (!existsSync(opts.inputPath)) return { ok: false, error: `input image not found: ${opts.inputPath}` };

  const form = new FormData();
  form.append("model", cfg.model);
  form.append("prompt", opts.prompt);
  if (opts.size) form.append("size", opts.size);
  const buf = readFileSync(opts.inputPath);
  form.append("image", new Blob([new Uint8Array(buf)], { type: mimeFor(opts.inputPath, IMAGE_MIME, "image/png") }), path.basename(opts.inputPath));

  let res: Response;
  try {
    res = await fetchWithTimeout(`${endpointBase(cfg.endpoint)}/images/edits`, { method: "POST", headers: authHeaders(cfg.apiKey, false), body: form }, 180_000, opts.signal);
  } catch (err) {
    return { ok: false, error: `image-edit request failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!res.ok) return { ok: false, error: `Image edit failed — ${await readErr(res)}` };

  const json = (await res.json().catch(() => null)) as { data?: Array<{ b64_json?: string; url?: string }> } | null;
  const item = json?.data?.[0];
  if (!item) return { ok: false, error: "the provider returned no edited image." };
  mkdirSync(path.dirname(opts.outputPath), { recursive: true });
  if (item.b64_json) writeFileSync(opts.outputPath, Buffer.from(item.b64_json, "base64"));
  else if (item.url) {
    const dl = await fetch(item.url, { signal: opts.signal }).catch(() => null);
    if (!dl?.ok) return { ok: false, error: `could not download edited image from ${item.url}` };
    writeFileSync(opts.outputPath, Buffer.from(await dl.arrayBuffer()));
  } else return { ok: false, error: "the provider returned an edited image with neither base64 nor URL." };
  return { ok: true, text: `Edited image saved to ${opts.outputPath} (model: ${cfg.model}).` };
}

// ── Vision (describe images) ─────────────────────────────────
export async function describeImages(opts: { prompt: string; images: string[]; signal?: AbortSignal }): Promise<MediaResult> {
  const cfg = await requireModel("vision", "vision");
  if ("error" in cfg) return { ok: false, error: cfg.error };

  const content: Array<Record<string, unknown>> = [{ type: "text", text: opts.prompt }];
  for (const img of opts.images) {
    const url = /^https?:\/\//i.test(img) ? img : await toDataUrl(img);
    if (!url) return { ok: false, error: `image not found or unreadable: ${img}` };
    content.push({ type: "image_url", image_url: { url } });
  }

  let res: Response;
  try {
    res = await fetchWithTimeout(`${endpointBase(cfg.endpoint)}/chat/completions`, {
      method: "POST",
      headers: authHeaders(cfg.apiKey),
      body: JSON.stringify({ model: cfg.model, messages: [{ role: "user", content }] }),
    }, 120_000, opts.signal);
  } catch (err) {
    return { ok: false, error: `vision request failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!res.ok) return { ok: false, error: `Vision failed — ${await readErr(res)}` };

  const json = (await res.json().catch(() => null)) as { choices?: Array<{ message?: { content?: string } }> } | null;
  const text = json?.choices?.[0]?.message?.content?.trim();
  if (!text) return { ok: false, error: "the vision model returned an empty description." };
  return { ok: true, text };
}

async function toDataUrl(file: string): Promise<string | null> {
  if (!existsSync(file)) return null;
  try {
    const buf = readFileSync(file);
    return `data:${mimeFor(file, IMAGE_MIME, "image/png")};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

// ── Transcription (speech → text) ────────────────────────────
export async function transcribeAudio(opts: { inputPath: string; language?: string; model?: string; signal?: AbortSignal }): Promise<MediaResult> {
  // No dedicated transcription role exists; use the global (chat) provider's
  // endpoint/key with a transcription model. Gate on a configured provider.
  const cfg = await getCapabilityConfig("chat");
  if (!cfg.endpoint) {
    return { ok: false, error: "No provider is configured. Open Settings → Providers and add one with an audio-transcription model, then try again. (Nothing was sent.)" };
  }
  if (!existsSync(opts.inputPath)) return { ok: false, error: `audio file not found: ${opts.inputPath}` };

  const model = opts.model || "whisper-1";
  const form = new FormData();
  form.append("model", model);
  if (opts.language) form.append("language", opts.language);
  const buf = readFileSync(opts.inputPath);
  form.append("file", new Blob([new Uint8Array(buf)], { type: mimeFor(opts.inputPath, AUDIO_MIME, "application/octet-stream") }), path.basename(opts.inputPath));

  let res: Response;
  try {
    res = await fetchWithTimeout(`${endpointBase(cfg.endpoint)}/audio/transcriptions`, { method: "POST", headers: authHeaders(cfg.apiKey, false), body: form }, 300_000, opts.signal);
  } catch (err) {
    return { ok: false, error: `transcription request failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!res.ok) return { ok: false, error: `Transcription failed — ${await readErr(res)}` };

  const json = (await res.json().catch(() => null)) as { text?: string } | null;
  const text = json?.text?.trim();
  if (!text) return { ok: false, error: "the model returned an empty transcript." };
  return { ok: true, text };
}
