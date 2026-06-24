// Persistent workspace execution runtime (server-only).
//
// This is a compatibility layer around the local process model: tools call
// workspaceExecute(), but foreground commands run through a provider-style
// runtime that behaves like ONE persistent shell session — exactly how Claude
// Code's Bash tool works. After each command we capture the final `$PWD` and
// safe exported env vars and persist them (state.json), so the NEXT command
// resumes in the same directory with the same env. `cd subdir` therefore sticks
// across tool calls; the only reset is the safety snap-back to the workspace
// root if a captured cwd ends up outside the workspace (see normalizeCwd).
import "server-only";
import { spawn } from "node:child_process";
import path from "node:path";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { assertInside, workspaceMetaPath, workspaceMetaRoot } from "./paths";
import { resolvedRoot } from "./resolved-roots";
import { buildEnv, isSecretEnvKey, killProcessTree, psQuote, windowsShell, wrapWindowsCommand } from "./process";

export interface RuntimeExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface RuntimeExecOptions {
  timeout?: number;
  signal?: AbortSignal;
  onOutput?: (chunk: string, stream: "stdout" | "stderr") => void;
}

interface RuntimeState {
  version: number;
  provider: string;
  chatId: string;
  rootDir: string;
  cwd: string;
  env: Record<string, string>;
  createdAt: string;
  lastUsedAt: string;
  commandCount: number;
}

interface CapturedRuntimeState {
  cwd?: string;
  env?: Record<string, string>;
  exitCode?: number;
  capturedAt?: string;
}

export interface RuntimeStatus {
  provider: string;
  cwd: string;
  relativeCwd: string;
  persistedEnvKeys: string[];
  lastUsedAt: string;
  commandCount: number;
}

export interface WorkspaceRuntimeProvider {
  name: string;
  execute(chatId: string, root: string, command: string, options?: RuntimeExecOptions): Promise<RuntimeExecResult>;
  launchContext(chatId: string): { cwd: string; env: NodeJS.ProcessEnv };
  status(chatId: string): RuntimeStatus | null;
}

const STATE_VERSION = 2;
const PROVIDER_NAME = "local-workspace-shell";
const RUNTIME_DIR = "runtime";
const STATE_FILE = "state.json";
const CAPTURE_HELPER = "capture-state.cjs";
const MAX_ENV_KEYS = 200;
const MAX_ENV_VALUE_LENGTH = 8192;
const runtimeQueues = new Map<string, Promise<void>>();
const VOLATILE_ENV_KEYS = new Set([
  "_",
  "?",
  "OLDPWD",
  "PWD",
  "SHLVL",
  "RANDOM",
  "SECONDS",
  "LASTEXITCODE",
  "PSMODULEPATH",
]);

function runtimeDir(chatId: string): string {
  return workspaceMetaPath(chatId, RUNTIME_DIR);
}

function runtimeStatePath(chatId: string): string {
  return path.join(runtimeDir(chatId), STATE_FILE);
}

function now(): string {
  return new Date().toISOString();
}

function defaultState(root: string, chatId: string): RuntimeState {
  const ts = now();
  return {
    version: STATE_VERSION,
    provider: PROVIDER_NAME,
    chatId,
    rootDir: root,
    cwd: root,
    env: {},
    createdAt: ts,
    lastUsedAt: ts,
    commandCount: 0,
  };
}

function readRuntimeState(root: string, chatId: string): RuntimeState {
  try {
    const parsed = JSON.parse(readFileSync(runtimeStatePath(chatId), "utf-8")) as Partial<RuntimeState>;
    if (parsed.version === STATE_VERSION && parsed.provider === PROVIDER_NAME && parsed.cwd) {
      return {
        ...defaultState(root, chatId),
        ...parsed,
        chatId,
        rootDir: root,
        cwd: normalizeCwd(root, parsed.cwd),
        env: sanitizeRuntimeEnv(root, chatId, parsed.env || {}, parsed.env || {}),
      };
    }
  } catch {
    /* missing/corrupt state falls back to a fresh runtime */
  }
  return defaultState(root, chatId);
}

function writeRuntimeState(chatId: string, state: RuntimeState): void {
  mkdirSync(runtimeDir(chatId), { recursive: true });
  writeFileSync(runtimeStatePath(chatId), JSON.stringify(state, null, 2), "utf-8");
}

function normalizeCwd(root: string, cwd: string | undefined): string {
  try {
    if (!cwd) return root;
    const resolved = path.resolve(/* turbopackIgnore: true */ cwd);
    if (!existsSync(resolved)) return root;
    return assertInside(root, resolved);
  } catch {
    return root;
  }
}

function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  if (env[key] !== undefined) return String(env[key]);
  if (process.platform !== "win32") return undefined;
  const found = Object.keys(env).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
  return found ? String(env[found]) : undefined;
}

function shouldPersistEnvKey(key: string, value: string): boolean {
  if (!key || isSecretEnvKey(key)) return false;
  if (key.toUpperCase() === "NODE_ENV" && !["development", "production", "test"].includes(value)) return false;
  if (VOLATILE_ENV_KEYS.has(key.toUpperCase())) return false;
  if (key.toUpperCase().startsWith("VAULTGATE_")) return false;
  if (value.length > MAX_ENV_VALUE_LENGTH) return false;
  if (/[\0=]/.test(key)) return false;
  return true;
}

function sanitizeRuntimeEnv(root: string, chatId: string, captured: Record<string, string>, previous: Record<string, string>): Record<string, string> {
  const base = buildEnv(root, { VAULTGATE_CHAT_ID: chatId }, workspaceMetaRoot(chatId));
  const next: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(captured)) {
    const value = String(rawValue ?? "");
    if (!shouldPersistEnvKey(key, value)) continue;
    const baseValue = envValue(base, key);
    if (baseValue === value && previous[key] === undefined) continue;
    next[key] = value;
    if (Object.keys(next).length >= MAX_ENV_KEYS) break;
  }
  return next;
}

function runtimeEnv(root: string, chatId: string, state: RuntimeState): NodeJS.ProcessEnv {
  return buildEnv(root, { ...state.env, VAULTGATE_CHAT_ID: chatId }, workspaceMetaRoot(chatId));
}

function helperPath(chatId: string): string {
  return path.join(runtimeDir(chatId), CAPTURE_HELPER);
}

function ensureCaptureHelper(chatId: string): string {
  const file = helperPath(chatId);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    `const { writeFileSync, mkdirSync } = require("node:fs");
const { dirname } = require("node:path");
const [file, cwd, code] = process.argv.slice(2);
const out = { cwd, exitCode: Number(code || 0), env: process.env, capturedAt: new Date().toISOString() };
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify(out), "utf-8");
`,
    "utf-8",
  );
  return file;
}

function shSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function writeExecutable(file: string, content: string): void {
  writeFileSync(file, content, "utf-8");
  try {
    chmodSync(file, 0o755);
  } catch {
    /* Windows does not need chmod. */
  }
}

function prepareBashScript(root: string, chatId: string, state: RuntimeState, command: string): { shell: string; args: string[]; captureFile: string; scriptFile: string } {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = runtimeDir(chatId);
  mkdirSync(dir, { recursive: true });
  const helper = ensureCaptureHelper(chatId);
  const scriptFile = path.join(dir, `run-${id}.sh`);
  const captureFile = path.join(dir, `capture-${id}.json`);
  const cwd = normalizeCwd(root, state.cwd);

  writeExecutable(
    scriptFile,
    `#!/usr/bin/env bash
set +e
__vg_capture=${shSingleQuote(captureFile)}
__vg_node=${shSingleQuote(process.execPath)}
__vg_helper=${shSingleQuote(helper)}
__vg_capture_state() {
  local __vg_status="$?"
  "$__vg_node" "$__vg_helper" "$__vg_capture" "$PWD" "$__vg_status" >/dev/null 2>&1 || true
  exit "$__vg_status"
}
trap __vg_capture_state EXIT
cd ${shSingleQuote(cwd)} || cd ${shSingleQuote(root)} || exit 1
${command}
`,
  );

  return { shell: "bash", args: ["-lc", 'source "$1"', "vaultgate-runtime", scriptFile], captureFile, scriptFile };
}

function preparePowerShellScript(root: string, chatId: string, state: RuntimeState, command: string): { shell: string; args: string[]; captureFile: string; scriptFile: string } {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = runtimeDir(chatId);
  mkdirSync(dir, { recursive: true });
  const helper = ensureCaptureHelper(chatId);
  const scriptFile = path.join(dir, `run-${id}.ps1`);
  const captureFile = path.join(dir, `capture-${id}.json`);
  const cwd = normalizeCwd(root, state.cwd);

  writeFileSync(
    scriptFile,
    `$__vgCapture = ${psQuote(captureFile)}
$__vgNode = ${psQuote(process.execPath)}
$__vgHelper = ${psQuote(helper)}
$__vgStatus = 0
function __VaultGateCapture([int]$code) {
  try { & $__vgNode $__vgHelper $__vgCapture (Get-Location).Path $code *> $null } catch {}
}
try {
  Set-Location -LiteralPath ${psQuote(cwd)}
  $global:LASTEXITCODE = 0
  & {
${wrapWindowsCommand(root, command, workspaceMetaRoot(chatId))}
  }
  if ($global:LASTEXITCODE -is [int]) { $__vgStatus = [int]$global:LASTEXITCODE }
  elseif ($?) { $__vgStatus = 0 }
  else { $__vgStatus = 1 }
} catch {
  Write-Error $_
  $__vgStatus = 1
} finally {
  __VaultGateCapture $__vgStatus
}
exit $__vgStatus
`,
    "utf-8",
  );

  return { shell: windowsShell(), args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptFile], captureFile, scriptFile };
}

function readCapture(captureFile: string): CapturedRuntimeState | null {
  try {
    return JSON.parse(readFileSync(captureFile, "utf-8")) as CapturedRuntimeState;
  } catch {
    return null;
  }
}

function persistCapture(root: string, chatId: string, state: RuntimeState, capture: CapturedRuntimeState | null): RuntimeState {
  const next: RuntimeState = {
    ...state,
    cwd: normalizeCwd(root, capture?.cwd),
    env: capture?.env ? sanitizeRuntimeEnv(root, chatId, capture.env, state.env) : state.env,
    lastUsedAt: now(),
    commandCount: state.commandCount + 1,
  };
  writeRuntimeState(chatId, next);
  return next;
}

function cleanupRunFiles(files: string[]): void {
  for (const file of files) {
    try {
      rmSync(file, { force: true });
    } catch {
      /* best effort */
    }
  }
}

async function withRuntimeLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = runtimeQueues.get(key) ?? Promise.resolve();
  let release = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chain = previous.catch(() => undefined).then(() => current);
  runtimeQueues.set(key, chain);
  await previous.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (runtimeQueues.get(key) === chain) runtimeQueues.delete(key);
  }
}

function legacyDirectExecute(chatId: string, root: string, command: string, options: RuntimeExecOptions, reason: string): Promise<RuntimeExecResult> {
  return new Promise<RuntimeExecResult>((resolve) => {
    let stdout = "";
    let stderr = `Runtime provider fallback: ${reason}\n`;
    let settled = false;
    const isWin = process.platform === "win32";
    const shell = isWin ? windowsShell() : "bash";
    const args = isWin ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", wrapWindowsCommand(root, command, workspaceMetaRoot(chatId))] : ["-lc", command];
    const child = spawn(shell, args, { cwd: root, env: buildEnv(root, { VAULTGATE_CHAT_ID: chatId }, workspaceMetaRoot(chatId)), detached: process.platform !== "win32" });

    const finish = (res: RuntimeExecResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve(res);
    };

    const timer = setTimeout(() => {
      killProcessTree(child.pid);
      finish({ exitCode: 1, stdout, stderr: `${stderr}\nCommand timed out`, timedOut: true });
    }, options.timeout ?? 120000);

    const onAbort = () => {
      killProcessTree(child.pid);
      finish({ exitCode: 1, stdout, stderr: `${stderr}\nCommand cancelled`, timedOut: false });
    };

    if (options.signal?.aborted) {
      finish({ exitCode: 1, stdout: "", stderr: "Command cancelled", timedOut: false });
      return;
    }

    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout?.on("data", (d: Buffer) => {
      const chunk = d.toString();
      stdout += chunk;
      options.onOutput?.(chunk, "stdout");
    });
    child.stderr?.on("data", (d: Buffer) => {
      const chunk = d.toString();
      stderr += chunk;
      options.onOutput?.(chunk, "stderr");
    });
    child.on("close", (code) => finish({ exitCode: code ?? 1, stdout, stderr, timedOut: false }));
    child.on("error", (err) => finish({ exitCode: 1, stdout, stderr: `${stderr}${err.message}`, timedOut: false }));
  });
}

async function executeLocalPersistentShell(chatId: string, root: string, command: string, options: RuntimeExecOptions = {}): Promise<RuntimeExecResult> {
  const state = readRuntimeState(root, chatId);
  let prepared: { shell: string; args: string[]; captureFile: string; scriptFile: string };

  try {
    prepared = process.platform === "win32" ? preparePowerShellScript(root, chatId, state, command) : prepareBashScript(root, chatId, state, command);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return legacyDirectExecute(chatId, root, command, options, reason);
  }

  return new Promise<RuntimeExecResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(prepared.shell, prepared.args, {
      cwd: normalizeCwd(root, state.cwd),
      env: runtimeEnv(root, chatId, state),
      detached: process.platform !== "win32",
    });

    const finish = (res: RuntimeExecResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      persistCapture(root, chatId, state, readCapture(prepared.captureFile));
      cleanupRunFiles([prepared.captureFile, prepared.scriptFile]);
      resolve(res);
    };

    const timer = setTimeout(() => {
      killProcessTree(child.pid);
      finish({ exitCode: 1, stdout, stderr: `${stderr}\nCommand timed out`, timedOut: true });
    }, options.timeout ?? 120000);

    const onAbort = () => {
      killProcessTree(child.pid);
      finish({ exitCode: 1, stdout, stderr: `${stderr}\nCommand cancelled`, timedOut: false });
    };

    if (options.signal?.aborted) {
      finish({ exitCode: 1, stdout: "", stderr: "Command cancelled", timedOut: false });
      return;
    }

    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout?.on("data", (d: Buffer) => {
      const chunk = d.toString();
      stdout += chunk;
      options.onOutput?.(chunk, "stdout");
    });
    child.stderr?.on("data", (d: Buffer) => {
      const chunk = d.toString();
      stderr += chunk;
      options.onOutput?.(chunk, "stderr");
    });
    child.on("close", (code) => finish({ exitCode: code ?? 1, stdout, stderr, timedOut: false }));
    child.on("error", (err) => finish({ exitCode: 1, stdout, stderr: err.message, timedOut: false }));
  });
}

function getLocalRuntimeLaunchContext(chatId: string): { cwd: string; env: NodeJS.ProcessEnv } {
  const root = resolvedRoot(chatId);
  const state = readRuntimeState(root, chatId);
  return { cwd: normalizeCwd(root, state.cwd), env: runtimeEnv(root, chatId, state) };
}

function readLocalRuntimeStatus(chatId: string): RuntimeStatus | null {
  const root = resolvedRoot(chatId);
  if (!existsSync(runtimeStatePath(chatId))) return null;
  const state = readRuntimeState(root, chatId);
  const relativeCwd = path.relative(root, state.cwd).replace(/\\/g, "/") || ".";
  return {
    provider: state.provider,
    cwd: state.cwd,
    relativeCwd,
    persistedEnvKeys: Object.keys(state.env).sort(),
    lastUsedAt: state.lastUsedAt,
    commandCount: state.commandCount,
  };
}

const localPersistentShellProvider: WorkspaceRuntimeProvider = {
  name: PROVIDER_NAME,
  execute: executeLocalPersistentShell,
  launchContext: getLocalRuntimeLaunchContext,
  status: readLocalRuntimeStatus,
};

export function activeRuntimeProvider(): WorkspaceRuntimeProvider {
  const requested = (process.env.VAULTGATE_RUNTIME_PROVIDER || PROVIDER_NAME).trim();
  // Unknown providers safely degrade to the stable local provider until a future
  // backend is registered behind this interface.
  return requested === PROVIDER_NAME ? localPersistentShellProvider : localPersistentShellProvider;
}

export function executeInWorkspaceRuntime(chatId: string, root: string, command: string, options: RuntimeExecOptions = {}): Promise<RuntimeExecResult> {
  const provider = activeRuntimeProvider();
  return withRuntimeLock(`${provider.name}:${chatId}`, () => provider.execute(chatId, root, command, options));
}

export function getRuntimeLaunchContext(chatId: string): { cwd: string; env: NodeJS.ProcessEnv } {
  return activeRuntimeProvider().launchContext(chatId);
}

export function readRuntimeStatus(chatId: string): RuntimeStatus | null {
  return activeRuntimeProvider().status(chatId);
}

export function runtimeSnapshot(chatId: string): string {
  const status = readRuntimeStatus(chatId);
  if (!status) return "Runtime: local workspace runtime has not executed a command yet.";
  const envKeys = status.persistedEnvKeys.length ? status.persistedEnvKeys.join(", ") : "none";
  return `Runtime: ${status.provider}; commands resume from ${status.relativeCwd}; persisted exported env keys: ${envKeys}; commands run: ${status.commandCount}; last used: ${status.lastUsedAt}.`;
}
