// Workspace runtime setup (server-only).
// Creates workspace directories, installs CLI shims (bun→npm, python→py),
// and copies bundled skills. No SDK — tools execute directly via the agent.
import "server-only";
import path from "node:path";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { workspaceMetaRoot } from "./paths";

const RUNTIME_VERSION = "vaultgate-workspace-3.0.0-no-sdk";
const HISTORY_FILE = "history.jsonl";
const MANAGED_BIN_DIR = "bin";
const MANAGED_SKILLS_DIR = "skills";

function copyMissingRecursive(sourceDir: string, targetDir: string, overwrite = false): void {
  if (!existsSync(sourceDir)) return;
  const stat = statSync(sourceDir);
  if (!stat.isDirectory()) {
    if (overwrite || !existsSync(targetDir)) {
      mkdirSync(path.dirname(targetDir), { recursive: true });
      cpSync(sourceDir, targetDir, { force: true });
    }
    return;
  }
  mkdirSync(targetDir, { recursive: true });
  for (const entry of readdirSync(sourceDir)) {
    if (entry === "node_modules" || entry === ".git" || entry === "test-output") continue;
    copyMissingRecursive(path.join(sourceDir, entry), path.join(targetDir, entry), overwrite);
  }
}

function writeTextFileIfChanged(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    if (existsSync(filePath) && readFileSync(filePath, "utf-8") === content) return;
  } catch { /* rewrite unreadable files */ }
  writeFileSync(filePath, content, "utf-8");
}

function writeJsonFile(filePath: string, value: unknown): void {
  writeTextFileIfChanged(filePath, JSON.stringify(value, null, 2));
}

function writeExecutable(filePath: string, content: string): void {
  writeTextFileIfChanged(filePath, content);
  try { chmodSync(filePath, 0o755); } catch { /* Windows does not need chmod */ }
}

function samePath(a: string, b: string): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function removeDirIfEmpty(dir: string): void {
  try {
    if (existsSync(dir) && readdirSync(dir).length === 0) rmSync(dir, { recursive: true, force: true });
  } catch { /* ignore */ }
}

function cleanupLegacyRuntimeLayout(rootDir: string, metaRoot: string): void {
  for (const rel of ["vaultgate-production-workspace", ".vaultgate-production-runtime-version", ".vaultgate-config"]) {
    rmSync(path.join(rootDir, rel), { recursive: true, force: true });
  }
  const legacyMeta = path.join(rootDir, ".vaultgate");
  if (!samePath(legacyMeta, metaRoot)) {
    for (const name of ["runtime-bundle", "bin", "skills", "node_modules", "runtime", "bg", "history.jsonl", "devserver.json", "kanban.json", "todos.json", "workspace.json", "runtime-version", ".vaultgate-config"]) {
      const from = path.join(legacyMeta, name);
      if (!existsSync(from)) continue;
      const to = path.join(metaRoot, name);
      try {
        if (statSync(from).isDirectory()) {
          copyMissingRecursive(from, to, false);
          rmSync(from, { recursive: true, force: true });
        } else {
          mkdirSync(path.dirname(to), { recursive: true });
          if (!existsSync(to)) cpSync(from, to, { force: false });
          rmSync(from, { force: true });
        }
      } catch { /* leave ambiguous user files in place */ }
    }
    removeDirIfEmpty(legacyMeta);
  }
  const legacySkills = path.join(rootDir, "skills");
  if (existsSync(legacySkills)) {
    copyMissingRecursive(legacySkills, path.join(metaRoot, MANAGED_SKILLS_DIR), true);
    rmSync(legacySkills, { recursive: true, force: true });
  }
  // Clean up old SDK/bin artifacts from previous runtime versions
  const legacyBin = path.join(rootDir, "bin");
  if (existsSync(legacyBin)) {
    for (const name of ["vaultgate", "vaultgate.cmd", "vaultgate.js", "vaultgate-sdk", "vaultgate-sdk.cmd", "vaultgate-sdk.js", "vaultgate-workspace", "vaultgate-workspace.cmd", "vaultgate-workspace.js", "vaultgate-history", "vaultgate-history.cmd", "bun", "bun.cmd", "bun.js", "bunx", "bunx.cmd", "bunx.js", "python.cmd", "python3.cmd", "pip.cmd", "pip3.cmd", "python", "pip"]) {
      rmSync(path.join(legacyBin, name), { force: true });
    }
    try { if (readdirSync(legacyBin).length === 0) rmSync(legacyBin, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  // Clean up old runtime-bundle (SDK) directory
  rmSync(path.join(metaRoot, "runtime-bundle"), { recursive: true, force: true });
  rmSync(path.join(metaRoot, "node_modules"), { recursive: true, force: true });
}

function createCliWrappers(metaRoot: string): void {
  const binDir = path.join(metaRoot, MANAGED_BIN_DIR);

  // vaultgate-workspace: prints workspace metadata & reads terminal history
  writeExecutable(
    path.join(binDir, "vaultgate-workspace.js"),
    `#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
const root = process.env.VAULTGATE_WORKSPACE_ROOT || process.cwd();
const home = process.env.VAULTGATE_HOME || join(root, ".vaultgate");
const historyPath = join(home, "${HISTORY_FILE}");
const args = process.argv.slice(2);

function readHistory(limit = 20) {
  if (!existsSync(historyPath)) return [];
  const lines = readFileSync(historyPath, "utf-8").trim().split(/\\r?\\n/).filter(Boolean);
  return lines.slice(-limit).map((line) => {
    try { return JSON.parse(line); } catch { return { raw: line }; }
  });
}

if (args.includes("--help") || args.includes("-h")) {
  console.log("vaultgate-workspace: prints local workspace metadata. Use 'vaultgate-workspace history [limit]' to read recent terminal commands.");
  process.exit(0);
}

if (args[0] === "history" || args[0] === "last") {
  const limit = Number(args[1] || 20);
  console.log(JSON.stringify(readHistory(Number.isFinite(limit) ? limit : 20), null, 2));
  process.exit(0);
}

console.log(JSON.stringify({ root, vaultgateHome: home, skills: join(home, "${MANAGED_SKILLS_DIR}"), terminalHistory: historyPath, commands: ["vaultgate-workspace", "vaultgate-history", "bun", "bunx", "python", "python3", "pip", "pip3"] }, null, 2));
`,
  );
  writeExecutable(path.join(binDir, "vaultgate-workspace"), `#!/usr/bin/env sh\nDIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec node "$DIR/vaultgate-workspace.js" "$@"\n`);
  writeExecutable(path.join(binDir, "vaultgate-workspace.cmd"), `@echo off\r\nnode "%~dp0vaultgate-workspace.js" %*\r\n`);
  writeExecutable(path.join(binDir, "vaultgate-history"), `#!/usr/bin/env sh\nDIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec node "$DIR/vaultgate-workspace.js" history "$@"\n`);
  writeExecutable(path.join(binDir, "vaultgate-history.cmd"), `@echo off\r\nnode "%~dp0vaultgate-workspace.js" history %*\r\n`);

  // bun → npm shim
  writeExecutable(
    path.join(binDir, "bun.js"),
    `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
const rawArgs = process.argv.slice(2);
const cwd = process.cwd();

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.error) { console.error(result.error.message); process.exit(1); }
  process.exit(result.status ?? 0);
}

function packageScripts() {
  try { const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf-8")); return pkg?.scripts ?? {}; } catch { return {}; }
}

function normalizeInstallArgs(args) { return args.filter((arg) => arg !== "--frozen-lockfile" && arg !== "--no-save"); }

if (rawArgs.length === 0 || rawArgs.includes("--help") || rawArgs.includes("-h")) {
  console.log("bun shim: maps common bun commands to npm.");
  process.exit(0);
}
if (rawArgs[0] === "--version" || rawArgs[0] === "-v") { console.log("1.0.0-npm-shim"); process.exit(0); }

const [command, ...rest] = rawArgs;
if (command === "install" || command === "i") {
  const args = normalizeInstallArgs(rest);
  if (rawArgs.includes("--frozen-lockfile") && existsSync(join(cwd, "package-lock.json"))) run("npm", ["ci", ...args]);
  run("npm", ["install", ...args]);
}
if (command === "add") run("npm", ["install", ...normalizeInstallArgs(rest)]);
if (command === "remove" || command === "rm") run("npm", ["uninstall", ...rest]);
if (command === "update" || command === "upgrade") run("npm", ["update", ...rest]);
if (command === "run") {
  if (rest.length === 0) run("npm", ["run"]);
  const script = rest[0];
  const scriptArgs = rest.slice(1);
  run("npm", ["run", script, ...(scriptArgs.length ? ["--", ...scriptArgs] : [])]);
}
if (packageScripts()[command]) run("npm", ["run", command, ...(rest.length ? ["--", ...rest] : [])]);
run("node", rawArgs);
`,
  );
  writeExecutable(path.join(binDir, "bun"), `#!/usr/bin/env sh\nDIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec node "$DIR/bun.js" "$@"\n`);
  writeExecutable(path.join(binDir, "bun.cmd"), "@echo off\r\nnode \"%~dp0bun.js\" %*\r\n");

  // bunx → npx shim
  writeExecutable(path.join(binDir, "bunx.js"), `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
const result = spawnSync("npx", process.argv.slice(2), { stdio: "inherit", shell: process.platform === "win32" });
if (result.error) { console.error(result.error.message); process.exit(1); }
process.exit(result.status ?? 0);
`);
  writeExecutable(path.join(binDir, "bunx"), `#!/usr/bin/env sh\nDIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec node "$DIR/bunx.js" "$@"\n`);
  writeExecutable(path.join(binDir, "bunx.cmd"), "@echo off\r\nnode \"%~dp0bunx.js\" %*\r\n");

  // Python shims
  writeExecutable(path.join(binDir, "python.cmd"), "@echo off\r\npy -3 %*\r\n");
  writeExecutable(path.join(binDir, "python3.cmd"), "@echo off\r\npy -3 %*\r\n");
  writeExecutable(path.join(binDir, "pip.cmd"), "@echo off\r\npy -3 -m pip %*\r\n");
  writeExecutable(path.join(binDir, "pip3.cmd"), "@echo off\r\npy -3 -m pip %*\r\n");
  writeExecutable(path.join(binDir, "python"), "#!/usr/bin/env sh\nexec python3 \"$@\"\n");
  writeExecutable(path.join(binDir, "pip"), "#!/usr/bin/env sh\nexec python3 -m pip \"$@\"\n");
}

export async function ensureWorkspaceRuntime(rootDir: string, chatId: string): Promise<void> {
  const metaRoot = workspaceMetaRoot(chatId);

  // Start lean: only create the workspace cwd and the bin/ shims the shell PATH
  // needs. Artifact folders (download/, upload/, plans/) are created on demand by
  // the tools that write to them — no empty scaffolding cluttering the workspace.
  mkdirSync(rootDir, { recursive: true });
  mkdirSync(metaRoot, { recursive: true });

  const stampPath = path.join(metaRoot, "runtime-version");
  const currentVersion = existsSync(stampPath) ? readFileSync(stampPath, "utf-8").trim() : "";
  const needsRefresh = currentVersion !== RUNTIME_VERSION;

  cleanupLegacyRuntimeLayout(rootDir, metaRoot);

  if (needsRefresh) {
    // Skills load from the bundled library (skillSearchDirs) — they are NOT
    // copied per-workspace, so no skills/ folder is scaffolded here.
    mkdirSync(path.dirname(stampPath), { recursive: true });
    writeTextFileIfChanged(stampPath, RUNTIME_VERSION);
  }

  createCliWrappers(metaRoot);

  writeJsonFile(path.join(metaRoot, "workspace.json"), {
    chatId,
    workspaceRoot: rootDir,
    vaultgateHome: metaRoot,
    terminalHistory: path.join(metaRoot, HISTORY_FILE),
    managedDir: metaRoot,
    commands: ["vaultgate-workspace", "vaultgate-history", "bun", "bunx", "python", "python3", "pip", "pip3"],
  });
}
