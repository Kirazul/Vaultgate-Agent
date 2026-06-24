// ============================================================
// Tool execution (server-only). Dispatches a canonical tool to
// its implementation against the chat's workspace.
// ============================================================
import "server-only";
import type { AgentParams, ApprovalSettings } from "@/types";
import { execFileSync, spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { canonicalToolName, toolNeedsWorkspace } from "./definitions";
import { ensureWorkspace } from "@/lib/runtime/workspace";
import { resolvedRoot } from "@/lib/runtime/resolved-roots";
import { workspaceExecute } from "@/lib/runtime/exec";
import { startBackgroundCommand, readBackgroundOutput, killBackgroundCommand } from "@/lib/runtime/background";
import { resolveWorkspacePath, workspaceMetaPath, workspaceMetaRoot } from "@/lib/runtime/paths";
import { loadSkill } from "@/lib/runtime/skills";
import { listManagedProcesses } from "@/lib/runtime/process-registry";
import { readRuntimeStatus } from "@/lib/runtime/execution-runtime";
import { getDataDir } from "@/lib/config/env";
import { commentCard, createCard, deleteCard, formatBoard, formatCard, getCard, linkCard, listCards, updateCard } from "@/lib/runtime/kanban";
import { cancelJob, createJob, formatJob, listJobs, resumeSchedulerIfNeeded } from "@/lib/runtime/schedule";
import { listChatSummaries, readChat, searchMessages } from "@/lib/db/repo";
import { getChatProvider } from "@/lib/config/settings";
import { describeImages, editImage, generateImages, transcribeAudio } from "@/lib/ai/media";
import { diagnosticsSuffix } from "@/lib/ai/diagnostics";
import { hardBlockedCommand } from "@/lib/ai/permissions";

export interface ToolContext {
  chatId: string;
  signal?: AbortSignal;
  onOutput?: (chunk: string) => void;
  toolCallId?: string;
  approval?: ApprovalSettings;
  agentParams?: AgentParams;
}

const todoStore = new Map<string, unknown[]>();

// ── File read tracking ────────────────────────────────────────
// Tracks per-chat mtime of files at last read. Edit/Write warn if
// the file changed externally (race with user or other process).
const readTimestamps = new Map<string, Map<string, number>>();

function trackFileRead(chatId: string, filepath: string): void {
  try {
    const mtime = statSync(filepath).mtimeMs;
    let chat = readTimestamps.get(chatId);
    if (!chat) { chat = new Map(); readTimestamps.set(chatId, chat); }
    chat.set(filepath, mtime);
  } catch { /* file may not exist yet */ }
}

function checkFileStaleness(chatId: string, filepath: string): string | null {
  const chat = readTimestamps.get(chatId);
  if (!chat) return null;
  const lastRead = chat.get(filepath);
  if (lastRead === undefined) return null;
  try {
    const currentMtime = statSync(filepath).mtimeMs;
    if (currentMtime > lastRead + 500) {
      return `Warning: ${path.basename(filepath)} was modified externally since your last read (${new Date(lastRead).toLocaleTimeString()} → ${new Date(currentMtime).toLocaleTimeString()}). Re-read the file first to avoid overwriting changes.`;
    }
  } catch { /* file deleted externally */ }
  return null;
}

// ── Dangerous command detection ───────────────────────────────
const DANGEROUS_PATTERNS = [
  { pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f|rm\s+-[a-zA-Z]*f[a-zA-Z]*r/i, label: "recursive force delete" },
  { pattern: /\bgit\s+(?:reset\s+--hard|push\s+--force|clean\s+-[a-zA-Z]*f)/i, label: "destructive git operation" },
  { pattern: /\bdrop\s+(?:table|database|schema)\b/i, label: "database drop" },
  { pattern: />\s*\/dev\/sd[a-z]|dd\s+if=.*of=\/dev/i, label: "raw disk write" },
  { pattern: /\bchmod\s+-R\s+777\b/i, label: "recursive world-writable permissions" },
  { pattern: /\bkill\s+-9\s+-1\b/i, label: "kill all processes" },
  { pattern: /Remove-Item\s+.*-Recurse\s+.*-Force.*\$env:(?:USERPROFILE|SYSTEMROOT|SystemDrive)/i, label: "recursive delete of system directory" },
];

function detectDangerousCommand(command: string): string | null {
  for (const { pattern, label } of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) return label;
  }
  return null;
}

// ── Tool-output limits ────────────────────────────────────────
// Keep the model's context lean on long tasks: a single huge read or
// command must not flood the window. The terminal panel still streams full
// output; only the model-facing text is bounded.
// (The Terminal panel still streams full output via onOutput; only the
// text fed back to the model is bounded.)
const MAX_READ_LINES = 2000;
const MAX_LINE_LENGTH = 2000;
const MAX_TOOL_OUTPUT_CHARS = 50000;

function clampLine(line: string): string {
  return line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)} … [line truncated, ${line.length} chars]` : line;
}

function clampOutput(text: string, max = MAX_TOOL_OUTPUT_CHARS): string {
  if (text.length <= max) return text;
  const head = text.slice(0, Math.floor(max * 0.6));
  const tail = text.slice(text.length - Math.floor(max * 0.3));
  return `${head}\n\n… [output truncated — ${text.length} chars total; showing the first and last parts. Narrow the command or read a specific range for more.] …\n\n${tail}`;
}

export async function executeTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const tool = canonicalToolName(name);
  if (toolNeedsWorkspace(tool, args)) await ensureWorkspace(ctx.chatId);

  try {
    switch (tool) {
      case "Bash":
        return await runBash(args, ctx);
      case "Open":
        return await runOpen(args, ctx.chatId, ctx.signal);
      case "Desktop":
        return runDesktop(args, ctx.chatId);
      case "BashOutput":
        return await runBashOutput(args, ctx.chatId);
      case "ListProcesses":
        return runListProcesses(ctx.chatId);
      case "Read":
        return runRead(args, ctx.chatId);
      case "Write":
        return await runWrite(args, ctx.chatId);
      case "Edit":
        return await runEdit(args, ctx.chatId);
      case "MultiEdit":
        return await runMultiEdit(args, ctx.chatId);
      case "ApplyPatch":
        return await runApplyPatch(args, ctx.chatId);
      case "Delete":
        return runDelete(args, ctx.chatId);
      case "Move":
        return runMove(args, ctx.chatId);
      case "Glob":
        return runGlob(args, ctx.chatId);
      case "Grep":
        return runGrep(args, ctx.chatId);
      case "LS":
        return runLs(args, ctx.chatId);
      case "WebSearch":
        return await runWebSearch(args, ctx.signal);
      case "WebFetch":
        return await runWebFetch(args, ctx.signal);
      case "TodoWrite":
        return runTodoWrite(args, ctx.chatId);
      case "Skill":
        return loadSkill(String(args.command || ""), ctx.chatId);
      case "Task":
        return await runTask(args, ctx);
      case "Kanban":
        return runKanban(args, ctx.chatId);
      case "RecallSessions":
        return await runRecallSessions(args, ctx.chatId);
      case "MultiModel":
        return await runMultiModel(args, ctx.signal);
      case "Schedule":
        return runSchedule(args, ctx.chatId);
      case "XSearch":
        return await runXSearch(args, ctx.signal);
      case "Plan":
        return runPlan(args, ctx.chatId);
      case "AskUserQuestion":
        return runAskUserQuestion(args);
      case "Vision":
        return await runVision(args, ctx);
      case "ImageGenerate":
        return await runImageGenerate(args, ctx);
      case "ImageEdit":
        return await runImageEdit(args, ctx);
      case "Transcribe":
        return await runTranscribe(args, ctx);
      default:
        return `Error: Unknown tool '${name}'`;
    }
  } catch (err) {
    return `Error executing ${tool}: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function looksLikeLongRunningServer(command: string): boolean {
  const normalized = command.replace(/`[^`]*`/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return false;

  const serverPatterns = [
    // Package manager scripts: dev, start, serve, server, preview, watch
    /(^|[;&|\n])\s*(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve|server|preview|watch)\b/i,
    // next dev / next start (with or without npx)
    /(^|[;&|\n])\s*(?:npx\s+)?next\s+(?:dev|start)\b/i,
    // Vite, Astro, Nuxt, SvelteKit, Remix, webpack-dev-server (bare = dev server)
    /(^|[;&|\n])\s*(?:npx\s+)?(?:vite|astro|nuxt|svelte-kit|remix|webpack-dev-server)\b/i,
    // Python http.server
    /(^|[;&|\n])\s*(?:python|python3|py(?:\s+-3)?)\s+-m\s+http\.server\b/i,
    // Python/ASGI/WSGI servers
    /(^|[;&|\n])\s*(?:uvicorn|hypercorn|gunicorn|flask\s+run|streamlit\s+run|gradio\b|jupyter\s+(?:lab|notebook))\b/i,
    // Rails, PHP built-in server, dotnet
    /(^|[;&|\n])\s*(?:rails\s+(?:server|s)|bin\/rails\s+(?:server|s)|php\s+-S|dotnet\s+(?:watch|run))\b/i,
    // node server.js, node app.js, etc.
    /(^|[;&|\n])\s*node\s+(?:server|app|index|main)\.(?:js|mjs|cjs|ts)\b/i,
    // npx serve, npx http-server, npx live-server
    /(^|[;&|\n])\s*(?:npx\s+(?:(?:-y|--yes)\s+)?|npm\s+exec\s+(?:--\s+)?)?(?:serve|http-server|live-server)\b(?!-)/i,
  ];
  return serverPatterns.some((pattern) => pattern.test(normalized));
}

function hasShellPipeline(command: string): boolean {
  let quote: '"' | "'" | "`" | null = null;
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "|" && command[i - 1] !== "|" && command[i + 1] !== "|") return true;
  }
  return false;
}

async function runBash(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const command = String(args.command || "");
  if (!command) return "Error: No command provided";

  const hardBlock = hardBlockedCommand(command);
  if (hardBlock) return `Error: blocked command. ${hardBlock}`;

  // Dangerous command warning for visible terminal output.
  const danger = detectDangerousCommand(command);
  if (danger) ctx.onOutput?.(`Warning: dangerous operation detected: ${danger}\n`);

  const artifactSince = Date.now() - 2000;
  ctx.onOutput?.(`…/workspace > ${command}\n`);

  // Agent-browser writes screenshots/artifacts to its output dir. We no longer
  // pre-scaffold that folder at workspace init (keeps the workspace clean), so
  // create it on demand right before an agent-browser command runs.
  if (commandTouchesAgentBrowser(command)) {
    try {
      mkdirSync(path.join(workspaceMetaPath(ctx.chatId, "download", "agent-browser"), "tmp"), { recursive: true });
    } catch {
      /* best effort */
    }
  }

  // Long-running servers (npm run dev, next start, etc.) run in the background
  // automatically — same as typing the command in a terminal. No managed
  // lifecycle, no port hijacking. The command runs exactly as written.
  const longRunningServer = looksLikeLongRunningServer(command) && !hasShellPipeline(command);

  if (args.run_in_background === true || longRunningServer) {
    await ensureWorkspace(ctx.chatId);
    const { id } = startBackgroundCommand(ctx.chatId, command);
    const reason = longRunningServer ? "Detected a long-running server/watch command; started it in background without a timeout." : "Started in background.";
    await delay(1200, ctx.signal).catch(() => undefined);
    const status = readBackgroundOutput(ctx.chatId, id, 6000);
    const output = status?.output.trim();
    if (output) ctx.onOutput?.(`${clampOutput(output, 6000)}\n`);
    else if (status?.running === false) ctx.onOutput?.("[process exited quickly with no output]\n");
    const outputBlock = output ? `\n\nInitial output:\n${clampOutput(output, 6000)}` : "\n\nInitial output: (no output captured yet; the process may still be starting)";
    const state = status?.running === false ? "\n\nStatus: process exited quickly. Read the output above before retrying." : "";
    return `${reason} id: ${id}${state}\nUse BashOutput with bash_id "${id}" to read more output, or kill:true to stop it.${outputBlock}`;
  }

  const result = await workspaceExecute(ctx.chatId, command, {
    timeout: typeof args.timeout === "number" ? args.timeout : 120000,
    signal: ctx.signal,
    onOutput: (chunk) => ctx.onOutput?.(chunk),
  });
  let body = result.stdout;
  if (result.stderr) body += (body ? "\n" : "") + result.stderr;
  // Bound the model-facing output; the Terminal panel kept the full stream.
  let out = clampOutput(body);
  if (result.exitCode !== 0) out += (out ? "\n" : "") + `Exit code: ${result.exitCode}`;
  if (result.timedOut) out += "\nCommand timed out";
  if (!body.trim() && result.exitCode !== 0) {
    const runtime = readRuntimeStatus(ctx.chatId);
    out += `\nCommand failed without stdout/stderr. Shell: ${process.platform === "win32" ? "PowerShell" : "bash"}. Working directory: ${runtime?.relativeCwd || "."}.`;
  }
  const artifacts = commandTouchesAgentBrowser(command) ? syncAgentBrowserArtifacts(ctx.chatId, artifactSince) : "";
  if (artifacts) out += `\n\n${artifacts}`;
  return out || "(no output)";
}

// Implementation-plan presentation (Code mode plan-first). Persists the plan as
// a workspace file and signals the agent loop to end the turn for approval.
function runPlan(args: Record<string, unknown>, chatId: string): string {
  const title = String(args.title ?? "").trim();
  const plan = String(args.plan ?? "").trim();
  if (!plan) return "Error: Plan requires a `plan` — the full implementation plan as markdown.";
  const slug = (title || "implementation-plan").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "plan";
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const fileName = `${stamp}-${slug}.md`;
  const body = `# ${title || "Implementation Plan"}\n\n_Proposed ${new Date().toLocaleString()}_\n${Array.isArray(args.files) ? `\n**Files involved:**\n${(args.files as unknown[]).map((f) => `- \`${String(f)}\``).join("\n")}\n` : ""}\n${plan}\n`;

  // Save ONE canonical copy at the exact location the `.vaultgate/plans/<file>`
  // alias resolves to (the per-chat meta root). Previously the plan was written
  // to the project root AND meta/download/plans, but neither matched where
  // `Read .vaultgate/plans/<file>` looks — so the agent wasted turns hunting for
  // it. Now the reported path resolves straight to the file.
  const relPath = `.vaultgate/plans/${fileName}`;
  const planFile = workspaceMetaPath(chatId, "plans", fileName);
  mkdirSync(path.dirname(planFile), { recursive: true });
  writeFileSync(planFile, body, "utf-8");

  return `Plan saved: ${relPath}\nTo read it back: Read ${relPath}\nPresented the implementation plan to the user for approval. Your turn ENDS now — do not implement, create, edit, run, or delete anything until the user approves. If they request changes, revise and call Plan again.`;
}

function runAskUserQuestion(args: Record<string, unknown>): string {
  const question = String(args.question || "").trim();
  const options = Array.isArray(args.options) ? (args.options as Array<Record<string, unknown>>) : [];
  const labels = options.map((o) => String(o?.label || "")).filter(Boolean);
  if (!question || labels.length === 0) return "Error: AskUserQuestion requires a question and at least one option.";
  // The agent loop turns this into an interactive prompt and ends the turn;
  // the user's selection arrives as their next message.
  return `Asked the user: "${question}"\nOptions: ${labels.join(" | ")}\nAwaiting the user's selection (it will be their next message).`;
}

// Media tools run in-process against the GLOBAL models configured in Settings
// (see lib/ai/media.ts). They gate on a configured model and fail gracefully —
// no shelling out to a `vaultgate` CLI, no relying on API keys in the shell.
async function runVision(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const prompt = String(args.prompt || "").trim();
  const images = Array.isArray(args.images) ? (args.images as string[]) : [];
  if (!prompt) return "Error: Vision requires a `prompt`.";
  if (images.length === 0) return "Error: Vision requires at least one image path or URL in `images`.";

  await ensureWorkspace(ctx.chatId);
  const resolved = images.map((img) => (/^https?:\/\//i.test(String(img)) ? String(img) : toolPath(ctx.chatId, String(img))));
  const result = await describeImages({ prompt, images: resolved, signal: ctx.signal });
  return result.ok ? clampOutput(result.text) : `Error: ${result.error}`;
}

async function runImageGenerate(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const prompt = String(args.prompt || "").trim();
  if (!prompt) return "Error: ImageGenerate requires a `prompt`.";
  await ensureWorkspace(ctx.chatId);
  const output = String(args.output || ".vaultgate/download/generated-image.png");
  const outputPath = toolPath(ctx.chatId, output);
  const result = await generateImages({ prompt, outputPath, size: args.size ? String(args.size) : undefined, count: args.count ? Number(args.count) : undefined, signal: ctx.signal });
  return result.ok ? result.text : `Error: ${result.error}`;
}

async function runImageEdit(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const prompt = String(args.prompt || "").trim();
  const input = String(args.input || "").trim();
  if (!prompt) return "Error: ImageEdit requires a `prompt`.";
  if (!input) return "Error: ImageEdit requires an `input` image path.";
  await ensureWorkspace(ctx.chatId);
  const output = String(args.output || ".vaultgate/download/edited-image.png");
  const result = await editImage({ prompt, inputPath: toolPath(ctx.chatId, input), outputPath: toolPath(ctx.chatId, output), size: args.size ? String(args.size) : undefined, signal: ctx.signal });
  return result.ok ? result.text : `Error: ${result.error}`;
}

async function runTranscribe(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const input = String(args.input || "").trim();
  if (!input) return "Error: Transcribe requires an `input` audio/video file path.";
  await ensureWorkspace(ctx.chatId);
  const result = await transcribeAudio({
    inputPath: toolPath(ctx.chatId, input),
    language: args.language ? String(args.language) : undefined,
    model: args.model ? String(args.model) : undefined,
    signal: ctx.signal,
  });
  if (!result.ok) return `Error: ${result.error}`;
  // Persist a transcript file when asked, so it shows up in the workspace.
  if (args.output) {
    const outPath = toolPath(ctx.chatId, String(args.output));
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, result.text, "utf-8");
    return `Transcribed to ${String(args.output)}:\n\n${clampOutput(result.text)}`;
  }
  return clampOutput(result.text);
}

async function runTask(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const description = String(args.description || "sub-task").slice(0, 80);
  const subagentType = String(args.subagent_type || "general");
  const prompt = String(args.prompt || "");
  if (!prompt) return "Error: Task requires a `prompt` with full instructions for the sub-agent.";
  if (ctx.signal?.aborted) return "Sub-agent not started because the parent turn was stopped.";
  await ensureWorkspace(ctx.chatId);
  // Dynamic import breaks the static import cycle (agent.ts imports this module).
  const { startSubAgentTask } = await import("@/lib/ai/agent");
  const subAgentChatId = ctx.toolCallId || crypto.randomUUID();
  return startSubAgentTask(ctx.chatId, description, prompt, { subagentType, onOutput: ctx.onOutput, subAgentChatId, approval: ctx.approval, agentParams: ctx.agentParams });
}

function runListProcesses(chatId: string): string {
  const lines: string[] = [];
  const runtime = readRuntimeStatus(chatId);
  if (runtime) {
    const env = runtime.persistedEnvKeys.length ? runtime.persistedEnvKeys.join(", ") : "none";
    lines.push(`Runtime [${runtime.provider}]: cwd=${runtime.relativeCwd}, commands run=${runtime.commandCount}, persisted env=${env}`);
  }
  const procs = listManagedProcesses(chatId);
  if (procs.length === 0) {
    lines.push("No managed processes are running (no dev server, no background commands).");
  } else {
    lines.push("Managed processes:");
    for (const p of procs) {
      const port = p.port ? ` port ${p.port}` : "";
      lines.push(`- [${p.kind}] ${p.id} — ${p.running ? "running" : "stopped"}${port}: ${p.command}`);
    }
  }
  return lines.join("\n");
}

// Open a URL/file/app in the user's REAL desktop session (their actual browser),
// detached and non-blocking — the Electron app runs in the user's session, so the
// launched app is visible on their screen.
// Find an installed Chromium-family browser executable, preferring the named one.
function findChromiumExecutable(prefer: string): string | null {
  if (process.platform === "win32") {
    const pf = process.env.ProgramFiles || "C:\\Program Files";
    const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const local = process.env.LOCALAPPDATA || "";
    const brave = [`${pf}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`, `${pf86}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`, local && `${local}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`];
    const chrome = [`${pf}\\Google\\Chrome\\Application\\chrome.exe`, `${pf86}\\Google\\Chrome\\Application\\chrome.exe`, local && `${local}\\Google\\Chrome\\Application\\chrome.exe`];
    const edge = [`${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`, `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`];
    const order = /chrome/.test(prefer) ? [chrome, brave, edge] : /edge|msedge/.test(prefer) ? [edge, chrome, brave] : [brave, chrome, edge];
    for (const p of order.flat()) if (p && existsSync(p)) return p;
    return null;
  }
  if (process.platform === "darwin") {
    const apps = [
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ];
    const order = /chrome/.test(prefer) ? [apps[1], apps[0], apps[2]] : /edge/.test(prefer) ? [apps[2], apps[1], apps[0]] : apps;
    for (const p of order) if (existsSync(p)) return p;
    return null;
  }
  for (const name of ["brave-browser", "google-chrome", "chromium", "chromium-browser", "microsoft-edge"]) {
    try {
      return execFileSync("which", [name], { encoding: "utf-8" }).trim() || null;
    } catch {
      /* not found */
    }
  }
  return null;
}

function spawnDetached(command: string, args: string[]): void {
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}

// ── Controllable browser registry ─────────────────────────────
// Browsers launched with control:true expose a CDP debugging port. We remember
// them so the agent can list/close/activate the exact tabs it opened, and shut
// the browser down — fine-grained control, no extra dependency.
type ControlBrowser = { port: number; child: ReturnType<typeof spawn>; exe: string };
const controlBrowsers = new Map<number, ControlBrowser>();
let lastControlPort = 0;

interface CdpTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

async function cdp<T = unknown>(port: number, route: string, method = "GET", signal?: AbortSignal): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${port}/json${route}`, { method, signal });
  const text = await res.text();
  if (!res.ok) throw new Error(`CDP ${route} → ${res.status} ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

async function listCdpPages(port: number, signal?: AbortSignal): Promise<CdpTarget[]> {
  const targets = await cdp<CdpTarget[]>(port, "/list", "GET", signal);
  return Array.isArray(targets) ? targets.filter((t) => t.type === "page") : [];
}

function resolveControlPort(args: Record<string, unknown>): number {
  if (typeof args.port === "number" && args.port > 0) return Math.floor(args.port);
  return lastControlPort || 9222;
}

function matchTabs(pages: CdpTarget[], args: Record<string, unknown>): CdpTarget[] {
  const id = String(args.target_id ?? "").trim();
  if (id) return pages.filter((p) => p.id === id);
  const needle = String(args.target ?? args.url ?? "").trim().toLowerCase();
  if (needle) return pages.filter((p) => p.url.toLowerCase().includes(needle) || (p.title || "").toLowerCase().includes(needle));
  return [];
}

interface CdpSession {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  close(): void;
}

interface CdpResponse {
  id?: number;
  result?: unknown;
  error?: { message?: string; data?: unknown };
}

interface CdpEvaluateResult<T = unknown> {
  result?: { value?: T; description?: string };
  exceptionDetails?: { text?: string; exception?: { description?: string } };
}

interface BrowserElementSummary {
  n: number;
  selector: string;
  role: string;
  label: string;
  value?: string;
  href?: string;
}

interface BrowserInspectResult {
  title: string;
  url: string;
  active?: string;
  elements: BrowserElementSummary[];
}

interface BrowserPointResult {
  ok: boolean;
  error?: string;
  x?: number;
  y?: number;
  selector?: string;
  label?: string;
  tag?: string;
}

function jsonForScript(value: unknown): string {
  return (JSON.stringify(value) ?? "null").replace(/</g, "\\u003c");
}

function eventDataText(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf-8");
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf-8");
  return null;
}

function connectCdpTarget(target: CdpTarget, signal?: AbortSignal): Promise<CdpSession> {
  const url = target.webSocketDebuggerUrl;
  if (!url) return Promise.reject(new Error("Selected tab does not expose a CDP WebSocket URL."));
  if (typeof WebSocket === "undefined") return Promise.reject(new Error("This runtime does not provide WebSocket, so visible browser page control is unavailable."));
  if (signal?.aborted) return Promise.reject(new Error("Browser control cancelled."));

  const ws = new WebSocket(url);
  let nextId = 1;
  let closed = false;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  const rejectAll = (err: Error) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    pending.clear();
  };

  return new Promise<CdpSession>((resolve, reject) => {
    let onOpen = () => {};
    let onError = () => {};
    let onAbort = () => {};
    const startupTimer = setTimeout(() => {
      cleanupStartup();
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      reject(new Error("Timed out connecting to the visible browser tab."));
    }, 10000);

    const cleanupStartup = () => {
      clearTimeout(startupTimer);
      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    onAbort = () => {
      cleanupStartup();
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      reject(new Error("Browser control cancelled."));
    };
    onError = () => {
      cleanupStartup();
      reject(new Error("Failed to connect to the visible browser tab."));
    };
    onOpen = () => {
      cleanupStartup();
      const abortPending = () => {
        closed = true;
        rejectAll(new Error("Browser control cancelled."));
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      };

      signal?.addEventListener("abort", abortPending, { once: true });
      ws.addEventListener("message", (event) => {
        const text = eventDataText(event.data);
        if (!text) return;
        let msg: CdpResponse;
        try {
          msg = JSON.parse(text) as CdpResponse;
        } catch {
          return;
        }
        if (typeof msg.id !== "number") return;
        const entry = pending.get(msg.id);
        if (!entry) return;
        pending.delete(msg.id);
        clearTimeout(entry.timer);
        if (msg.error) entry.reject(new Error(`${msg.error.message || "CDP command failed"}${msg.error.data ? `: ${String(msg.error.data)}` : ""}`));
        else entry.resolve(msg.result);
      });
      ws.addEventListener("close", () => {
        closed = true;
        signal?.removeEventListener("abort", abortPending);
        rejectAll(new Error("The visible browser tab connection closed."));
      });

      resolve({
        send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
          if (closed || ws.readyState !== 1) return Promise.reject(new Error("The visible browser tab is not connected."));
          const id = nextId++;
          return new Promise<T>((resolveSend, rejectSend) => {
            const timer = setTimeout(() => {
              pending.delete(id);
              rejectSend(new Error(`${method} timed out.`));
            }, 15000);
            pending.set(id, { resolve: (value) => resolveSend(value as T), reject: rejectSend, timer });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        close() {
          closed = true;
          signal?.removeEventListener("abort", abortPending);
          rejectAll(new Error("Browser control session closed."));
          try {
            if (ws.readyState === 0 || ws.readyState === 1) ws.close();
          } catch {
            /* ignore */
          }
        },
      });
    };

    ws.addEventListener("open", onOpen, { once: true });
    ws.addEventListener("error", onError, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function resolveCdpPage(args: Record<string, unknown>, signal?: AbortSignal): Promise<{ port: number; page: CdpTarget }> {
  const port = resolveControlPort(args);
  const pages = await listCdpPages(port, signal);
  if (pages.length === 0) throw new Error(`No open visible browser tabs on CDP port ${port}.`);
  const matches = matchTabs(pages, args);
  const page = matches[0] || pages.find((p) => p.url && !p.url.startsWith("devtools://")) || pages[0];
  return { port, page };
}

async function browserEvaluate<T>(session: CdpSession, expression: string): Promise<T> {
  const evaluated = await session.send<CdpEvaluateResult<T>>("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (evaluated.exceptionDetails) {
    throw new Error(evaluated.exceptionDetails.exception?.description || evaluated.exceptionDetails.text || "Page script failed.");
  }
  return evaluated.result?.value as T;
}

const BROWSER_INSPECT_SCRIPT = String.raw`(() => {
  const attr = (value) => String(value || "").replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  const esc = (value) => window.CSS && CSS.escape ? CSS.escape(String(value)) : String(value).replace(/[^A-Za-z0-9_-]/g, "\\$&");
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 1 && rect.height > 1 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0;
  };
  const labelOf = (el) => {
    const own = el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("placeholder") || el.getAttribute("alt") || "";
    const value = "value" in el ? String(el.value || "") : "";
    return (own || value || el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 180);
  };
  const selectorOf = (el) => {
    const tag = el.tagName.toLowerCase();
    if (el.id) return tag + "#" + esc(el.id);
    const name = el.getAttribute("name");
    if (name) return tag + "[name=\"" + attr(name) + "\"]";
    const aria = el.getAttribute("aria-label");
    if (aria) return tag + "[aria-label=\"" + attr(aria) + "\"]";
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 4) {
      const nodeTag = node.tagName.toLowerCase();
      if (node.id) { parts.unshift(nodeTag + "#" + esc(node.id)); break; }
      const siblings = Array.from(node.parentElement ? node.parentElement.children : []).filter((s) => s.tagName === node.tagName);
      const index = Math.max(1, siblings.indexOf(node) + 1);
      parts.unshift(nodeTag + (siblings.length > 1 ? ":nth-of-type(" + index + ")" : ""));
      node = node.parentElement;
    }
    return parts.join(" > ") || tag;
  };
  const roleOf = (el) => el.getAttribute("role") || (el.tagName.toLowerCase() === "a" ? "link" : el.tagName.toLowerCase() === "input" || el.tagName.toLowerCase() === "textarea" ? "textbox" : el.tagName.toLowerCase());
  const selector = "a,button,input,textarea,select,video,[role=button],[role=link],[role=textbox],[contenteditable=true],[tabindex]:not([tabindex='-1'])";
  const elements = Array.from(document.querySelectorAll(selector)).filter(visible).slice(0, 80).map((el, index) => ({
    n: index + 1,
    selector: selectorOf(el),
    role: roleOf(el),
    label: labelOf(el),
    value: "value" in el && String(el.value || "") ? String(el.value).slice(0, 120) : undefined,
    href: el.href ? String(el.href).slice(0, 220) : undefined,
  }));
  const active = document.activeElement && document.activeElement !== document.body ? labelOf(document.activeElement) || selectorOf(document.activeElement) : "";
  return { title: document.title || "", url: location.href, active, elements };
})()`;

function browserElementPointScript(selector: string, label: string, requireEditable: boolean): string {
  return String.raw`(() => {
    const selector = ${jsonForScript(selector)};
    const label = ${jsonForScript(label)};
    const requireEditable = ${requireEditable ? "true" : "false"};
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 1 && rect.height > 1 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0;
    };
    const labelOf = (el) => {
      const own = el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("placeholder") || el.getAttribute("alt") || "";
      const value = "value" in el ? String(el.value || "") : "";
      return (own || value || el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim();
    };
    const editable = (el) => {
      const tag = el.tagName ? el.tagName.toLowerCase() : "";
      return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable || el.getAttribute("role") === "textbox";
    };
    let el = null;
    if (selector) {
      try { el = document.querySelector(selector); }
      catch (err) { return { ok: false, error: "Invalid selector: " + (err && err.message ? err.message : String(err)) }; }
    }
    if (!el && label) {
      const needle = label.toLowerCase();
      const candidates = Array.from(document.querySelectorAll("a,button,input,textarea,select,video,[role=button],[role=link],[role=textbox],[contenteditable=true],[tabindex]:not([tabindex='-1'])")).filter(visible);
      el = candidates.find((candidate) => labelOf(candidate).toLowerCase() === needle) || candidates.find((candidate) => labelOf(candidate).toLowerCase().includes(needle));
    }
    if (!el && requireEditable) el = document.activeElement;
    if (!el || el === document.body || !visible(el)) return { ok: false, error: selector || label ? "No visible element matched." : "No focused element is available." };
    if (requireEditable && !editable(el)) return { ok: false, error: "Matched element is not editable. Provide a selector/label for an input, textarea, or contenteditable element." };
    el.scrollIntoView({ block: "center", inline: "center" });
    if (el.focus) el.focus({ preventScroll: true });
    const rect = el.getBoundingClientRect();
    return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, label: labelOf(el).slice(0, 180), tag: el.tagName ? el.tagName.toLowerCase() : "element" };
  })()`;
}

function browserWaitScript(selector: string, text: string): string {
  return String.raw`(() => {
    const selector = ${jsonForScript(selector)};
    const text = ${jsonForScript(text)};
    if (selector) return Boolean(document.querySelector(selector));
    if (!text) return true;
    const body = (document.body && document.body.innerText ? document.body.innerText : document.documentElement.innerText || "").toLowerCase();
    return body.includes(text.toLowerCase());
  })()`;
}

function formatBrowserInspect(port: number, page: CdpTarget, inspected: BrowserInspectResult): string {
  const lines = [`Visible browser tab on CDP port ${port}`, `Title: ${inspected.title || page.title || "(untitled)"}`, `URL: ${inspected.url || page.url}`];
  if (inspected.active) lines.push(`Focused: ${inspected.active}`);
  if (!inspected.elements.length) return `${lines.join("\n")}\nNo visible interactive elements found.`;
  lines.push("Visible interactive elements:");
  for (const el of inspected.elements) {
    const details = [`${el.n}. ${el.role}`, `selector=${JSON.stringify(el.selector)}`];
    if (el.label) details.push(`label=${JSON.stringify(el.label)}`);
    if (el.value) details.push(`value=${JSON.stringify(el.value)}`);
    if (el.href) details.push(`href=${JSON.stringify(el.href)}`);
    lines.push(details.join(" | "));
  }
  return lines.join("\n");
}

function normalizeBrowserTarget(target: string): string {
  const trimmed = target.trim();
  if (!trimmed) return trimmed;
  return isWebUrlTarget(trimmed) && !/^https?:\/\//i.test(trimmed) ? `https://${trimmed}` : trimmed;
}

function keyInfo(input: string): { key: string; code: string; windowsVirtualKeyCode: number; modifiers: number } {
  const parts = input.split("+").map((p) => p.trim()).filter(Boolean);
  const keyPart = parts.pop() || "Enter";
  let modifiers = 0;
  for (const part of parts.map((p) => p.toLowerCase())) {
    if (part === "alt" || part === "option") modifiers |= 1;
    else if (part === "ctrl" || part === "control") modifiers |= 2;
    else if (part === "meta" || part === "cmd" || part === "command" || part === "win") modifiers |= 4;
    else if (part === "shift") modifiers |= 8;
  }
  const upper = keyPart.toUpperCase();
  const named: Record<string, { key: string; code: string; vk: number }> = {
    ENTER: { key: "Enter", code: "Enter", vk: 13 },
    RETURN: { key: "Enter", code: "Enter", vk: 13 },
    TAB: { key: "Tab", code: "Tab", vk: 9 },
    ESC: { key: "Escape", code: "Escape", vk: 27 },
    ESCAPE: { key: "Escape", code: "Escape", vk: 27 },
    BACKSPACE: { key: "Backspace", code: "Backspace", vk: 8 },
    DELETE: { key: "Delete", code: "Delete", vk: 46 },
    SPACE: { key: " ", code: "Space", vk: 32 },
    UP: { key: "ArrowUp", code: "ArrowUp", vk: 38 },
    DOWN: { key: "ArrowDown", code: "ArrowDown", vk: 40 },
    LEFT: { key: "ArrowLeft", code: "ArrowLeft", vk: 37 },
    RIGHT: { key: "ArrowRight", code: "ArrowRight", vk: 39 },
  };
  const namedKey = named[upper];
  if (namedKey) return { key: namedKey.key, code: namedKey.code, windowsVirtualKeyCode: namedKey.vk, modifiers };
  const single = keyPart.length === 1 ? keyPart : keyPart[0] || " ";
  const letter = single.toUpperCase();
  return { key: single, code: /^[A-Z]$/.test(letter) ? `Key${letter}` : /^[0-9]$/.test(single) ? `Digit${single}` : single, windowsVirtualKeyCode: letter.charCodeAt(0), modifiers };
}

async function dispatchBrowserKey(session: CdpSession, key: string): Promise<void> {
  const info = keyInfo(key);
  const params = { key: info.key, code: info.code, windowsVirtualKeyCode: info.windowsVirtualKeyCode, nativeVirtualKeyCode: info.windowsVirtualKeyCode, modifiers: info.modifiers };
  await session.send("Input.dispatchKeyEvent", { type: "keyDown", ...params });
  await session.send("Input.dispatchKeyEvent", { type: "keyUp", ...params });
}

async function dispatchBrowserClick(session: CdpSession, x: number, y: number): Promise<void> {
  await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
  await session.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Browser control cancelled."));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Browser control cancelled."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function waitForCdpReady(port: number, signal?: AbortSignal): Promise<boolean> {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    try {
      await cdp(port, "/version", "GET", signal);
      return true;
    } catch {
      await delay(200, signal).catch(() => undefined);
    }
  }
  return false;
}

async function runBrowserPageAction(action: string, args: Record<string, unknown>, chatId: string, signal?: AbortSignal): Promise<string> {
  const { port, page } = await resolveCdpPage(args, signal);
  const session = await connectCdpTarget(page, signal);
  try {
    await session.send("Runtime.enable").catch(() => undefined);
    await session.send("Page.enable").catch(() => undefined);
    await session.send("Input.setIgnoreInputEvents", { ignore: false }).catch(() => undefined);

    if (action === "inspect" || action === "observe") {
      const inspected = await browserEvaluate<BrowserInspectResult>(session, BROWSER_INSPECT_SCRIPT);
      return formatBrowserInspect(port, page, inspected);
    }

    if (action === "navigate" || action === "go") {
      const target = normalizeBrowserTarget(String(args.target ?? args.url ?? "").trim());
      if (!target) return "Error: Open action=navigate requires target/url.";
      await session.send("Page.navigate", { url: target });
      return `Navigated visible browser tab to ${target} on CDP port ${port}.`;
    }

    if (action === "click") {
      let x = typeof args.x === "number" ? args.x : NaN;
      let y = typeof args.y === "number" ? args.y : NaN;
      let label = "";
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        const selector = String(args.selector ?? "").trim();
        const labelArg = String(args.label ?? args.text ?? args.target ?? "").trim();
        const point = await browserEvaluate<BrowserPointResult>(session, browserElementPointScript(selector, labelArg, false));
        if (!point.ok || typeof point.x !== "number" || typeof point.y !== "number") return `Error: ${point.error || "Could not locate a click target."}`;
        x = point.x;
        y = point.y;
        label = point.label || point.tag || "element";
      }
      await dispatchBrowserClick(session, x, y);
      return `Clicked visible browser page${label ? ` element: ${label}` : ` at ${Math.round(x)},${Math.round(y)}`}.`;
    }

    if (action === "type") {
      const text = String(args.text ?? "");
      if (!text) return "Error: Open action=type requires text.";
      const selector = String(args.selector ?? "").trim();
      const labelArg = String(args.label ?? "").trim();
      const point = await browserEvaluate<BrowserPointResult>(session, browserElementPointScript(selector, labelArg, true));
      if (!point.ok) return `Error: ${point.error || "Could not focus an editable element."}`;
      if (args.clear === true) {
        await dispatchBrowserKey(session, "Ctrl+A");
        await dispatchBrowserKey(session, "Backspace");
      }
      await session.send("Input.insertText", { text });
      return `Typed text into visible browser page${point.label ? ` element: ${point.label}` : ""}.`;
    }

    if (action === "press" || action === "key") {
      const key = String(args.key ?? args.text ?? "Enter").trim() || "Enter";
      await dispatchBrowserKey(session, key);
      return `Pressed ${key} in the visible browser page.`;
    }

    if (action === "wait") {
      const selector = String(args.selector ?? "").trim();
      const text = String(args.text ?? args.label ?? "").trim();
      if (!selector && !text) {
        const ms = Math.max(0, Math.min(Math.floor(Number(args.amount ?? 1000)), 30000));
        await delay(ms, signal);
        return `Waited ${ms}ms in the visible browser.`;
      }
      const timeoutMs = Math.max(250, Math.min(Math.floor(Number(args.timeout_ms ?? 10000)), 30000));
      const deadline = Date.now() + timeoutMs;
      while (Date.now() <= deadline) {
        if (await browserEvaluate<boolean>(session, browserWaitScript(selector, text))) return `Wait condition met in visible browser${selector ? ` for selector ${selector}` : ` for text ${text}`}.`;
        await delay(250, signal);
      }
      return `Timed out after ${timeoutMs}ms waiting in visible browser${selector ? ` for selector ${selector}` : ` for text ${text}`}.`;
    }

    if (action === "screenshot") {
      const dir = workspaceMetaPath(chatId, "download", "screenshots");
      mkdirSync(dir, { recursive: true });
      const base = safeArtifactName(String(args.filename || page.title || page.url || "browser")).replace(/\.(?:png|jpe?g|webp)$/i, "");
      const out = path.join(dir, `browser-${base}-${Date.now()}.png`);
      const captured = await session.send<{ data: string }>("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
      writeFileSync(out, Buffer.from(captured.data, "base64"));
      const rel = displayPath(chatId, out);
      return `Browser screenshot saved: ${rel}\nTab: ${page.title || page.url}\nLink: ${fileLink(rel)}`;
    }

    return `Error: unknown browser page action '${action}'. Use inspect, navigate, click, type, press, wait, or screenshot.`;
  } finally {
    session.close();
  }
}

async function runBrowserTabAction(action: string, args: Record<string, unknown>, chatId: string, signal?: AbortSignal): Promise<string> {
  const port = resolveControlPort(args);
  try {
    if (["inspect", "observe", "navigate", "go", "click", "type", "press", "key", "wait", "screenshot"].includes(action)) {
      return await runBrowserPageAction(action, args, chatId, signal);
    }

    if (action === "list_tabs" || action === "tabs") {
      const pages = await listCdpPages(port, signal);
      if (pages.length === 0) return `No open tabs on the controllable browser (CDP port ${port}).`;
      const lines = pages.map((p, i) => `${i + 1}. [${p.id}] ${p.title || "(untitled)"} — ${p.url}`);
      return `Open tabs on CDP port ${port}:\n${lines.join("\n")}\nClose one with Open action=close_tab and its target_id (or a url/title substring as target).`;
    }

    if (action === "close_tab") {
      const pages = await listCdpPages(port, signal);
      const matches = matchTabs(pages, args);
      if (matches.length === 0) {
        const hint = pages.length ? `Open tabs: ${pages.map((p) => `${p.title || p.url}`).join("; ")}` : "No tabs are open on this port.";
        return `No tab matched on CDP port ${port}. Pass an exact target_id, or a url/title substring as target. ${hint}`;
      }
      for (const tab of matches) await cdp(port, `/close/${tab.id}`, "GET", signal).catch(() => undefined);
      return `Closed ${matches.length} tab${matches.length === 1 ? "" : "s"}: ${matches.map((t) => t.title || t.url).join("; ")}.`;
    }

    if (action === "activate_tab" || action === "focus_tab") {
      const pages = await listCdpPages(port, signal);
      const matches = matchTabs(pages, args);
      if (matches.length === 0) return `No tab matched to activate on CDP port ${port}. List tabs first with action=list_tabs.`;
      await cdp(port, `/activate/${matches[0].id}`, "GET", signal);
      return `Activated tab: ${matches[0].title || matches[0].url}.`;
    }

    if (action === "new_tab") {
      const url = normalizeBrowserTarget(String(args.target ?? args.url ?? "about:blank").trim());
      try {
        await cdp(port, `/new?${encodeURIComponent(url)}`, "PUT", signal);
      } catch {
        await cdp(port, `/new?${encodeURIComponent(url)}`, "GET", signal);
      }
      return `Opened a new tab at ${url} on CDP port ${port}.`;
    }

    if (action === "close_browser") {
      const browser = controlBrowsers.get(port);
      if (!browser) return `No controllable browser is tracked on CDP port ${port}.`;
      try {
        browser.child.kill();
      } catch {
        /* may already be gone */
      }
      controlBrowsers.delete(port);
      if (lastControlPort === port) lastControlPort = 0;
      return `Closed the controllable browser on CDP port ${port}.`;
    }

    return `Error: unknown browser action '${action}'. Use open, list_tabs, close_tab, activate_tab, new_tab, close_browser, inspect, navigate, click, type, press, wait, or screenshot.`;
  } catch (err) {
    return `Error: could not reach/control the visible browser on CDP port ${port} (${err instanceof Error ? err.message : String(err)}). Browser control only works on a browser opened with Open control:true. Launch one first, then use Open browser actions.`;
  }
}

async function runOpen(args: Record<string, unknown>, chatId: string, signal?: AbortSignal): Promise<string> {
  const action = String(args.action ?? "open").trim().toLowerCase();

  // Tab/browser management over the CDP debugging port of a controllable browser.
  if (action && action !== "open") {
    return runBrowserTabAction(action, args, chatId, signal);
  }

  const app = String(args.app ?? "").trim();
  const target = String(args.target ?? args.url ?? args.path ?? app).trim();
  if (!target) return "Error: Open requires a `target` or `app` (URL, file path, folder, protocol, or desktop app).";
  const control = args.control === true || (args.control !== false && isWebUrlTarget(target));

  // Control mode: launch a visible Chromium browser with remote debugging so the
  // agent can drive that same window and manage its exact tabs.
  if (control) {
    const port = typeof args.port === "number" && args.port > 0 ? Math.floor(args.port) : 9222;
    const exe = findChromiumExecutable(app.toLowerCase());
    if (!exe) {
      return "Error: control mode needs a Chromium browser (Brave/Chrome/Edge) and none was found. Either install one, or use Open without control to just show the page in the default browser.";
    }
    const profileDir = path.join(getDataDir(), "browser-profile");
    mkdirSync(profileDir, { recursive: true });
    try {
      const browserTarget = normalizeBrowserTarget(target);
      const child = spawn(exe, [`--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, "--no-first-run", "--no-default-browser-check", "--autoplay-policy=no-user-gesture-required", browserTarget], { detached: true, stdio: "ignore" });
      child.on("error", () => {});
      child.unref();
      controlBrowsers.set(port, { port, child, exe });
      lastControlPort = port;
      const ready = await waitForCdpReady(port, signal);
      return `Launched ${path.basename(exe)} (visible) with Open control mode on CDP port ${port}, now showing ${browserTarget}.\nUse Open actions to control this same visible browser: inspect, navigate, click, type, press, wait, screenshot, list_tabs, close_tab, activate_tab, new_tab, close_browser. Do not use agent-browser unless the user explicitly asks for headless/background automation. Screenshots save under virtual .vaultgate/download/screenshots in VaultGate Home. It uses a dedicated VaultGate profile (${profileDir}) — log in once and it persists.${ready ? "" : "\nNote: the browser is still starting; retry Open action=inspect/list_tabs if the first control action cannot connect yet."}`;
    } catch (err) {
      return `Error launching controllable browser: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  let cmd: string;
  let cmdArgs: string[];
  if (process.platform === "win32") {
    return runWindowsOpen(target, app);
  } else if (process.platform === "darwin") {
    cmd = "open";
    cmdArgs = app ? ["-a", app, target] : [target];
  } else {
    cmd = app || "xdg-open";
    cmdArgs = [target];
  }

  try {
    spawnDetached(cmd, cmdArgs);
    return `Opened ${app ? `${app} → ` : ""}${target} on your desktop.`;
  } catch (err) {
    return `Error opening ${target}: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function isWebUrlTarget(target: string): boolean {
  return /^https?:\/\//i.test(target) || /^www\.[\w.-]+\.[a-z]{2,}(?:[/:?#].*)?$/i.test(target) || /^[\w-]+(?:\.[\w-]+)+\.[a-z]{2,}(?:[/:?#].*)?$/i.test(target);
}

function runWindowsOpen(target: string, app: string): string {
  const query = app || target;
  const arg = app && target !== app ? target : "";
  return runPowerShell(`
$target = ${psQuote(target)}
$app = ${psQuote(app)}
$query = ${psQuote(query)}
$arg = ${psQuote(arg)}
function Try-Start($file, $argument) {
  try {
    if ($argument) { Start-Process -FilePath $file -ArgumentList $argument -ErrorAction Stop }
    else { Start-Process -FilePath $file -ErrorAction Stop }
    return $true
  } catch { return $false }
}
if ($app) {
  if (Try-Start $app $arg) { "Opened $app${arg ? ' with target' : ''} on your desktop."; exit }
}
if (Try-Start $target "") { "Opened $target on your desktop."; exit }
if ($query -notmatch ':$' -and (Try-Start ($query + ':') "")) { "Opened $query protocol on your desktop."; exit }
$startApps = Get-StartApps -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "*$query*" -or $_.AppID -like "*$query*" } | Select-Object -First 1
if ($startApps) {
  Start-Process explorer.exe "shell:AppsFolder\\$($startApps.AppID)"
  "Opened $($startApps.Name) from installed apps."
  exit
}
$roots = @(
  [Environment]::GetFolderPath('Programs'),
  [Environment]::GetFolderPath('CommonPrograms'),
  [Environment]::GetFolderPath('Desktop'),
  [Environment]::GetFolderPath('CommonDesktopDirectory')
) | Where-Object { $_ -and (Test-Path $_) }
$shortcut = $roots | ForEach-Object { Get-ChildItem -LiteralPath $_ -Filter *.lnk -Recurse -ErrorAction SilentlyContinue } | Where-Object { $_.BaseName -like "*$query*" } | Select-Object -First 1
if ($shortcut) {
  Start-Process -FilePath $shortcut.FullName
  "Opened $($shortcut.BaseName) from shortcut."
  exit
}
"Requested open for '$target', but Windows did not report a matching app/shortcut. Try Desktop windows to see what is already open, or provide a more exact app name/path/protocol."
`, 20000);
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function runPowerShell(script: string, timeout = 12000): string {
  return execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    encoding: "utf-8",
    timeout,
    maxBuffer: 4 * 1024 * 1024,
  }).trim();
}

function sendKeysExpression(input: string): string {
  const raw = input.trim();
  const upper = raw.toUpperCase();
  const named: Record<string, string> = {
    ENTER: "{ENTER}",
    RETURN: "{ENTER}",
    TAB: "{TAB}",
    ESC: "{ESC}",
    ESCAPE: "{ESC}",
    BACKSPACE: "{BACKSPACE}",
    DELETE: "{DELETE}",
    SPACE: " ",
    UP: "{UP}",
    DOWN: "{DOWN}",
    LEFT: "{LEFT}",
    RIGHT: "{RIGHT}",
  };
  if (named[upper]) return named[upper];
  const parts = upper.split("+").map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    const key = parts.at(-1) || "";
    const prefix = parts.slice(0, -1).map((p) => (p === "CTRL" || p === "CONTROL" ? "^" : p === "ALT" ? "%" : p === "SHIFT" ? "+" : "")).join("");
    const body = /^F\d{1,2}$/.test(key) || named[key] ? `{${key}}` : key.toLowerCase();
    return `${prefix}${body}`;
  }
  return raw;
}

function runDesktop(args: Record<string, unknown>, chatId: string): string {
  if (process.platform !== "win32") return "Error: Desktop control is currently implemented for Windows native apps.";
  const action = String(args.action || "windows").trim().toLowerCase();
  const target = String(args.target || args.window || "").trim();
  const hwnd = String(args.hwnd || "").trim();

  const base = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class VGWin32 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out VGRect rect);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out VGRect rect, int size);
}
public struct VGRect { public int Left; public int Top; public int Right; public int Bottom; }
"@
function Get-VGWindow($target, $hwnd) {
  $wins = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | Sort-Object ProcessName
  if ($hwnd) { return $wins | Where-Object { [string]$_.MainWindowHandle -eq [string]$hwnd } | Select-Object -First 1 }
  if ($target) { return $wins | Where-Object { $_.ProcessName -like "*$target*" -or $_.MainWindowTitle -like "*$target*" } | Select-Object -First 1 }
  $fg = [VGWin32]::GetForegroundWindow()
  if ($fg -ne [IntPtr]::Zero) {
    $foreground = $wins | Where-Object { [Int64]$_.MainWindowHandle -eq $fg.ToInt64() } | Select-Object -First 1
    if ($foreground) { return $foreground }
  }
  return $wins | Select-Object -First 1
}
function Get-VGWindowBounds($handle) {
  $rect = New-Object VGRect
  $size = [Runtime.InteropServices.Marshal]::SizeOf([type][VGRect])
  $ok = $false
  try { $ok = ([VGWin32]::DwmGetWindowAttribute($handle, 9, [ref]$rect, $size) -eq 0) } catch { $ok = $false }
  if (-not $ok -or ($rect.Right -le $rect.Left) -or ($rect.Bottom -le $rect.Top)) {
    [VGWin32]::GetWindowRect($handle, [ref]$rect) | Out-Null
  }
  return $rect
}
function Focus-VGWindow($target, $hwnd) {
  $w = Get-VGWindow $target $hwnd
  if (-not $w) { throw "No visible window matched '$target'." }
  [VGWin32]::ShowWindow($w.MainWindowHandle, 9) | Out-Null
  [VGWin32]::SetForegroundWindow($w.MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 250
  return $w
}
function Click-VGMouse($button, $count) {
  $down = 0x0002; $up = 0x0004
  if ($button -eq 'right') { $down = 0x0008; $up = 0x0010 }
  for ($i = 0; $i -lt $count; $i++) {
    [VGWin32]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero)
    [VGWin32]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 80
  }
}
`;

  if (action === "windows" || action === "list") {
    return runPowerShell(`${base}
Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | Sort-Object ProcessName | Select-Object Id,ProcessName,MainWindowTitle,@{Name='Hwnd';Expression={[string]$_.MainWindowHandle}} | ConvertTo-Json -Depth 3`);
  }

  if (action === "focus") {
    return runPowerShell(`${base}
$w = Focus-VGWindow ${psQuote(target)} ${psQuote(hwnd)}
"Focused $($w.ProcessName): $($w.MainWindowTitle) [hwnd=$($w.MainWindowHandle)]"`);
  }

  if (action === "type") {
    const text = String(args.text || "");
    return runPowerShell(`${base}
$w = Focus-VGWindow ${psQuote(target)} ${psQuote(hwnd)}
$old = $null
try { $old = Get-Clipboard -Raw -ErrorAction SilentlyContinue } catch {}
Set-Clipboard -Value ${psQuote(text)}
[System.Windows.Forms.SendKeys]::SendWait('^v')
Start-Sleep -Milliseconds 150
if ($null -ne $old) { Set-Clipboard -Value $old }
"Typed text into $($w.ProcessName)."`);
  }

  if (action === "clipboard_get") {
    return runPowerShell(`${base}
try { Get-Clipboard -Raw } catch { "" }`);
  }

  if (action === "clipboard_set") {
    const text = String(args.text || "");
    return runPowerShell(`${base}
Set-Clipboard -Value ${psQuote(text)}
"Clipboard updated."`);
  }

  if (action === "press" || action === "key" || action === "hotkey") {
    const key = sendKeysExpression(String(args.key || args.keys || "ENTER"));
    return runPowerShell(`${base}
$w = Focus-VGWindow ${psQuote(target)} ${psQuote(hwnd)}
[System.Windows.Forms.SendKeys]::SendWait(${psQuote(key)})
"Pressed ${key.replace(/"/g, "'")} in $($w.ProcessName)."`);
  }

  if (action === "click" || action === "double_click" || action === "right_click" || action === "move") {
    const x = Math.floor(Number(args.x ?? 0));
    const y = Math.floor(Number(args.y ?? 0));
    const button = action === "right_click" ? "right" : "left";
    const count = action === "double_click" ? 2 : action === "move" ? 0 : 1;
    return runPowerShell(`${base}
if (${psQuote(target)} -or ${psQuote(hwnd)}) { Focus-VGWindow ${psQuote(target)} ${psQuote(hwnd)} | Out-Null }
[VGWin32]::SetCursorPos(${x}, ${y}) | Out-Null
if (${count} -gt 0) { Click-VGMouse ${psQuote(button)} ${count} }
"${action === "move" ? "Moved mouse to" : action === "right_click" ? "Right-clicked" : action === "double_click" ? "Double-clicked" : "Clicked"} ${x},${y}."`);
  }

  if (action === "drag") {
    const x = Math.floor(Number(args.x ?? 0));
    const y = Math.floor(Number(args.y ?? 0));
    const x2 = Math.floor(Number(args.x2 ?? x));
    const y2 = Math.floor(Number(args.y2 ?? y));
    return runPowerShell(`${base}
if (${psQuote(target)} -or ${psQuote(hwnd)}) { Focus-VGWindow ${psQuote(target)} ${psQuote(hwnd)} | Out-Null }
[VGWin32]::SetCursorPos(${x}, ${y}) | Out-Null
[VGWin32]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 100
[VGWin32]::SetCursorPos(${x2}, ${y2}) | Out-Null
Start-Sleep -Milliseconds 100
[VGWin32]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
"Dragged ${x},${y} to ${x2},${y2}."`);
  }

  if (action === "scroll") {
    const amount = Math.floor(Number(args.amount ?? -600));
    const x = args.x === undefined ? null : Math.floor(Number(args.x));
    const y = args.y === undefined ? null : Math.floor(Number(args.y));
    return runPowerShell(`${base}
if (${psQuote(target)} -or ${psQuote(hwnd)}) { Focus-VGWindow ${psQuote(target)} ${psQuote(hwnd)} | Out-Null }
${x !== null && y !== null ? `[VGWin32]::SetCursorPos(${x}, ${y}) | Out-Null` : ""}
[VGWin32]::mouse_event(0x0800, 0, 0, ${amount}, [UIntPtr]::Zero)
"Scrolled ${amount}."`);
  }

  if (action === "wait") {
    const ms = Math.max(0, Math.min(Math.floor(Number(args.amount ?? 1000)), 30000));
    return runPowerShell(`Start-Sleep -Milliseconds ${ms}
"Waited ${ms}ms."`, Math.min(ms + 5000, 35000));
  }

  if (action === "screenshot") {
    const dir = workspaceMetaPath(chatId, "download", "screenshots");
    mkdirSync(dir, { recursive: true });
    const scope = String(args.scope || (args.window_only === true ? "window" : "screen")).toLowerCase();
    const windowOnly = scope === "window" || Boolean(target || hwnd);
    const name = windowOnly ? `window-${safeArtifactName(target || hwnd || "active")}-${Date.now()}.png` : `desktop-${Date.now()}.png`;
    const out = path.join(dir, name);
    const rel = displayPath(chatId, out);
    if (windowOnly) {
      return runPowerShell(`${base}
Add-Type -AssemblyName System.Drawing
$w = Get-VGWindow ${psQuote(target)} ${psQuote(hwnd)}
if (-not $w) { throw "No window matched the requested target." }
$handle = [IntPtr]$w.MainWindowHandle
$wasMinimized = [VGWin32]::IsIconic($handle)
if ($wasMinimized) { [VGWin32]::ShowWindow($handle, 9) | Out-Null; Start-Sleep -Milliseconds 450 }
[VGWin32]::SetForegroundWindow($handle) | Out-Null
Start-Sleep -Milliseconds 250
$rect = Get-VGWindowBounds $handle
$width = [Math]::Max(1, $rect.Right - $rect.Left)
$height = [Math]::Max(1, $rect.Bottom - $rect.Top)
$bmp = New-Object System.Drawing.Bitmap $width, $height
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
try {
  $gfx.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)
  $bmp.Save(${psQuote(out)}, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $gfx.Dispose(); $bmp.Dispose()
  if ($wasMinimized) { [VGWin32]::ShowWindow($handle, 6) | Out-Null }
}
"Window screenshot saved: ${rel}\nWindow: $($w.ProcessName) - $($w.MainWindowTitle) [hwnd=$($w.MainWindowHandle)]\nLink: ${fileLink(rel)}"`, 20000);
    }
    return runPowerShell(`${base}
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$gfx.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bounds.Size)
$bmp.Save(${psQuote(out)}, [System.Drawing.Imaging.ImageFormat]::Png)
$gfx.Dispose(); $bmp.Dispose()
"Screenshot saved: ${rel}\nLink: ${fileLink(rel)}"`, 20000);
  }

  return "Error: Desktop action must be one of windows, focus, type, press, click, double_click, right_click, move, drag, scroll, screenshot, clipboard_get, clipboard_set, wait.";
}

async function runBashOutput(args: Record<string, unknown>, chatId: string): Promise<string> {
  await ensureWorkspace(chatId);
  const id = String(args.bash_id || "").trim();
  if (!id) return "Error: bash_id is required";
  if (args.kill === true) {
    const killed = killBackgroundCommand(chatId, id);
    return killed ? `Stopped background command ${id}.` : `Background command ${id} was not running (already finished or unknown id).`;
  }
  const status = readBackgroundOutput(chatId, id);
  if (!status) return `No background command found with id ${id}.`;
  const since = status.startedAt ? Math.max(0, Date.parse(status.startedAt) - 2000) : Date.now() - 24 * 60 * 60 * 1000;
  const artifacts = commandTouchesAgentBrowser(status.command) ? syncAgentBrowserArtifacts(chatId, since) : "";
  return `Background ${id} [${status.running ? "running" : "finished"}]\nCommand: ${status.command}\n\n${status.output || "(no output yet)"}${artifacts ? `\n\n${artifacts}` : ""}`;
}

function fileLink(rel: string): string {
  const label = rel.split("/").pop() || rel;
  return `[${label}](workspace-file:${encodeURIComponent(rel)})`;
}

function toolPath(chatId: string, filepath: string): string {
  return resolveWorkspacePath(filepath, resolvedRoot(chatId), workspaceMetaRoot(chatId));
}

function commandTouchesAgentBrowser(command: string): boolean {
  return /(^|[\s"'`;&|()])agent-browser(?:\.cmd|\.exe)?(?=$|[\s"'`;&|()])/i.test(command);
}

function agentBrowserArtifactDirs(root: string, metaRoot: string): string[] {
  return [
    path.join(homedir(), ".agent-browser", "tmp"),
    path.join(metaRoot, "download", "agent-browser"),
    path.join(metaRoot, "download", "agent-browser", "tmp"),
    path.join(root, ".vaultgate", "download", "agent-browser"),
    path.join(root, ".vaultgate", "download", "agent-browser", "tmp"),
    path.join(root, "download", "agent-browser"),
    path.join(root, "download", "agent-browser", "tmp"),
  ];
}

function artifactExt(file: string): boolean {
  return /\.(?:png|jpe?g|webp|gif|pdf|webm|mp4|mov|har|json|txt)$/i.test(file);
}

function collectFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, out);
    else if (entry.isFile() && artifactExt(full)) out.push(full);
  }
  return out;
}

function safeArtifactName(file: string): string {
  return path.basename(file).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "artifact";
}

function syncAgentBrowserArtifacts(chatId: string, sinceMs: number): string {
  const root = resolvedRoot(chatId);
  const metaRoot = workspaceMetaRoot(chatId);
  const targetDir = path.join(metaRoot, "download", "agent-browser");
  mkdirSync(targetDir, { recursive: true });

  const copied: string[] = [];
  const files: Array<{ file: string; mtimeMs: number }> = [];
  const candidates = agentBrowserArtifactDirs(root, metaRoot)
    .flatMap((dir) => collectFiles(dir))
    .filter((file, index, all) => all.indexOf(file) === index);

  for (const file of candidates) {
    try {
      const stat = statSync(file);
      const mtimeMs = Number(stat.mtimeMs);
      const size = Number(stat.size);
      if (stat.isFile() && mtimeMs >= sinceMs && size <= 100 * 1024 * 1024) {
        files.push({ file, mtimeMs });
      }
    } catch {
      /* file vanished while scanning */
    }
  }

  files.sort((a, b) => a.mtimeMs - b.mtimeMs);

  for (const { file, mtimeMs } of files.slice(-20)) {
    const targetRel = path.relative(targetDir, file);
    const alreadyInOutputDir = targetRel && !targetRel.startsWith("..") && !path.isAbsolute(targetRel) && !targetRel.split(path.sep).includes("tmp");
    if (alreadyInOutputDir) {
      copied.push(`- ${fileLink(displayPath(chatId, file))}`);
      continue;
    }

    const stamp = new Date(mtimeMs).toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    const target = path.join(targetDir, `${stamp}-${safeArtifactName(file)}`);
    try {
      cpSync(file, target, { force: true });
      const rel = displayPath(chatId, target);
      copied.push(`- ${fileLink(rel)}`);
    } catch {
      /* artifact sync is best-effort; never fail the browser command */
    }
  }

  return copied.length ? `Agent-browser artifacts copied into the workspace:\n${copied.join("\n")}` : "";
}

/** Report a written file: a clickable workspace link if inside the workspace,
 * otherwise the real absolute path (e.g. a file written to the user's Desktop). */
function editStamp(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

function writtenReport(full: string, chatId: string, verb: string): string {
  const unix = displayPath(chatId, full);
  if (!path.isAbsolute(unix)) {
    return `${verb}: ${unix} (at ${editStamp()})\nLink: ${fileLink(unix)}`;
  }
  return `${verb} on your machine: ${unix} (at ${editStamp()})`;
}

function displayPath(chatId: string, full: string): string {
  const root = resolvedRoot(chatId);
  const rel = path.relative(root, full);
  const inside = rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  if (inside) return rel.replace(/\\/g, "/");

  const metaRoot = workspaceMetaRoot(chatId);
  const metaRel = path.relative(metaRoot, full);
  const insideMeta = metaRel === "" || (!metaRel.startsWith("..") && !path.isAbsolute(metaRel));
  if (insideMeta) return [".vaultgate", metaRel.replace(/\\/g, "/")].filter(Boolean).join("/");
  return full;
}

function missingFileHint(full: string): string {
  const dir = path.dirname(full);
  const target = path.basename(full).toLowerCase();
  if (!existsSync(dir)) return "";
  try {
    const names = readdirSync(dir)
      .map((name) => String(name))
      .filter(Boolean)
      .map((name) => ({ name, score: filenameScore(target, name.toLowerCase()) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((item) => item.name);
    return names.length ? ` Did you mean: ${names.join(", ")}?` : "";
  } catch {
    return "";
  }
}

function filenameScore(target: string, candidate: string): number {
  if (!target || !candidate) return 0;
  if (target === candidate) return 100;
  if (candidate.includes(target) || target.includes(candidate)) return 80;
  const targetParts = target.split(/[._\-\s]+/).filter(Boolean);
  const candidateParts = candidate.split(/[._\-\s]+/).filter(Boolean);
  return targetParts.filter((part) => candidateParts.some((candidatePart) => candidatePart.includes(part) || part.includes(candidatePart))).length;
}

function runRead(args: Record<string, unknown>, chatId: string): string {
  const full = toolPath(chatId, String(args.filepath || ""));
  if (!existsSync(full)) return `Error: file not found: ${String(args.filepath || "")}.${missingFileHint(full)}`;
  trackFileRead(chatId, full);
  const allLines = readFileSync(full, "utf-8").split("\n");
  const total = allLines.length;
  const start = Math.max(0, (typeof args.offset === "number" ? args.offset : 1) - 1);
  const requested = typeof args.limit === "number" && args.limit > 0 ? args.limit : MAX_READ_LINES;
  const end = Math.min(start + Math.min(requested, MAX_READ_LINES), total);
  const body = allLines.slice(start, end).map((l, i) => `${start + i + 1}: ${clampLine(l)}`).join("\n");
  const note = end < total ? `\n\n… [showing lines ${start + 1}-${end} of ${total}. Pass offset/limit to read more.]` : "";
  return clampOutput(body + note) || "(empty file)";
}

async function runWrite(args: Record<string, unknown>, chatId: string): Promise<string> {
  const rel = String(args.filepath || "");
  const full = toolPath(chatId, rel);
  const stale = existsSync(full) ? checkFileStaleness(chatId, full) : null;
  const content = String(args.content ?? "");
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content, "utf-8");
  trackFileRead(chatId, full);
  const prefix = stale ? `${stale}\n\n` : "";
  return prefix + writtenReport(full, chatId, "File written") + (await diagnosticsSuffix(full, rel, content));
}

function countOccurrences(haystack: string, needle: string): number {
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    n++;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}

// When nothing matches, point the model at the closest region so it can fix the
// edit in one retry instead of guessing repeatedly.
function nearMatchHint(content: string, oldStr: string): string {
  const firstLine = oldStr.replace(/\r\n/g, "\n").split("\n").map((l) => l.trim()).find(Boolean);
  if (!firstLine || firstLine.length < 4) return "";
  const lines = content.split("\n");
  let idx = lines.findIndex((l) => l.trim() === firstLine);
  if (idx === -1) idx = lines.findIndex((l) => l.includes(firstLine) || (firstLine.includes(l.trim()) && l.trim().length > 4));
  if (idx === -1) return "";
  const from = Math.max(0, idx - 1);
  const to = Math.min(lines.length, idx + 5);
  const snippet = lines.slice(from, to).map((l, i) => `${from + i + 1}: ${l}`).join("\n");
  return `\nClosest region in the file:\n${snippet}`;
}

// ── Robust multi-strategy edit matching ───────────────────────
// Applying an edit must survive the realistic ways a model's `old_str` drifts
// from the file: LF vs CRLF, leading-indent differences, trailing whitespace,
// collapsed inner spacing, and blank-line drift. We try progressively looser
// strategies and stop at the FIRST that yields a unique match — so we never
// pick a looser, riskier interpretation than necessary — preserving the file's
// real bytes (indentation/EOL) and re-indenting the replacement onto the matched
// block. This is the shared engine behind Edit, MultiEdit, and ApplyPatch.

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function leadingWhitespace(line: string): string {
  const m = line.match(/^[ \t]*/);
  return m ? m[0] : "";
}

// $-safe replacement: a function replacer means `$&`, `$1`, etc. in new text are
// inserted literally instead of being interpreted as substitution patterns.
function replaceOnce(haystack: string, find: string, to: string): string {
  return haystack.replace(find, () => to);
}

// Re-base the replacement's indentation onto the matched block: when the model
// indented old_str/new_str consistently but differently from the file, shift the
// new_str lines that share old_str's base indent to the matched block's indent.
function reindentReplacement(oldStr: string, matchedBlock: string, newStr: string): string {
  const oldFirst = oldStr.replace(/\r\n/g, "\n").split("\n").find((l) => l.trim() !== "");
  const matchedFirst = matchedBlock.split("\n").find((l) => l.trim() !== "");
  if (oldFirst === undefined || matchedFirst === undefined) return newStr;
  const fromIndent = leadingWhitespace(oldFirst);
  const toIndent = leadingWhitespace(matchedFirst);
  if (fromIndent === toIndent) return newStr;
  // Re-base every replacement line that carries old_str's base indent onto the
  // file's actual indent. When old_str had no base indent (fromIndent === ""),
  // every line "starts with" it, so the whole block gets indented to match —
  // the common case where the model writes unindented code into an indented file.
  return newStr
    .split("\n")
    .map((line) => (line.trim() === "" ? line : line.startsWith(fromIndent) ? toIndent + line.slice(fromIndent.length) : line))
    .join("\n");
}

type FuzzyLevel = 2 | 3 | 4 | 5;

// Build a tolerant RegExp for old_str at a given looseness level (or null).
function flexibleRegex(oldStr: string, level: FuzzyLevel): RegExp | null {
  const rawLines = oldStr.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  const linePattern = (line: string): string => {
    const trimmed = line.trim();
    if (trimmed === "") return "[ \\t]*";
    const core = level >= 3 ? trimmed.split(/\s+/).map(escapeRegExp).join("[ \\t]+") : escapeRegExp(trimmed);
    return `[ \\t]*${core}[ \\t]*`;
  };

  if (level === 5) {
    // Anchor on first + last non-blank line; tolerate interior drift. Multi-line
    // targets only, matched lazily so it can't run away.
    const nonBlank = rawLines.filter((l) => l.trim() !== "");
    if (nonBlank.length < 3) return null;
    try {
      return new RegExp(`${linePattern(nonBlank[0])}\\r?\\n[\\s\\S]*?\\r?\\n${linePattern(nonBlank[nonBlank.length - 1])}`, "g");
    } catch {
      return null;
    }
  }

  const lines = level >= 4 ? rawLines.filter((l) => l.trim() !== "") : rawLines;
  if (lines.length === 0 || !lines.some((l) => l.trim() !== "")) return null;
  const sep = level >= 4 ? "(?:[ \\t]*\\r?\\n)+" : "[ \\t]*\\r?\\n";
  try {
    return new RegExp(lines.map(linePattern).join(sep), "g");
  } catch {
    return null;
  }
}

const FUZZY_NOTES: Record<FuzzyLevel, string> = {
  2: "matched ignoring indentation, trailing whitespace, and line endings",
  3: "matched ignoring whitespace differences",
  4: "matched ignoring blank-line and whitespace differences",
  5: "matched on first/last line with interior drift tolerated — re-read to confirm the result",
};

type EditOutcome = { content: string; note?: string } | { error: string };

function applyFuzzyLevel(content: string, oldStr: string, newStr: string, replaceAll: boolean, level: FuzzyLevel, label: string): EditOutcome | null {
  if (level === 5 && content.length > 200_000) return null; // skip the costly anchor scan on huge files
  const re = flexibleRegex(oldStr, level);
  if (!re) return null;
  const matches = [...content.matchAll(re)].map((m) => m[0]).filter((m) => m.length > 0);
  const distinct = [...new Set(matches)];
  if (distinct.length === 0) return null;
  if (level === 5 && distinct.some((d) => d.length > oldStr.length * 4 + 400)) return null; // anchor ran away
  if (!replaceAll && distinct.length > 1) {
    return { error: `old_str has no exact match and ${distinct.length} near-matches in ${label}. Add more surrounding context to make it unique, or set replace_all: true.` };
  }
  let out = content;
  for (const block of distinct) {
    const to = reindentReplacement(oldStr, block, newStr);
    out = replaceAll ? out.split(block).join(to) : replaceOnce(out, block, to);
    if (!replaceAll) break;
  }
  return { content: out, note: FUZZY_NOTES[level] };
}

// One robust edit: exact → progressively looser fuzzy strategies → helpful error.
function applyStringEdit(content: string, oldStr: string, newStr: string, replaceAll: boolean, label: string): EditOutcome {
  if (!oldStr) return { error: `old_str cannot be empty (${label}).` };

  // Strategy 1 — exact bytes.
  if (content.includes(oldStr)) {
    if (replaceAll) return { content: content.split(oldStr).join(newStr) };
    const n = countOccurrences(content, oldStr);
    if (n > 1) return { error: `old_str is not unique in ${label} (${n} occurrences). Add surrounding context to make it unique, or set replace_all: true.` };
    return { content: replaceOnce(content, oldStr, newStr) };
  }

  // Strategies 2-5 — increasingly tolerant; the first that resolves wins.
  for (const level of [2, 3, 4, 5] as FuzzyLevel[]) {
    const result = applyFuzzyLevel(content, oldStr, newStr, replaceAll, level, label);
    if (result) return result;
  }

  return { error: `old_str not found in ${label} — match the file exactly, including whitespace.${nearMatchHint(content, oldStr)}` };
}

async function runEdit(args: Record<string, unknown>, chatId: string): Promise<string> {
  const rel = String(args.filepath || "");
  const full = toolPath(chatId, rel);
  if (!existsSync(full)) return `Error: file not found: ${rel}.${missingFileHint(full)}`;
  const stale = checkFileStaleness(chatId, full);
  const content = readFileSync(full, "utf-8");
  const result = applyStringEdit(content, String(args.old_str ?? ""), String(args.new_str ?? ""), args.replace_all === true, rel);
  if ("error" in result) return `Error: ${result.error}`;
  writeFileSync(full, result.content, "utf-8");
  trackFileRead(chatId, full);
  const prefix = stale ? `${stale}\n\n` : "";
  return prefix + writtenReport(full, chatId, `File edited${result.note ? ` (${result.note})` : ""}`) + (await diagnosticsSuffix(full, rel, result.content));
}

async function runMultiEdit(args: Record<string, unknown>, chatId: string): Promise<string> {
  const rel = String(args.filepath || "");
  const full = toolPath(chatId, rel);
  if (!existsSync(full)) return `Error: file not found: ${rel}.${missingFileHint(full)}`;
  const edits = (args.edits as Array<{ old_str: string; new_str: string; replace_all?: boolean }>) || [];
  let content = readFileSync(full, "utf-8");
  let fuzzy = 0;
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i];
    const result = applyStringEdit(content, String(e.old_str ?? ""), String(e.new_str ?? ""), e.replace_all === true, `${rel} (edit ${i + 1}/${edits.length})`);
    if ("error" in result) return `Error: ${result.error}`;
    content = result.content;
    if (result.note) fuzzy++;
  }
  writeFileSync(full, content, "utf-8");
  trackFileRead(chatId, full);
  return writtenReport(full, chatId, `File multi-edited (${edits.length} edits${fuzzy ? `, ${fuzzy} whitespace-tolerant` : ""})`) + (await diagnosticsSuffix(full, rel, content));
}

// ── ApplyPatch (V4A multi-file patch) ─────────────────────────
interface PatchOp {
  type: "update" | "add" | "delete";
  path: string;
  hunks: Array<{ oldText: string; newText: string }>;
  body: string;
}

function parseV4APatch(patch: string): { ops: PatchOp[] } | { error: string } {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  const beginIdx = lines.findIndex((l) => l.trim() === "*** Begin Patch");
  if (beginIdx === -1) return { error: "Patch must open with a '*** Begin Patch' line." };

  const ops: PatchOp[] = [];
  let current: PatchOp | null = null;
  let hunkOld: string[] = [];
  let hunkNew: string[] = [];

  const flushHunk = () => {
    if (current && current.type === "update" && (hunkOld.length || hunkNew.length)) {
      current.hunks.push({ oldText: hunkOld.join("\n"), newText: hunkNew.join("\n") });
    }
    hunkOld = [];
    hunkNew = [];
  };
  const flushOp = () => {
    flushHunk();
    if (current) ops.push(current);
    current = null;
  };

  for (let i = beginIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "*** End Patch") {
      flushOp();
      return { ops };
    }
    if (line.startsWith("*** Update File:")) {
      flushOp();
      current = { type: "update", path: line.slice("*** Update File:".length).trim(), hunks: [], body: "" };
      continue;
    }
    if (line.startsWith("*** Add File:")) {
      flushOp();
      current = { type: "add", path: line.slice("*** Add File:".length).trim(), hunks: [], body: "" };
      continue;
    }
    if (line.startsWith("*** Delete File:")) {
      flushOp();
      current = { type: "delete", path: line.slice("*** Delete File:".length).trim(), hunks: [], body: "" };
      continue;
    }
    if (!current) continue;
    if (current.type === "add") {
      if (line.startsWith("+")) current.body += (current.body ? "\n" : "") + line.slice(1);
      else if (trimmed === "") current.body += current.body ? "\n" : "";
      continue;
    }
    if (current.type === "update") {
      if (line.startsWith("@@")) {
        flushHunk();
        continue;
      }
      if (line.startsWith("+")) hunkNew.push(line.slice(1));
      else if (line.startsWith("-")) hunkOld.push(line.slice(1));
      else if (line.startsWith(" ")) {
        hunkOld.push(line.slice(1));
        hunkNew.push(line.slice(1));
      } else if (trimmed === "") {
        hunkOld.push("");
        hunkNew.push("");
      }
      // any other "*** ..." line is handled above; stray lines are ignored
    }
  }
  return { error: "Patch must close with a '*** End Patch' line." };
}

async function runApplyPatch(args: Record<string, unknown>, chatId: string): Promise<string> {
  const patch = String(args.patch ?? "");
  if (!patch.trim()) return "Error: ApplyPatch requires a `patch` in V4A format.";
  const parsed = parseV4APatch(patch);
  if ("error" in parsed) return `Error: ${parsed.error}`;
  if (!parsed.ops.length) return "Error: the patch contained no file operations (Update/Add/Delete File).";

  const root = resolvedRoot(chatId);
  const metaRoot = workspaceMetaRoot(chatId);
  // Stage everything first; only commit to disk if every op validates (atomic).
  const writes: Array<{ full: string; content: string; verb: string; rel: string }> = [];
  const deletes: Array<{ full: string; rel: string }> = [];

  for (const op of parsed.ops) {
    const full = resolveWorkspacePath(op.path, root, metaRoot);
    if (op.type === "delete") {
      if (!existsSync(full)) return `Error: cannot delete ${op.path} — file not found. No changes written.`;
      deletes.push({ full, rel: op.path });
      continue;
    }
    if (op.type === "add") {
      if (existsSync(full)) return `Error: cannot add ${op.path} — it already exists. Use an Update hunk or Edit. No changes written.`;
      writes.push({ full, content: op.body, verb: "added", rel: op.path });
      continue;
    }
    if (!existsSync(full)) return `Error: cannot update ${op.path} — file not found. No changes written.`;
    if (!op.hunks.length) return `Error: the update for ${op.path} had no hunks. No changes written.`;
    let content = readFileSync(full, "utf-8");
    for (let h = 0; h < op.hunks.length; h++) {
      const { oldText, newText } = op.hunks[h];
      const result = applyStringEdit(content, oldText, newText, false, `${op.path} (hunk ${h + 1}/${op.hunks.length})`);
      if ("error" in result) return `Error: ${result.error} No changes written.`;
      content = result.content;
    }
    writes.push({ full, content, verb: "updated", rel: op.path });
  }

  const summary: string[] = [];
  for (const w of writes) {
    mkdirSync(path.dirname(w.full), { recursive: true });
    writeFileSync(w.full, w.content, "utf-8");
    trackFileRead(chatId, w.full);
    summary.push(`${w.verb}: ${w.rel}`);
  }
  for (const d of deletes) {
    rmSync(d.full, { recursive: true, force: true });
    summary.push(`deleted: ${d.rel}`);
  }
  const count = writes.length + deletes.length;
  // Diagnose every written file; report the first files that have errors.
  let diagSuffix = "";
  for (const w of writes) {
    diagSuffix += await diagnosticsSuffix(w.full, w.rel, w.content);
  }
  return `Patch applied to ${count} file${count === 1 ? "" : "s"}:\n${summary.join("\n")}${diagSuffix}`;
}

function runDelete(args: Record<string, unknown>, chatId: string): string {
  const rel = String(args.path || "");
  if (!rel) return "Error: path is required";
  const full = toolPath(chatId, rel); // throws on protected OS roots
  if (!existsSync(full)) return `Nothing to delete — ${rel} does not exist.`;
  const isDir = statSync(full).isDirectory();
  if (isDir && args.recursive !== true && readdirSync(full).length > 0) {
    return `Error: ${rel} is a non-empty directory. Pass recursive:true to delete it and its contents.`;
  }
  rmSync(full, { recursive: true, force: true });
  return `Deleted ${isDir ? "directory" : "file"}: ${full}`;
}

function runMove(args: Record<string, unknown>, chatId: string): string {
  const srcRel = String(args.source || "");
  const dstRel = String(args.destination || "");
  if (!srcRel || !dstRel) return "Error: source and destination are required";
  const root = resolvedRoot(chatId);
  const metaRoot = workspaceMetaRoot(chatId);
  const from = resolveWorkspacePath(srcRel, root, metaRoot);
  const to = resolveWorkspacePath(dstRel, root, metaRoot); // both throw on protected OS roots
  if (!existsSync(from)) return `Error: source does not exist: ${srcRel}`;
  if (existsSync(to) && args.overwrite !== true) return `Error: destination already exists: ${dstRel}. Pass overwrite:true to replace it.`;
  mkdirSync(path.dirname(to), { recursive: true });
  if (existsSync(to)) rmSync(to, { recursive: true, force: true });
  try {
    renameSync(from, to);
  } catch {
    // Cross-device move (EXDEV): copy then remove the source.
    cpSync(from, to, { recursive: true, force: true });
    rmSync(from, { recursive: true, force: true });
  }
  return writtenReport(to, chatId, "Moved to");
}

// ── Glob / Grep with ripgrep, JS fallback ─────────────────────
function escapeGlobRegexChar(char: string): string {
  return "\\^$+?.()|[]{}-".includes(char) ? `\\${char}` : char;
}

function findBraceEnd(pattern: string, start: number): number {
  let depth = 0;
  for (let i = start; i < pattern.length; i++) {
    if (pattern[i] === "{") depth++;
    else if (pattern[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitBraceParts(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "{") depth++;
    else if (value[i] === "}") depth--;
    else if (value[i] === "," && depth === 0) {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function globToRegexSource(pattern: string): string {
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          source += "(?:[^/]+/)*";
          i += 2;
        } else {
          source += ".*";
          i++;
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else if (char === "{") {
      const end = findBraceEnd(pattern, i);
      if (end === -1) source += "\\{";
      else {
        const parts = splitBraceParts(pattern.slice(i + 1, end));
        source += `(?:${parts.map(globToRegexSource).join("|")})`;
        i = end;
      }
    } else {
      source += escapeGlobRegexChar(char);
    }
  }
  return source;
}

function globToRegex(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
  return new RegExp(`^${globToRegexSource(normalized)}$`, "i");
}

function walk(dir: string, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") || ["node_modules", ".next", "__pycache__", "dist", "build", "out"].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile()) out.push(full);
  }
  return out;
}

function runGlob(args: Record<string, unknown>, chatId: string): string {
  const searchPath = toolPath(chatId, String(args.path || "."));
  const pattern = String(args.pattern || "*");
  try {
    const res = execFileSync("rg", ["--files", "--glob", pattern, searchPath], { encoding: "utf-8", timeout: 10000, maxBuffer: 1 << 20 });
    const files = res.trim().split("\n").filter(Boolean).slice(0, 100);
    if (files.length) return files.map((f) => displayPath(chatId, f)).join("\n");
  } catch {
    /* fall back */
  }
  const matched = walk(searchPath)
    .filter((f) => globToRegex(pattern).test(path.relative(searchPath, f).replace(/\\/g, "/")))
    .slice(0, 100)
    .map((f) => displayPath(chatId, f));
  return matched.length ? matched.join("\n") : "No files found matching the pattern.";
}

function runGrep(args: Record<string, unknown>, chatId: string): string {
  const searchPath = toolPath(chatId, String(args.path || "."));
  const pattern = String(args.pattern || "");
  const mode = String(args.output_mode || "files_with_matches");
  try {
    const rgArgs: string[] = [];
    if (mode === "content") {
      rgArgs.push("--no-heading");
      if (args["-n"] !== false) rgArgs.push("-n");
    } else if (mode === "count") rgArgs.push("-c");
    else rgArgs.push("-l");
    if (args["-i"]) rgArgs.push("-i");
    if (args.glob) rgArgs.push("--glob", String(args.glob));
    rgArgs.push(pattern, searchPath);
    const res = execFileSync("rg", rgArgs, { encoding: "utf-8", timeout: 15000, maxBuffer: 1 << 20 });
    return clampOutput(res.trim()) || "No matches found.";
  } catch (err: unknown) {
    if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 1) return "No matches found.";
  }
  // JS fallback
  const re = new RegExp(pattern, args["-i"] ? "i" : "");
  const out: string[] = [];
  for (const file of walk(searchPath)) {
    let content: string;
    try {
      content = readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    const rel = displayPath(chatId, file);
    const lines = content.split(/\r?\n/);
    const hits = lines.map((l, i) => ({ l, i })).filter((x) => re.test(x.l));
    if (!hits.length) continue;
    if (mode === "files_with_matches") out.push(rel);
    else if (mode === "count") out.push(`${rel}:${hits.length}`);
    else hits.forEach((h) => out.push(`${rel}:${h.i + 1}:${clampLine(h.l)}`));
  }
  return clampOutput(out.join("\n")) || "No matches found.";
}

function runLs(args: Record<string, unknown>, chatId: string): string {
  const target = toolPath(chatId, String(args.path || "."));
  const entries = readdirSync(target, { withFileTypes: true }).sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  const max = 400;
  const shown = entries.slice(0, max).map((e) => `${e.isDirectory() ? "dir  " : "file "}${e.name}`).join("\n");
  const note = entries.length > max ? `\n\n… and ${entries.length - max} more (showing first ${max}).` : "";
  return `Contents of ${displayPath(chatId, target) || "."} (${entries.length} entries):\n\n${shown}${note}`;
}

async function runWebFetch(args: Record<string, unknown>, parentSignal?: AbortSignal): Promise<string> {
  const url = String(args.url || "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  parentSignal?.addEventListener("abort", () => controller.abort(), { once: true });
  try {
    const res = await fetch(url, {
      method: String(args.method || "GET"),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; VaultGate/1.0)", ...((args.headers as Record<string, string>) || {}) },
      body: args.body ? String(args.body) : undefined,
      signal: controller.signal,
    });
    const ct = res.headers.get("content-type") || "";
    let content: string;
    if (/json|text|html|xml/.test(ct)) {
      content = await res.text();
      if (content.length > 50000) content = content.slice(0, 50000) + "\n\n... (truncated)";
    } else {
      content = `[Binary content: ${ct}]`;
    }
    return `Status: ${res.status} ${res.statusText}\nContent-Type: ${ct}\n\n${content}`;
  } catch (err) {
    if (controller.signal.aborted) return "Error fetching URL: timed out or cancelled";
    return `Error fetching URL: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    clearTimeout(timer);
  }
}

// ── Web search (provider-independent, via DuckDuckGo) ─────────
interface WebResult {
  title: string;
  url: string;
  snippet: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

function unwrapDdgUrl(href: string): string {
  try {
    const u = new URL(decodeEntities(href), "https://duckduckgo.com");
    return u.searchParams.get("uddg") || u.href;
  } catch {
    return decodeEntities(href);
  }
}

function parseDdgHtml(html: string): WebResult[] {
  const out: WebResult[] = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const url = unwrapDdgUrl(m[1]);
    const title = stripTags(m[2]);
    const snippet = stripTags(m[4] || "");
    if (url && title) out.push({ title, url, snippet });
  }
  return out;
}

function parseDdgLite(html: string): WebResult[] {
  const out: WebResult[] = [];
  const re = /<a[^>]+class="result-link"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const url = unwrapDdgUrl(m[1]);
    const title = stripTags(m[2]);
    if (url && title) out.push({ title, url, snippet: "" });
  }
  return out;
}

async function runWebSearch(args: Record<string, unknown>, parentSignal?: AbortSignal): Promise<string> {
  const query = String(args.query || "").trim();
  if (!query) return "Error: No search query provided";
  const num = Math.max(1, Math.min(typeof args.num === "number" ? args.num : 8, 15));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  parentSignal?.addEventListener("abort", () => controller.abort(), { once: true });
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
  };

  try {
    let results: WebResult[] = [];
    try {
      const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { headers, signal: controller.signal });
      if (res.ok) results = parseDdgHtml(await res.text());
    } catch {
      /* fall through to lite endpoint */
    }
    if (results.length === 0) {
      const res = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, { headers, signal: controller.signal });
      if (res.ok) results = parseDdgLite(await res.text());
    }

    results = results.slice(0, num);
    if (results.length === 0) return `No web results found for "${query}". Try a different query, or use WebFetch on a known URL.`;

    return (
      `Web results for "${query}":\n\n` +
      results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ""}`).join("\n\n") +
      `\n\nUse WebFetch on any URL above to read the full page.`
    );
  } catch (err) {
    if (controller.signal.aborted) return "Error: web search timed out or was cancelled";
    return `Error performing web search: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    clearTimeout(timer);
  }
}

function optString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

// ── Kanban (durable task board) ───────────────────────────────
function runKanban(args: Record<string, unknown>, chatId: string): string {
  const action = String(args.action ?? "list").trim().toLowerCase();
  switch (action) {
    case "create": {
      const title = String(args.title ?? "").trim();
      if (!title) return "Error: Kanban action=create requires a title.";
      const card = createCard(chatId, title, { body: args.body, status: args.status, priority: args.priority });
      return `Created card ${card.id}.\n${formatCard(card)}`;
    }
    case "list":
      return formatBoard(listCards(chatId, args.status));
    case "show": {
      const id = String(args.id ?? "").trim();
      if (!id) return "Error: Kanban action=show requires a card id.";
      const card = getCard(chatId, id);
      return card ? formatCard(card) : `No card with id "${id}". Use action=list to see card ids.`;
    }
    case "update": {
      const id = String(args.id ?? "").trim();
      if (!id) return "Error: Kanban action=update requires a card id.";
      const r = updateCard(chatId, id, { title: optString(args.title), body: optString(args.body), status: args.status, priority: args.priority });
      return r.ok && r.card ? `Updated ${r.card.id}.\n${formatCard(r.card)}` : `Error: ${r.error}`;
    }
    case "comment": {
      const id = String(args.id ?? "").trim();
      const comment = String(args.comment ?? "").trim();
      if (!id || !comment) return "Error: Kanban action=comment requires a card id and a comment.";
      const r = commentCard(chatId, id, comment);
      return r.ok && r.card ? `Commented on ${r.card.id}.` : `Error: ${r.error}`;
    }
    case "link": {
      const id = String(args.id ?? "").trim();
      const blockedBy = Array.isArray(args.blocked_by) ? (args.blocked_by as unknown[]).map((b) => String(b)) : [];
      if (!id || !blockedBy.length) return "Error: Kanban action=link requires a card id and blocked_by ids.";
      const r = linkCard(chatId, id, blockedBy);
      return r.ok && r.card ? `Linked ${r.card.id}.\n${formatCard(r.card)}` : `Error: ${r.error}`;
    }
    case "delete": {
      const id = String(args.id ?? "").trim();
      if (!id) return "Error: Kanban action=delete requires a card id.";
      const r = deleteCard(chatId, id);
      return r.ok ? `Deleted card ${id}.` : `Error: ${r.error}`;
    }
    default:
      return `Error: unknown Kanban action '${action}'. Use create, list, show, update, comment, link, or delete.`;
  }
}

// ── RecallSessions (search the user's own past chats) ─────────
function snippetAround(content: string, query: string, span = 200): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  const idx = normalized.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return normalized.slice(0, span) + (normalized.length > span ? "…" : "");
  const start = Math.max(0, idx - Math.floor(span / 3));
  const end = Math.min(normalized.length, idx + query.length + Math.floor((span * 2) / 3));
  return `${start > 0 ? "…" : ""}${normalized.slice(start, end)}${end < normalized.length ? "…" : ""}`;
}

function clipText(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return day < 30 ? `${day}d ago` : new Date(ts).toISOString().slice(0, 10);
}

async function runRecallSessions(args: Record<string, unknown>, chatId: string): Promise<string> {
  const query = String(args.query ?? "").trim();
  const chatIdArg = String(args.chat_id ?? "").trim();
  const action = String(args.action ?? "").trim().toLowerCase() || (chatIdArg ? "read" : query ? "search" : "recent");
  const limit = typeof args.limit === "number" ? args.limit : 20;
  const includeCurrent = args.include_current === true;

  if (action === "read") {
    if (!chatIdArg) return "Error: RecallSessions action=read requires a chat_id (get one from action=list/recent/search).";
    const chat = await readChat(chatIdArg, limit > 20 ? limit : 40);
    if (!chat) return `No chat found with id "${chatIdArg}". Use action=list to see chat ids.`;
    const shown = chat.messages.length;
    const head = `Chat "${chat.title || "Untitled"}" (id ${chat.id}) — ${chat.total} message${chat.total === 1 ? "" : "s"}${shown < chat.total ? `, showing the latest ${shown}` : ""}${chat.id === chatId ? " (this is the current chat)" : ""}:`;
    const body = chat.messages.map((m) => `[${m.role} · ${new Date(m.createdAt).toLocaleString()}] ${clipText(m.content, 1200)}`).join("\n\n");
    return `${head}\n\n${body}`;
  }

  if (action === "list" || action === "recent") {
    let chats = await listChatSummaries();
    if (!includeCurrent) chats = chats.filter((c) => c.id !== chatId);
    if (!chats.length) return "No other chats found yet.";
    const total = chats.length;
    const rows = (action === "recent" ? chats.slice(0, Math.max(1, Math.min(limit, 50))) : chats).map(
      (c) => `- ${c.id} · "${c.title || "Untitled"}" — ${c.messageCount} msg${c.messageCount === 1 ? "" : "s"}, ${relTime(c.updatedAt)}${c.goal ? ` · goal: ${clipText(c.goal, 120)}` : ""}`,
    );
    const header = action === "recent" ? `Most recent chats (${rows.length} of ${total} total${includeCurrent ? "" : ", excluding this one"}):` : `You have ${total} chat${total === 1 ? "" : "s"}${includeCurrent ? "" : " besides this one"}:`;
    return `${header}\n${rows.join("\n")}\n\nUse action=read with a chat_id to open any of these (live, even if it is still running).`;
  }

  // search
  if (!query) return "Error: RecallSessions action=search requires a query.";
  const hits = await searchMessages(query, { limit, excludeChatId: includeCurrent ? undefined : chatId });
  if (!hits.length) return `No messages matched "${query}". Try action=list to browse all chats, or a different keyword.`;
  const lines = hits.map((h) => `- ${h.chatId} · "${h.chatTitle || "Untitled"}" [${relTime(h.createdAt)}] ${h.role}: ${snippetAround(h.content, query)}`);
  return `Found ${hits.length} match${hits.length === 1 ? "" : "es"} for "${query}":\n${lines.join("\n")}\n\nUse action=read with one of these chat_ids to see the full conversation.`;
}

// ── MultiModel (fan-out + synthesis) ──────────────────────────
async function chatOnce(endpoint: string, apiKey: string, model: string, system: string, user: string, signal?: AbortSignal): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const messages = system ? [{ role: "system", content: system }, { role: "user", content: user }] : [{ role: "user", content: user }];
  try {
    const res = await fetch(`${endpoint.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify({ model, messages, stream: false, temperature: 0.7 }),
    });
    if (!res.ok) return `[error ${res.status}]`;
    const json = (await res.json()) as Record<string, unknown>;
    const content = ((json.choices as Array<Record<string, unknown>>)?.[0]?.message as Record<string, unknown>)?.content;
    return typeof content === "string" && content.trim() ? content.trim() : "(empty response)";
  } catch (err) {
    return `[error: ${err instanceof Error ? err.message : String(err)}]`;
  }
}

async function runMultiModel(args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  const prompt = String(args.prompt ?? "").trim();
  if (!prompt) return "Error: MultiModel requires a prompt.";
  const provider = await getChatProvider();
  if (!provider.endpoint) return "Error: no provider is configured. Add one in Settings before using MultiModel.";

  let models = Array.isArray(args.models) ? (args.models as unknown[]).map((m) => String(m).trim()).filter(Boolean) : [];
  if (!models.length) {
    const pool = provider.models.length ? provider.models : provider.model ? [provider.model] : [];
    models = [...new Set([provider.model, ...pool].filter(Boolean))].slice(0, 3);
  }
  if (!models.length) return "Error: no models are available to query. Pass `models` explicitly or configure models in Settings.";

  const system = String(args.system ?? "").trim();
  const answers = await Promise.all(models.map((m) => chatOnce(provider.endpoint, provider.apiKey, m, system, prompt, signal)));
  const panel = models.map((m, i) => `### ${m}\n${answers[i]}`).join("\n\n");

  if (models.length === 1) return `MultiModel (1 model):\n\n${panel}`;

  const synthModel = provider.model || models[0];
  const synthInput = `Original question:\n${prompt}\n\nCandidate answers from ${models.length} models:\n\n${panel}\n\nWrite the single best answer. Reconcile agreements, resolve contradictions in favor of the most accurate/verifiable claim, and note any remaining uncertainty briefly.`;
  const synthesis = await chatOnce(provider.endpoint, provider.apiKey, synthModel, "You synthesize multiple AI answers into one accurate, decisive response. Be concise and correct.", synthInput, signal);
  return `MultiModel across ${models.length} models:\n\n${panel}\n\n---\n\n## Synthesis (${synthModel})\n${synthesis}`;
}

// ── Schedule (durable cron-style jobs) ────────────────────────
function runSchedule(args: Record<string, unknown>, chatId: string): string {
  resumeSchedulerIfNeeded();
  const action = String(args.action ?? "list").trim().toLowerCase();
  if (action === "create") {
    const prompt = String(args.prompt ?? "").trim();
    if (!prompt) return "Error: Schedule action=create requires a prompt describing the work to run.";
    const delayMs = typeof args.delay_seconds === "number" ? Math.floor(args.delay_seconds * 1000) : undefined;
    const intervalMs = typeof args.interval_seconds === "number" ? Math.floor(args.interval_seconds * 1000) : undefined;
    const r = createJob({ chatId, prompt, title: optString(args.title), delayMs, intervalMs, repeat: intervalMs !== undefined });
    return r.ok && r.job ? `Scheduled job ${r.job.id}.\n${formatJob(r.job)}\nIt will run in this chat's workspace and post the result here when due.` : `Error: ${r.error}`;
  }
  if (action === "list") {
    const jobs = listJobs(chatId);
    return jobs.length ? `Scheduled jobs for this chat:\n${jobs.map(formatJob).join("\n")}` : "No scheduled jobs for this chat.";
  }
  if (action === "cancel") {
    const id = String(args.id ?? "").trim();
    if (!id) return "Error: Schedule action=cancel requires a job id (see action=list).";
    const r = cancelJob(id);
    return r.ok ? `Cancelled scheduled job ${id}.` : `Error: ${r.error}`;
  }
  return `Error: unknown Schedule action '${action}'. Use create, list, or cancel.`;
}

// ── XSearch (X / Twitter / social search) ─────────────────────
async function runXSearch(args: Record<string, unknown>, parentSignal?: AbortSignal): Promise<string> {
  const query = String(args.query ?? "").trim();
  if (!query) return "Error: XSearch requires a query.";
  const num = Math.max(1, Math.min(typeof args.num === "number" ? args.num : 8, 15));
  const scoped = `${query} (site:x.com OR site:twitter.com OR site:nitter.net)`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  parentSignal?.addEventListener("abort", () => controller.abort(), { once: true });
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
  };
  try {
    let results: WebResult[] = [];
    try {
      const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(scoped)}`, { headers, signal: controller.signal });
      if (res.ok) results = parseDdgHtml(await res.text());
    } catch {
      /* fall through to lite */
    }
    if (results.length === 0) {
      const res = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(scoped)}`, { headers, signal: controller.signal });
      if (res.ok) results = parseDdgLite(await res.text());
    }
    results = results.slice(0, num);
    if (results.length === 0) return `No X/social results found for "${query}". Try WebSearch for broader coverage.`;
    return (
      `X / social results for "${query}":\n\n` +
      results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ""}`).join("\n\n") +
      `\n\nUse WebFetch on any URL above to read the full post/thread.`
    );
  } catch (err) {
    if (controller.signal.aborted) return "Error: X search timed out or was cancelled";
    return `Error performing X search: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    clearTimeout(timer);
  }
}

function runTodoWrite(args: Record<string, unknown>, chatId: string): string {
  const todos = Array.isArray(args.todos) ? args.todos : [];
  todoStore.set(chatId, todos);
  try {
    const file = todoPath(chatId);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ todos, updatedAt: new Date().toISOString() }, null, 2), "utf-8");
  } catch {
    return `Todo list updated with ${todos.length} task${todos.length === 1 ? "" : "s"} (memory only; durable write failed).`;
  }
  return `Todo list updated with ${todos.length} task${todos.length === 1 ? "" : "s"}.`;
}

export function getTodos(chatId: string): unknown[] {
  const cached = todoStore.get(chatId);
  if (cached) return cached;
  try {
    const parsed = JSON.parse(readFileSync(todoPath(chatId), "utf-8")) as { todos?: unknown[] };
    const todos = Array.isArray(parsed.todos) ? parsed.todos : [];
    todoStore.set(chatId, todos);
    return todos;
  } catch {
    return [];
  }
}

function todoPath(chatId: string): string {
  return workspaceMetaPath(chatId, "todos.json");
}
