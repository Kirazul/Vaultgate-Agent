# VaultGate — System Documentation

A complete, checkmarked catalog of every system in VaultGate: a self-hosted,
local-first AI agent desktop app (Electron + Next.js) that works with **any
OpenAI-compatible endpoint**.

> Status legend: ✅ implemented & verified · 🟡 partial / next · ⬜ not yet

Verified gates: `npm run typecheck` ✅ · `npm run lint` ✅ · `npm run build` ✅ ·
SDK `tsc` ✅ · live web search ✅ · 49/49 skills audited ✅.

---

## 1. Architecture

| Layer | What | File(s) | Status |
|---|---|---|---|
| Desktop shell | Electron window + window controls | `electron/main.ts`, `preload.ts` | ✅ |
| UI | Next.js 16 + React 19 + Tailwind v4 | `src/app`, `src/components` | ✅ |
| State | Zustand stores (chat, settings, ui, workspace) | `src/lib/store/*` | ✅ |
| Storage | SQLite (chats, messages, settings) | `src/lib/db/*` | ✅ |
| Agent loop | Iterative tool-calling over SSE | `src/lib/ai/agent.ts` | ✅ |
| Tools | Execution against the per-chat workspace | `src/lib/ai/tools/*` | ✅ |
| Workspace | Per-chat workspace + bundled SDK + skills | `src/lib/runtime/*` | ✅ |
| SDK | OpenAI-compatible client + CLI | `src/assets/vaultgate-production-workspace/sdk` | ✅ |

---

## 2. Chat & streaming

- ✅ **Real token-by-token streaming** — rAF-batched (no `flushSync`); only the
  active message re-renders (`use-chat-stream.ts`, `blocks.ts`).
- ✅ **Live timers** — "Thinking / Working / per-tool" counters tick 1→2→3… in
  real time via `use-elapsed.ts` (never freeze-then-jump).
- ✅ **Reasoning panel** — collapsible, auto-scrolls while streaming, collapses
  to "Thought for Ns" when the answer begins.
- ✅ **Streaming-safe markdown** — Streamdown tolerates partial markdown;
  link-safety modal disabled to fix invalid `<div>`-in-`<p>` hydration; external
  links open in a new tab, `workspace-file:` links open in the Code panel.
- ✅ **Smooth, no-lag** rendering; memoized bubbles.

---

## 3. Tools (the agent's toolbox)

| Tool | Purpose | Status |
|---|---|---|
| Bash | Run commands through the persistent runtime (PowerShell 7 / bash) | ✅ |
| Bash `run_in_background` + **BashOutput** | Long-running processes, poll/stop | ✅ |
| **ListProcesses** | See running dev server + background tasks + runtime cwd/env | ✅ |
| Read / Write / Edit / MultiEdit | File I/O with exact-match edits | ✅ |
| Glob / Grep / LS | Find / search / list (ripgrep + JS fallback) | ✅ |
| **WebSearch** | Live web search (DuckDuckGo, provider-independent) | ✅ |
| WebFetch | Fetch & read a URL | ✅ |
| TodoWrite | Structured multi-step task list | ✅ |
| Skill | Load a specialized skill's instructions | ✅ |
| **Task** | Sub-agents with `subagent_type` general/explore/verification (parallel) | ✅ |
| **AskUserQuestion** | Interactive clarifying question (clickable options) | ✅ |

All tool descriptions follow Claude-Code discipline: read-before-edit, exact
unique-match edits, "prefer the dedicated tool over Bash", parallel reads /
serial mutations.

---

## 4. Orchestration

- ✅ Iterative loop, up to 32 steps, multiple tool calls per turn.
- ✅ **Parallel** execution of concurrency-safe tools (Read/Grep/Glob/LS/Web*/Skill/Task).
- ✅ **Sub-agents** (Task): focused workers with the full toolset, run end-to-end,
  report back; cannot recurse (bounded); multiple run in parallel on independent work.
- ✅ Provider retry with backoff on transient errors.
- ✅ **Graceful wrap-up** when the step budget is hit (summary, never a silent stop).
- ✅ **Self-healing** prompt: treat failures as recoverable, fix root cause, re-verify.

---

## 4b. Execution Runtime (ECR) — Hermes-aligned

The execution layer is a **persistent runtime**, not a throwaway shell per command
(`src/lib/runtime/execution-runtime.ts`, `process.ts`, `process-registry.ts`).

- ✅ **Provider abstraction** — `WorkspaceRuntimeProvider { execute, launchContext, status }`.
  The active provider is selected by `VAULTGATE_RUNTIME_PROVIDER` and defaults to the
  stable `local-persistent-shell`; unknown providers safely degrade to it. This is the
  seam for future native/shared/remote execution backends — nothing is hard-coupled to the SDK.
- ✅ **Persistent state** — the live shell is disposable, but the working directory and
  exported environment variables are **durable** and carry across Bash commands in a chat
  (captured after each command into `.vaultgate/runtime/state.json`). Hermes's
  "disposable shell, durable state" model.
- ✅ **Serialized execution** — `withRuntimeLock` queues commands per workspace to avoid races.
- ✅ **Graceful fallback** — `legacyDirectExecute` runs the command directly if runtime prep fails.
- ✅ **Unified process registry** — dev server + background commands surfaced through one
  view (`listManagedProcesses` / `readManagedProcess` / `killManagedProcess`), exposed to the
  agent via **ListProcesses** and to the prompt via `runtimeSnapshot`.
- ✅ **Secret hygiene** — host secrets and non-standard `NODE_ENV` are stripped from every
  spawned command's environment.

Migration direction: per-chat isolation remains the safe default; the provider interface
lets a future shared/persistent backend slot in without touching tool call sites.

---

## 5. Workspace, code & preview

- ✅ **Per-chat workspace** under the app data dir; created on demand, traversal-guarded.
- ✅ **Self-seeding runtime**: bundled SDK + skills + CLI wrappers copied in; refreshes on version bump.
- ✅ **Pre-installed deps** (docx, pptxgenjs, xlsx, SDK) → instant document generation, no download; heavier libs install on demand.
- ✅ **Code panel** — file tree + viewer; runtime folders hidden.
- ✅ **Terminal panel** — live command output.
- ✅ **Preview panel** — iframe to the workspace dev server with graceful
  placeholder / "starting" / "stopped" states (never a blank hang).
- ✅ **Next.js hardening** — absolute `turbopack.root` + `outputFileTracingRoot`
  (fixes wrong lockfile-root inference), CSS `@import` repair, app-router
  `not-found`, and neutralizing stray pages-router `_document`/`_error` that
  break `next build` with the `<Html>` error.
- ✅ **Force-delete**: deleting a chat kills its dev server and removes the workspace (after a confirm popup).

---

## 6. Skills (49 bundled)

- ✅ All 49 have valid frontmatter (name + description) and an entry point.
- ✅ De-branded at load (`normalizeSkill`): vendor URLs → the configured endpoint;
  `bun`/`bunx` → `npm`/`npx`; no remote bootstrap.
- ✅ `fullstack-dev` rewritten for VaultGate's real environment (run dev to back
  Preview, standard ports, npm, verify with lint/build).
- ✅ `agent-browser` made install-first with a WebSearch/WebFetch fallback.
- ✅ Broken doc references fixed (blog-writer, seo-content-writer).
- Categories: coding/fullstack, charts, docx/xlsx/ppt/pdf, web search/read,
  image/vision, research, writing, design, and more.

---

## 7. SDK (`vaultgate-sdk`)

- ✅ Layered config (file / env / explicit), retry + timeout + streaming HTTP client.
- ✅ Modules: chat, images, audio (TTS/ASR), video, functions (web_search/page_reader with **local DuckDuckGo fallback**).
- ✅ CLI: `chat, image, tts, asr, video, search, read, function, skill, vision, config, list`.
- ✅ Media modules call standard OpenAI routes and no longer inject vendor default models — unsupported calls fail clearly (capability-gated in the prompt).
- ✅ Typechecks clean; `dist` rebuilt.

---

## 8. Capability & availability policy

- ✅ Always available (any provider): chat, workspace tools, WebSearch/WebFetch, document/code skills, sub-agents, background tasks.
- 🟡 Image / TTS / ASR / video: require the configured provider to support the matching endpoint + model; the agent only attempts them when viable and reports unsupported plainly.
- 🟡 Browser automation (agent-browser) & Python skills: one-time on-demand install (network).

---

## 9. Roadmap vs Claude Code

| Capability | Status |
|---|---|
| Core file/search/bash tools (Claude-grade descriptions) | ✅ |
| Web search + fetch (provider-independent) | ✅ |
| Streaming + live thinking timers | ✅ |
| Sub-agents / Task / parallel agents | ✅ |
| AskUserQuestion (interactive) | ✅ |
| Background bash + BashOutput | ✅ |
| Integrated Preview / Code / Terminal workspace | ✅ |
| Instant pre-bundled document tooling | ✅ |
| Local-first, any OpenAI endpoint, desktop app | ✅ (Claude Code is Anthropic-only) |
| Plan mode (plan → approve) | 🟡 next |
| Permissions UI (approve risky commands) | 🟡 next |
| MCP servers | ⬜ next |
| Hooks (run commands on events) | ⬜ next |

---

## 10. Develop & verify

```bash
npm install
npm run dev            # web only (http://localhost:3000)
npm run electron:dev   # full desktop app
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm run build          # production build
```

Data: dev `./.data/vaultgate.db`; packaged → OS user-data dir. Workspaces:
`./.data/workspaces/<chatId>/`.
