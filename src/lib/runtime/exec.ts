// ============================================================
// Host command execution for workspaces (server-only).
// Cross-platform: routes commands through the workspace runtime.
//
// Server commands (npm run dev, next start, etc.) are NOT
// intercepted here — the caller (runBash in execute.ts) detects
// long-running servers and runs them as background commands via
// startBackgroundCommand, exactly like typing the command in a
// terminal. This module handles foreground execution only.
// ============================================================
import "server-only";
import path from "node:path";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { ensureWorkspace, resolvedRoot } from "./workspace";
import { appendHistory } from "./history";
import { executeInWorkspaceRuntime } from "./execution-runtime";

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface ExecOptions {
  timeout?: number;
  signal?: AbortSignal;
  onOutput?: (chunk: string, stream: "stdout" | "stderr") => void;
}

// ── Path helpers ─────────────────────────────────────────────

function comparablePath(file: string): string {
  const resolved = path.resolve(/* turbopackIgnore: true */ file);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function samePath(a: string, b: string): boolean {
  return comparablePath(a) === comparablePath(b);
}

function isHostApplicationRoot(root: string): boolean {
  return samePath(root, process.cwd());
}

function writeTextFileIfChanged(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  try {
    if (existsSync(file) && readFileSync(file, "utf-8") === content) return;
  } catch {
    /* rewrite unreadable files */
  }
  writeFileSync(file, content, "utf-8");
}

function expandShellPath(raw: string): string {
  let value = raw.trim();
  const home = process.env.USERPROFILE || process.env.HOME || "";
  if (home && (value === "~" || value.startsWith("~/") || value.startsWith("~\\"))) {
    value = path.join(/* turbopackIgnore: true */ home, value.slice(2));
  }
  value = value.replace(/%([^%]+)%/g, (match, key: string) => process.env[key] || match);
  value = value.replace(/\$env:([A-Za-z_][\w]*)/gi, (match, key: string) => process.env[key] || match);
  value = value.replace(/\$([A-Za-z_][\w]*)/g, (match, key: string) => process.env[key] || match);
  return value;
}

function resolveCommandPath(raw: string | undefined, base: string): string | null {
  if (!raw) return null;
  const expanded = expandShellPath(raw);
  if (!expanded) return null;
  return path.resolve(/* turbopackIgnore: true */ base, expanded);
}

function pathMatchValue(match: RegExpExecArray): string | undefined {
  return match[1] || match[2] || match[3];
}

function lastMatchedPath(command: string, regex: RegExp): string | null {
  let value: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(command))) value = pathMatchValue(match)?.trim() || value;
  return value;
}

export function detectCommandProjectRoot(command: string, defaultRoot: string): { root: string; explicit: boolean } {
  const cdRaw = lastMatchedPath(command, /(?:^|[;&|\n])\s*(?:cd|chdir)\s+(?:\/d\s+)?(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/gi)
    || lastMatchedPath(command, /(?:^|[;&|\n])\s*(?:set-location|sl)\s+(?:-(?:literalpath|path)\s+)?(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/gi);
  const cdRoot = resolveCommandPath(cdRaw || undefined, defaultRoot);
  const base = cdRoot || defaultRoot;
  const prefixRaw = lastMatchedPath(command, /\b(?:npm|pnpm|yarn|bun)\b[^\n;&|]*?\s--(?:prefix|cwd|dir)(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/gi);
  const prefixRoot = resolveCommandPath(prefixRaw || undefined, base);
  if (prefixRoot) return { root: prefixRoot, explicit: true };
  if (cdRoot) return { root: cdRoot, explicit: true };
  return { root: defaultRoot, explicit: false };
}

function hasPackageJson(root: string): boolean {
  return existsSync(path.join(/* turbopackIgnore: true */ root, "package.json"));
}

function isNextWorkspace(root: string): boolean {
  if (existsSync(path.join(/* turbopackIgnore: true */ root, "src", "app"))) return true;
  try {
    const pkg = JSON.parse(readFileSync(path.join(/* turbopackIgnore: true */ root, "package.json"), "utf-8")) as Record<string, unknown>;
    const deps = { ...((pkg.dependencies as Record<string, string> | undefined) || {}), ...((pkg.devDependencies as Record<string, string> | undefined) || {}) };
    return Boolean(deps.next);
  } catch {
    return false;
  }
}

// ── Workspace preflight repairs ──────────────────────────────
// These run before any foreground command in a Next workspace to
// prevent common build failures from config drift.

function walkFiles(dir: string, predicate: (file: string) => boolean, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git", ".vaultgate"].includes(entry.name)) continue;
    const full = path.join(/* turbopackIgnore: true */ dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, predicate, out);
    else if (entry.isFile() && predicate(full)) out.push(full);
  }
  return out;
}

function repairCssImports(root: string): void {
  const cssFiles = walkFiles(path.join(/* turbopackIgnore: true */ root, "src"), (file) => file.endsWith(".css"));
  for (const file of cssFiles) {
    const raw = readFileSync(file, "utf-8");
    const lines = raw.split(/\r?\n/);
    const charset: string[] = [];
    const imports: string[] = [];
    const rest: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("@charset")) charset.push(line);
      else if (trimmed.startsWith("@import")) imports.push(line);
      else rest.push(line);
    }
    const uniqueImports = [...new Set(imports.map((line) => line.trim()))];
    const next = [...charset, ...uniqueImports, ...rest].join("\n").replace(/\n{3,}/g, "\n\n");
    if (next !== raw) writeTextFileIfChanged(file, next);
  }
}

const SHADCN_V4_TOKENS = `@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-lg: var(--radius);
  --radius-md: calc(var(--radius) - 2px);
  --radius-sm: calc(var(--radius) - 4px);
}
:root {
  --radius: 0.5rem;
  --background: #ffffff; --foreground: #0a0a0a;
  --card: #ffffff; --card-foreground: #0a0a0a;
  --popover: #ffffff; --popover-foreground: #0a0a0a;
  --primary: #18181b; --primary-foreground: #fafafa;
  --secondary: #f4f4f5; --secondary-foreground: #18181b;
  --muted: #f4f4f5; --muted-foreground: #71717a;
  --accent: #f4f4f5; --accent-foreground: #18181b;
  --destructive: #ef4444; --destructive-foreground: #fafafa;
  --border: #e4e4e7; --input: #e4e4e7; --ring: #18181b;
}
.dark {
  --background: #0a0a0a; --foreground: #fafafa;
  --card: #0a0a0a; --card-foreground: #fafafa;
  --popover: #0a0a0a; --popover-foreground: #fafafa;
  --primary: #fafafa; --primary-foreground: #18181b;
  --secondary: #27272a; --secondary-foreground: #fafafa;
  --muted: #27272a; --muted-foreground: #a1a1aa;
  --accent: #27272a; --accent-foreground: #fafafa;
  --destructive: #f87171; --destructive-foreground: #18181b;
  --border: #27272a; --input: #27272a; --ring: #d4d4d8;
}`;

function repairTailwindV4Globals(root: string): void {
  const candidates = ["src/app/globals.css", "app/globals.css", "src/styles/globals.css", "src/app/global.css"];
  for (const rel of candidates) {
    const file = path.join(/* turbopackIgnore: true */ root, rel);
    if (!existsSync(file)) continue;
    const original = readFileSync(file, "utf-8");
    let css = original;

    if (/@tailwind\s+(?:base|components|utilities)\s*;?/.test(css)) {
      css = css.replace(/@tailwind\s+(?:base|components|utilities)\s*;?/g, "").replace(/^\s*\n/gm, "\n");
      if (!/@import\s+["']tailwindcss["']/.test(css)) css = `@import "tailwindcss";\n${css}`;
    }

    const usesTokens = /\b(?:border-border|bg-background|text-foreground|bg-card|bg-popover|text-muted-foreground|bg-primary|bg-secondary|bg-accent|bg-destructive|ring-ring|border-input)\b/.test(css) || /@apply[^;{]*\bborder-border\b/.test(css);
    const definesTokens = /--color-border\b/.test(css) || /--border\s*:/.test(css);
    if (usesTokens && !definesTokens) {
      const importMatch = css.match(/@import\s+["']tailwindcss["'];?/);
      if (importMatch) css = css.replace(importMatch[0], `${importMatch[0]}\n\n${SHADCN_V4_TOKENS}\n`);
      else css = `@import "tailwindcss";\n\n${SHADCN_V4_TOKENS}\n\n${css}`;
    }

    if (css !== original) writeTextFileIfChanged(file, css);
  }
}

function hasDefaultExport(source: string): boolean {
  return /export\s+default\s+(?:function|class|async\s+function|\w+)/.test(source) || /export\s*\{[^}]*\bdefault\b[^}]*\}/.test(source);
}

function repairPageModule(root: string): void {
  const appDir = path.join(/* turbopackIgnore: true */ root, "src", "app");
  const page = path.join(appDir, "page.tsx");
  mkdirSync(appDir, { recursive: true });
  const content = existsSync(page) ? readFileSync(page, "utf-8") : "";
  if (content.trim() && hasDefaultExport(content)) return;

  const componentsDir = path.join(/* turbopackIgnore: true */ root, "src", "components");
  const preferred = ["Header", "Hero", "Stats", "Features", "Models", "CodeExample", "Pricing", "Footer"];
  const available = preferred.filter((name) => existsSync(path.join(componentsDir, `${name}.tsx`)));
  const imports = available.map((name) => `import ${name} from "@/components/${name}";`).join("\n");
  const body = available.length
    ? available.map((name) => `      <${name} />`).join("\n")
    : `      <section className="mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-6 text-center">\n        <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">VaultGate Workspace</p>\n        <h1 className="mt-4 text-5xl font-bold tracking-tight text-white">Your app is ready to build.</h1>\n        <p className="mt-4 max-w-2xl text-zinc-300">Add sections in src/app/page.tsx or src/components, then run npm run build and npm run dev.</p>\n      </section>`;

  writeTextFileIfChanged(
    page,
    `${imports}${imports ? "\n\n" : ""}export default function Page() {\n  return (\n    <main>\n${body}\n    </main>\n  );\n}\n`,
  );
}

function neutralizeGlobalErrorRoute(root: string): void {
  const files = [
    path.join(/* turbopackIgnore: true */ root, "src", "app", "global-error.tsx"),
    path.join(/* turbopackIgnore: true */ root, "src", "app", "global-error.ts"),
    path.join(/* turbopackIgnore: true */ root, "src", "app", "global-error.jsx"),
    path.join(/* turbopackIgnore: true */ root, "src", "app", "global-error.js"),
    path.join(/* turbopackIgnore: true */ root, "app", "global-error.tsx"),
    path.join(/* turbopackIgnore: true */ root, "app", "global-error.ts"),
    path.join(/* turbopackIgnore: true */ root, "app", "global-error.jsx"),
    path.join(/* turbopackIgnore: true */ root, "app", "global-error.js"),
  ];
  for (const file of files) {
    if (!existsSync(file)) continue;
    try {
      renameSync(file, `${file}.bak`);
    } catch {
      /* ignore */
    }
  }
}

const SUPPORTED_NEXT_CONFIG_FILES = ["next.config.js", "next.config.mjs", "next.config.cjs"];

function backupUnsupportedNextTsConfig(root: string): void {
  const file = path.join(/* turbopackIgnore: true */ root, "next.config.ts");
  if (!existsSync(file)) return;
  const backup = path.join(/* turbopackIgnore: true */ root, "next.config.ts.bak");
  try {
    if (!existsSync(backup)) renameSync(file, backup);
    else rmSync(file, { force: true });
  } catch {
    try {
      rmSync(file, { force: true });
    } catch {
      /* ignore */
    }
  }
}

function hasSupportedNextConfig(root: string): boolean {
  return SUPPORTED_NEXT_CONFIG_FILES.some((name) => existsSync(path.join(/* turbopackIgnore: true */ root, name)));
}

function hardenNextConfig(root: string): void {
  backupUnsupportedNextTsConfig(root);
  if (hasSupportedNextConfig(root)) return;

  const file = path.join(/* turbopackIgnore: true */ root, "next.config.mjs");
  writeTextFileIfChanged(
    file,
    `/** @type {import("next").NextConfig} */\nconst nextConfig = {\n  reactStrictMode: true,\n};\n\nexport default nextConfig;\n`,
  );
}

function ensureAppRouterErrorPages(root: string): void {
  const appDir = existsSync(path.join(/* turbopackIgnore: true */ root, "src", "app"))
    ? path.join(/* turbopackIgnore: true */ root, "src", "app")
    : existsSync(path.join(/* turbopackIgnore: true */ root, "app"))
      ? path.join(/* turbopackIgnore: true */ root, "app")
      : "";
  if (!appDir) return;
  const notFound = path.join(appDir, "not-found.tsx");
  if (!existsSync(notFound)) {
      writeTextFileIfChanged(
        notFound,
        `export default function NotFound() {\n  return (\n    <main style={{ minHeight: "60vh", display: "grid", placeItems: "center", fontFamily: "system-ui, sans-serif", padding: "2rem" }}>\n      <div style={{ textAlign: "center" }}>\n        <h1 style={{ fontSize: "1.5rem", margin: 0 }}>404</h1>\n        <p style={{ color: "#71717a" }}>This page could not be found.</p>\n      </div>\n    </main>\n  );\n}\n`,
      );
  }
}

function repairTsConfig(root: string): void {
  const file = path.join(/* turbopackIgnore: true */ root, "tsconfig.json");
  writeTextFileIfChanged(
    file,
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2017",
          lib: ["dom", "dom.iterable", "esnext"],
          allowJs: true,
          skipLibCheck: true,
          strict: true,
          noEmit: true,
          esModuleInterop: true,
          module: "esnext",
          moduleResolution: "bundler",
          resolveJsonModule: true,
          isolatedModules: true,
          jsx: "react-jsx",
          incremental: true,
          plugins: [{ name: "next" }],
          paths: { "@/*": ["./src/*"] },
        },
        include: ["next-env.d.ts", "src/**/*.ts", "src/**/*.tsx", ".next/types/**/*.ts", ".next/dev/types/**/*.ts"],
        exclude: ["node_modules", ".vaultgate", ".next/cache"],
      },
      null,
      2,
    ),
  );
}

function neutralizePagesErrorConflict(root: string): void {
  const hasApp = existsSync(path.join(/* turbopackIgnore: true */ root, "src", "app")) || existsSync(path.join(/* turbopackIgnore: true */ root, "app"));
  if (!hasApp) return;
  const conflictingPagesFiles = ["_document.tsx", "_document.ts", "_document.jsx", "_document.js", "_error.tsx", "_error.ts", "_error.jsx", "_error.js"];
  for (const pagesDir of [path.join(/* turbopackIgnore: true */ root, "pages"), path.join(/* turbopackIgnore: true */ root, "src", "pages")]) {
    if (!existsSync(pagesDir)) continue;
    for (const fileName of conflictingPagesFiles) {
      const f = path.join(/* turbopackIgnore: true */ pagesDir, fileName);
      if (existsSync(f)) {
        try {
          renameSync(f, `${f}.bak`);
        } catch {
          /* ignore */
        }
      }
    }
  }
}

function normalizeNextScripts(root: string): void {
  const pkgPath = path.join(/* turbopackIgnore: true */ root, "package.json");
  if (!existsSync(pkgPath)) return;
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
  } catch {
    return;
  }
  if (!pkg || typeof pkg !== "object") return;
  const scripts = pkg.scripts && typeof pkg.scripts === "object" ? (pkg.scripts as Record<string, string>) : {};
  let changed = false;

  if (typeof scripts.build === "string" && /--turbopack\b/.test(scripts.build)) {
    scripts.build = scripts.build.replace(/\s*--turbopack\b/g, "").trim();
    changed = true;
  }
  if (!scripts.build) {
    scripts.build = "next build";
    changed = true;
  }

  if (changed) {
    pkg.scripts = scripts;
    writeTextFileIfChanged(pkgPath, JSON.stringify(pkg, null, 2));
  }
}

function preflightNextWorkspace(root: string): void {
  if (!isNextWorkspace(root)) return;
  hardenNextConfig(root);
  normalizeNextScripts(root);
  repairTsConfig(root);
  repairTailwindV4Globals(root);
  repairCssImports(root);
  neutralizeGlobalErrorRoute(root);
  repairPageModule(root);
  ensureAppRouterErrorPages(root);
  neutralizePagesErrorConflict(root);
}

// ── Main execution entry point ───────────────────────────────
// No managed dev-server interception. Commands run through the
// workspace runtime shell exactly as written — same as if the
// user typed them in a terminal in the workspace directory.

export async function workspaceExecute(chatId: string, command: string, options: ExecOptions = {}): Promise<ExecResult> {
  await ensureWorkspace(chatId);
  const root = resolvedRoot(chatId);
  const commandLocation = detectCommandProjectRoot(command, root);
  const commandRoot = commandLocation.root;
  if (hasPackageJson(commandRoot)) {
    if (!isHostApplicationRoot(commandRoot)) preflightNextWorkspace(commandRoot);
  } else if (!isHostApplicationRoot(root)) {
    preflightNextWorkspace(root);
  }
  const timeout = Math.min(options.timeout ?? 120000, 600000);

  // Only block create-next-app if it would scaffold inside VaultGate's own host
  // application directory (which would corrupt the running app). User project
  // directories and the default workspace are always allowed — the agent has
  // full control to scaffold whatever it wants.
  if (/\bcreate-next-app\b/i.test(command) && isHostApplicationRoot(commandRoot)) {
    const res: ExecResult = {
      exitCode: 1,
      stdout: "",
      stderr: "Cannot run create-next-app inside VaultGate's own application directory. Use a project folder or the default workspace instead.",
      timedOut: false,
    };
    appendHistory(chatId, { command, ...res });
    return res;
  }

  // Execute the command normally through the workspace runtime.
  const res = await executeInWorkspaceRuntime(chatId, root, command, {
    timeout,
    signal: options.signal,
    onOutput: options.onOutput,
  });
  appendHistory(chatId, { command, ...res });
  return res;
}

export function workspaceHasDevDir(chatId: string): boolean {
  return existsSync(path.join(resolvedRoot(chatId), "node_modules"));
}
