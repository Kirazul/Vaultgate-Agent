// ============================================================
// Durable scheduled jobs (server-only) — VaultGate's cron tool.
//
// Jobs persist to disk and a single guarded
// in-process ticker fires due jobs whenever the app is running, catching up
// missed runs on the next launch. A fired job runs a real autonomous agent
// turn (the same runner the Task tool uses) against its chat workspace and
// appends the result to that chat — so a schedule actually does the work,
// not just reminds.
// ============================================================
import "server-only";
import path from "node:path";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { getDataDir } from "@/lib/config/env";

export type JobStatus = "scheduled" | "done" | "cancelled" | "error";

export interface ScheduledJob {
  id: string;
  chatId: string;
  title: string;
  prompt: string;
  repeat: boolean;
  intervalMs?: number;
  nextRun: number;
  lastRun?: number;
  lastResult?: string;
  status: JobStatus;
  createdAt: number;
}

interface ScheduleStore {
  jobs: ScheduledJob[];
}

const MIN_INTERVAL_MS = 60_000;
const TICK_MS = 30_000;
const JOB_TIMEOUT_MS = 10 * 60_000;
const TICKER_KEY = Symbol.for("vaultgate.scheduleTicker");

function storePath(): string {
  const dir = path.join(getDataDir(), "schedule");
  mkdirSync(dir, { recursive: true });
  return path.join(dir, "jobs.json");
}

function load(): ScheduleStore {
  const file = storePath();
  if (!existsSync(file)) return { jobs: [] };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as Partial<ScheduleStore>;
    return { jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [] };
  } catch {
    return { jobs: [] };
  }
}

function save(store: ScheduleStore): void {
  const file = storePath();
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2), "utf-8");
  renameSync(tmp, file);
}

function newId(): string {
  try {
    return `job_${crypto.randomUUID().slice(0, 8)}`;
  } catch {
    return `job_${Date.now().toString(36)}`;
  }
}

export function createJob(opts: {
  chatId: string;
  prompt: string;
  title?: string;
  delayMs?: number;
  intervalMs?: number;
  repeat?: boolean;
}): { ok: boolean; job?: ScheduledJob; error?: string } {
  const prompt = opts.prompt.trim();
  if (!prompt) return { ok: false, error: "A scheduled job needs a prompt describing the work to run." };
  const repeat = opts.repeat === true || (typeof opts.intervalMs === "number" && opts.intervalMs > 0);
  const intervalMs = repeat ? Math.max(MIN_INTERVAL_MS, Math.floor(opts.intervalMs ?? MIN_INTERVAL_MS)) : undefined;
  const delayMs = Math.max(0, Math.floor(opts.delayMs ?? (intervalMs ?? MIN_INTERVAL_MS)));
  const now = Date.now();
  const job: ScheduledJob = {
    id: newId(),
    chatId: opts.chatId,
    title: (opts.title || prompt).trim().slice(0, 120),
    prompt: prompt.slice(0, 8000),
    repeat,
    intervalMs,
    nextRun: now + delayMs,
    status: "scheduled",
    createdAt: now,
  };
  const store = load();
  store.jobs.push(job);
  save(store);
  ensureScheduler();
  return { ok: true, job };
}

export function listJobs(chatId?: string): ScheduledJob[] {
  const jobs = load().jobs;
  const filtered = chatId ? jobs.filter((j) => j.chatId === chatId) : jobs;
  return filtered.slice().sort((a, b) => a.nextRun - b.nextRun);
}

export function cancelJob(id: string): { ok: boolean; error?: string } {
  const store = load();
  const job = store.jobs.find((j) => j.id === id.trim());
  if (!job) return { ok: false, error: `No scheduled job with id "${id}".` };
  job.status = "cancelled";
  save(store);
  return { ok: true };
}

export function formatJob(job: ScheduledJob): string {
  const when = new Date(job.nextRun).toISOString();
  const cadence = job.repeat && job.intervalMs ? `every ${Math.round(job.intervalMs / 1000)}s` : "once";
  const last = job.lastRun ? ` | last run ${new Date(job.lastRun).toISOString()}` : "";
  return `- ${job.id} [${job.status}] ${cadence}, next ${when}${last}: ${job.title}`;
}

// ── Ticker ────────────────────────────────────────────────────
// One interval per process, guarded by a global symbol so Next.js dev
// hot-reloads don't stack multiple tickers. Lazily started on first job
// creation; never started at import time so `next build` stays side-effect free.
function ensureScheduler(): void {
  const g = globalThis as unknown as Record<symbol, unknown>;
  if (g[TICKER_KEY]) return;
  const timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  if (typeof timer.unref === "function") timer.unref();
  g[TICKER_KEY] = timer;
}

let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const store = load();
    const now = Date.now();
    const due = store.jobs.filter((j) => j.status === "scheduled" && j.nextRun <= now);
    if (!due.length) return;
    // Reschedule/close out BEFORE running so a long job can't be double-fired.
    for (const job of due) {
      if (job.repeat && job.intervalMs) {
        let next = job.nextRun;
        while (next <= now) next += job.intervalMs;
        job.nextRun = next;
      } else {
        job.status = "done";
      }
    }
    save(store);
    for (const job of due) await runJob(job).catch(() => undefined);
  } finally {
    running = false;
  }
}

async function runJob(job: ScheduledJob): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), JOB_TIMEOUT_MS);
  let report: string;
  try {
    const { runSubAgentTask } = await import("@/lib/ai/agent");
    report = await runSubAgentTask(job.chatId, `Scheduled: ${job.title}`, job.prompt, {
      subagentType: "general",
      signal: controller.signal,
    });
  } catch (err) {
    report = `Scheduled job failed: ${err instanceof Error ? err.message : String(err)}`;
    markError(job.id, report);
  } finally {
    clearTimeout(timeout);
  }
  markRun(job.id, report);
  await postResult(job, report).catch(() => undefined);
}

function markRun(id: string, result: string): void {
  const store = load();
  const job = store.jobs.find((j) => j.id === id);
  if (!job) return;
  job.lastRun = Date.now();
  job.lastResult = result.slice(0, 4000);
  save(store);
}

function markError(id: string, result: string): void {
  const store = load();
  const job = store.jobs.find((j) => j.id === id);
  if (!job) return;
  job.status = "error";
  job.lastResult = result.slice(0, 4000);
  save(store);
}

async function postResult(job: ScheduledJob, report: string): Promise<void> {
  const { upsertMessage } = await import("@/lib/db/repo");
  const content = `Scheduled job "${job.title}" ran at ${new Date().toISOString()}:\n\n${report}`;
  await upsertMessage({
    id: `${job.id}-run-${Date.now()}`,
    chatId: job.chatId,
    role: "assistant",
    content,
    blocks: [{ type: "text", content }],
    status: "complete",
    createdAt: Date.now(),
  });
}

/** Resume the ticker if there are still-scheduled jobs (called on first tool use). */
export function resumeSchedulerIfNeeded(): void {
  if (load().jobs.some((j) => j.status === "scheduled")) ensureScheduler();
}
