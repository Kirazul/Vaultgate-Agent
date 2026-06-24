// Shared host process helpers for workspace runtimes (server-only).
import "server-only";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

export function isSecretEnvKey(key: string): boolean {
  return /(API[_-]?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)/i.test(key);
}

export function buildEnv(root: string, overrides: Record<string, string> = {}, metaRoot = path.join(root, ".vaultgate")): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // Never leak host secrets into agent-run commands.
  for (const key of Object.keys(env)) {
    if (isSecretEnvKey(key)) delete env[key];
    // Drop any non-standard NODE_ENV (including empty string), which makes Next
    // warn and behave inconsistently. Only development/production/test survive.
    if (key.toUpperCase() === "NODE_ENV" && !["development", "production", "test"].includes(String(env[key] ?? ""))) delete env[key];
  }

  // Never inherit the host app's PORT into workspace commands — VaultGate runs on
  // its own fixed port (7483) and workspace Next.js/Vite apps must choose their own.
  delete env.PORT;
  delete env.port;

  env.HOME = process.platform === "win32" ? process.env.USERPROFILE : env.HOME;
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const original = process.env.PATH || process.env.Path || "";
  delete env.PATH;
  delete env.Path;
  const meta = path.resolve(/* turbopackIgnore: true */ metaRoot);
  env[pathKey] = [path.join(meta, "bin"), path.join(meta, "node_modules", ".bin"), path.join(/* turbopackIgnore: true */ root, "node_modules", ".bin"), original].filter(Boolean).join(path.delimiter);
  env.NODE_PATH = [path.join(meta, "node_modules"), env.NODE_PATH || ""].filter(Boolean).join(path.delimiter);
  env.TERMINAL_CWD = root;
  env.VAULTGATE_HOME = meta;
  env.VAULTGATE_CONFIG_PATH = meta;
  env.VAULTGATE_WORKSPACE_ROOT = root;
  env.VAULTGATE_WORKSPACE = root;
  env.AGENT_BROWSER_OUTPUT_DIR = path.join(meta, "download", "agent-browser");
  env.AGENT_BROWSER_TMP_DIR = path.join(meta, "download", "agent-browser", "tmp");
  // Force UTF-8 for Python scripts on Windows (prevents charmap encoding errors)
  env.PYTHONIOENCODING = "utf-8";
  env.PYTHONUTF8 = "1";

  for (const [key, value] of Object.entries(overrides)) {
    if (!key || isSecretEnvKey(key)) continue;
    if (key.toUpperCase() === "NODE_ENV" && !["development", "production", "test"].includes(String(value ?? ""))) continue;
    env[key] = value;
  }

  return env;
}

export function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function normalizePowerShellCommand(command: string): string {
  // PowerShell does not allow environment assignment as a pipeline-chain item:
  // `cd app && $env:NODE_OPTIONS="--trace-warnings" && npm run dev` fails to parse.
  // Keep the common agent-generated form working by turning that assignment into
  // a statement while preserving the previous command's success check.
  return command.replace(
    /&&\s*\$env:([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("[^"]*"|'[^']*'|[^;&|\r\n]+)\s*(?:&&|;)?\s*/g,
    (_match, name: string, value: string) => `; if (!$?) { exit 1 }; $env:${name} = ${value.trim()}; `,
  );
}

// A small POSIX-compatibility preamble so the agent's bash-isms work on Windows.
function agentBrowserPowerShellShim(): string {
  return `
function global:__VaultGateAgentBrowser {
  param([string]$CommandName, [Parameter(ValueFromRemainingArguments=$true)][object[]]$Args)
  $cmd = Get-Command $CommandName -CommandType Application,ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
  if (!$cmd -and $CommandName -ne 'agent-browser') { $cmd = Get-Command agent-browser -CommandType Application,ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1 }
  if (!$cmd) { throw "$CommandName command not found" }
  $argv = @($Args | ForEach-Object { [string]$_ })
  $shot = -1
  for ($i = 0; $i -lt $argv.Count; $i++) { if ($argv[$i] -ieq 'screenshot') { $shot = $i; break } }
  if ($shot -ge 0) {
    for ($i = $argv.Count - 1; $i -gt $shot; $i--) {
      $value = $argv[$i]
      if (!$value -or $value.StartsWith('-')) { continue }
      if ([System.IO.Path]::IsPathRooted($value) -or $value.StartsWith('~')) { break }
      if ($value -match '\\.(png|jpe?g|webp)$' -or $value -match '[\\/]') {
        $full = [System.IO.Path]::GetFullPath((Join-Path $env:VAULTGATE_WORKSPACE_ROOT $value))
        $parent = [System.IO.Path]::GetDirectoryName($full)
        if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
        $argv[$i] = $full
      }
      break
    }
  }
  & $cmd.Source @argv
}
function global:agent-browser { param([Parameter(ValueFromRemainingArguments=$true)][object[]]$Args) __VaultGateAgentBrowser agent-browser @Args }
function global:agent-browser.cmd { param([Parameter(ValueFromRemainingArguments=$true)][object[]]$Args) __VaultGateAgentBrowser agent-browser.cmd @Args }
function global:agent-browser.exe { param([Parameter(ValueFromRemainingArguments=$true)][object[]]$Args) __VaultGateAgentBrowser agent-browser.exe @Args }
`.trim();
}

export function wrapWindowsCommand(root: string, command: string, metaRoot = path.join(root, ".vaultgate")): string {
  const normalizedCommand = normalizePowerShellCommand(command);
  const meta = path.resolve(/* turbopackIgnore: true */ metaRoot);
  return [
    `$env:VAULTGATE_WORKSPACE = ${psQuote(root)}`,
    `Remove-Item Env:PORT -ErrorAction SilentlyContinue`,
    `Remove-Item Env:port -ErrorAction SilentlyContinue`,
    `if (@('development','production','test') -notcontains "$($env:NODE_ENV)") { Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue }`,
    `$env:VAULTGATE_WORKSPACE_ROOT = ${psQuote(root)}`,
    `$env:TERMINAL_CWD = ${psQuote(root)}`,
    `$env:VAULTGATE_HOME = ${psQuote(meta)}`,
    `$env:VAULTGATE_CONFIG_PATH = ${psQuote(meta)}`,
    `function global:vaultgate-workspace { node (Join-Path $env:VAULTGATE_HOME 'bin/vaultgate-workspace.js') @args }`,
    `function global:vaultgate-history { node (Join-Path $env:VAULTGATE_HOME 'bin/vaultgate-workspace.js') history @args }`,
    `function global:bun { node (Join-Path $env:VAULTGATE_HOME 'bin/bun.js') @args }`,
    `function global:bunx { node (Join-Path $env:VAULTGATE_HOME 'bin/bunx.js') @args }`,
    agentBrowserPowerShellShim(),
    `function global:mkdir { param([Alias('p')][switch]$Parents,[Parameter(ValueFromRemainingArguments=$true)][string[]]$Paths) $t=@($Paths|?{$_}); if(!$t){$t=@('.')}; foreach($x in $t){ New-Item -ItemType Directory -Force -Path $x | Out-Null } }`,
    `function global:touch { param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Paths) foreach($x in $Paths){ if(Test-Path -LiteralPath $x){(Get-Item -LiteralPath $x).LastWriteTime=Get-Date}else{New-Item -ItemType File -Force -Path $x|Out-Null} } }`,
    `function global:head { param([Parameter(ValueFromRemainingArguments=$true)][object[]]$Args) $n=10; $paths=@(); for($i=0;$i -lt $Args.Count;$i++){ $a=[string]$Args[$i]; if($a -eq '-n' -and $i + 1 -lt $Args.Count){ $n=[int]$Args[$i+1]; $i++ } elseif($a -match '^-\\d+$'){ $n=[int]$a.Substring(1) } else { $paths += $a } }; if($paths.Count -eq 0){ $input | Select-Object -First $n } else { foreach($p in $paths){ Get-Content -LiteralPath $p -TotalCount $n } } }`,
    `function global:python { py -3 @args }`,
    `function global:python3 { py -3 @args }`,
    `function global:pip { py -3 -m pip @args }`,
    `function global:pip3 { py -3 -m pip @args }`,
    normalizedCommand,
  ].join("\n");
}

export function windowsShell(): string {
  for (const shell of ["pwsh", "powershell"]) {
    const r = spawnSync(shell, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], { stdio: "ignore" });
    if (!r.error) return shell;
  }
  return "pwsh";
}

export function killProcessTree(pid?: number, signal: NodeJS.Signals = "SIGTERM"): void {
  if (!pid) return;
  if (process.platform === "win32") {
    const child = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    child.on("error", () => {});
    return;
  }

  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      /* already gone */
    }
  }
}
