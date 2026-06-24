# VaultGate — Audit of the Legacy App

> Full audit of the existing application that this project rebuilds from scratch.
> Scope of audit: **workflow, architecture, and product-level issues** — not line-by-line syntax.
> Date: 2026-05-23.

---

## 1. What the app actually is

A **self-hosted, agentic chat application** ("VaultGate") built on Next.js 16 / React 19. It:

- Talks to **any OpenAI-compatible endpoint** (user-configured base URL + key + model).
- Runs an **agent loop** with tools: `Bash`, `Read`, `Write`, `Edit`, `MultiEdit`, `Grep`, `Glob`, `WebFetch`, `Skill`, `TodoWrite`.
- Gives each chat an isolated **workspace/sandbox** on the host machine (real `child_process` command execution under `workspaces/<chatId>`).
- Ships a **skills library** (`skills/*/SKILL.md`) the model can load on demand.
- Supports **web search**, **deep-thinking/reasoning**, **file attachments**, and a 3-tab **workspace panel** (Preview / Code / Terminal).
- Can spin up a **dev server** inside a workspace and proxy a live **preview**.

It was scaffolded by an AI builder tool, then heavily hand-modified. The result works *barely*, but is not production-ready.

---

## 2. Critical issues (ranked)

### 2.1 Streaming is faked / buffered — **#1 user complaint**
The answer appears all at once at the end instead of token-by-token.

**Root cause (confirmed):**
- `src/components/chat/ChatArea.tsx` wraps **every** SSE token in `flushSync(() => updateMessage(...))`, forcing a synchronous full re-render per token.
- `src/lib/store.ts` `updateMessage` rebuilds the **entire `chats[]` array** and a **new `contentBlocks` array** on every token.
- `src/components/chat/MessageBubble.tsx` re-renders the **full markdown + KaTeX + syntax-highlight tree** per token.
- Net effect: the main thread is saturated, so the browser **never gets a paint window** until the stream finishes. The `setTimeout(0)` yields in `streamChatCompletion` are a failed band-aid.
- The server side is mostly fine — `runAgentLoop` / `callLLM` forward raw provider SSE frames in real time — **but** the agent loop emits the whole answer in **one event** when a provider does not truly stream.

**Fix:** decouple network reading from React rendering; flush on `requestAnimationFrame` (coalesced, ~60fps, no `flushSync`); isolate re-render to the active message via a granular store slice; memoize completed bubbles; server-side chunk simulation for non-streaming providers. (See `ARCHITECTURE.md` §Streaming.)

### 2.2 Branding & naming chaos
One app, many identities, all leaking into code, config, and UI:
- Mixed legacy and VaultGate branding, including hardcoded third-party endpoints.
- Component folder literally named **`woozlit/`** (`ChatMatrix`, `ScrambleText`, `Shimmer`, `reasoning`, `model-selector`…).
- `package.json` name is `nextjs_tailwind_shadcn_ts`.
- localStorage/env vars mixed multiple product namespaces.
- Workspace CLI shims were duplicated across several legacy aliases instead of one VaultGate command surface.

### 2.3 Three+ parallel, overlapping API surfaces
Under `src/app/api/`:
- `v1/` — `auths`, `chats`, `chats/[id]`, `chats/[id]/messages`, `chats/new`, `files`, `scene-cfg`, `users/user/settings(/update)`
- `v2/` — `chat/completions`, `functions/invoke`
- loose top-level — `chat/continue`, `chat/share/[id]`, `config`, `models`, `settings/api`, `tasks/stop/[id]`, `sandbox/*` (8 routes)

Much is dead, duplicated, or only half-wired. The client really only uses: `v1/auths` (guest token), `settings/api` (config), `v2/chat/completions` (the actual chat), and `sandbox/*` (workspace panel).

### 2.4 Vestigial / dead scaffolding committed to the repo
- `prisma/schema.prisma` is the **default `User` + `Post`** boilerplate — unrelated to a chat app, and **unused** (all state is in browser localStorage).
- `temp-nextjs/` — an entire second Next.js app (with its own `node_modules`, `package-lock.json`).
- `scratch/` — one-off rebrand/search/test scripts.
- `download/` — extracted chat.z.ai front-end assets (chunks, html, png).
- `vaultgate-production-workspace/` — a bundled SDK + node_modules used to seed sandboxes.
- **A legacy production archive (38 MB) committed to git.**
- `db/custom.db` (deleted), `data/api-config.json` (runtime state in repo).

### 2.5 Persistence is browser-only and fragile
- All chats/messages/settings live in **`localStorage`** via Zustand `persist` (`src/lib/store.ts`), debounced 600ms.
- No real database despite Prisma being installed. Size-limited, no querying/search, lost on cache clear, not desktop-grade.

### 2.6 State & render architecture problems
- `store.ts` is a single monolithic Zustand store mixing auth, chats, model, features, workspace, terminal buffers, API config, and UI flags.
- Streaming mutates the whole store on every token (see §2.1).
- `ChatArea.handleSend` is a ~170-line `useCallback` doing upload, request building, fetch, full SSE handling, workspace side-effects, and error handling inline.

### 2.7 Security / safety posture
- Agent executes **arbitrary LLM-driven shell commands on the host** (expected for a personal desktop app, but must be scoped and clearly bounded).
- Workspace env stripping exists (`buildWorkspaceEnv` removes `*API_KEY*`, `*TOKEN*`, etc.) — good, keep it.
- Guest auth (`v1/auths`) is a stub token — fine for local desktop, but should be honest about it (no real multi-user).
- Path traversal guards (`assertInside`) exist in `sandbox.ts` — keep and centralize.

### 2.8 UI/UX bugs & rough edges (to fix in rebuild)
- Auto-scroll uses a 120ms `setInterval` during streaming (jittery; should be scroll-anchored).
- `flushSync` jank (§2.1) makes the whole UI stutter during generation.
- "Regenerate" button is rendered but **not wired** (`MessageBubble` line ~841: no `onClick`).
- Inconsistent spacing/typography between welcome, chat, and workspace panel.
- Workspace panel visibility logic is spread across `page.tsx` + `store.ts` + `ChatArea` with overlapping refs/effects (`syncedWorkspaceChatRef`, multiple `getChatWorkspaceSnapshot` paths).
- Markdown `p` is rendered as `<div>` (workaround for nesting) — fine, but should be deliberate.

---

## 3. What is actually good (keep / port faithfully)

- **Theme tokens** in `globals.css` (zinc-based light/dark) and animations (`waterfall`, `streaming-cursor`, `doneGlow`, `runningSweep`).
- The **SSE event model** (`chat:completion` phases: thinking / tool_call / tool_response / answer / other / done; `chat:title`, `chat:tags`).
- **Content-block builder** concept (reasoning / text / tool_calls blocks) in `lib/chat.ts` — good model, needs cleaner implementation.
- **Tool result rendering** in `MessageBubble` (Explored group, Edit/Terminal/Skill cards, Todo checklist) — strong UX, port it.
- **Sandbox safety** primitives (`assertInside`, env stripping, port hashing, terminal history JSONL).
- **Provider retry / timeout** logic in `agent-engine.ts` (`isRetryableProviderResponse`, scoped signals).
- **Reasoning tag parsing** (`<think>`, `<reasoning>`, `<details type="reasoning">`, `reasoning_content`).

---

## 4. Dependency notes

- Next 16, React 19, Tailwind v4, shadcn/ui (full Radix set), Zustand, TanStack Query/Table, `streamdown` (markdown streaming), `react-syntax-highlighter`, `katex`, `framer-motion`, `next-auth` (installed, barely used), `next-intl` (installed, unused), and a workspace-seeded SDK alias.
- Package manager: **bun** lockfile present *and* `package-lock.json` present (npm) — pick one.
- Many Radix deps are pulled in by shadcn but several components are unused.

**Rebuild stance:** keep Next/React/Tailwind/shadcn/Zustand/streamdown/katex/syntax-highlighter. Drop `next-auth`, `next-intl`, TanStack Table (unless needed), and the dual lockfiles. Add `better-sqlite3` (or Prisma+SQLite) and Electron.

---

## 5. Legacy → rebuild disposition table

| Legacy area | Disposition |
|---|---|
| `src/lib/store.ts` (monolith + localStorage) | **Rewrite** — split slices; SQLite-backed; rAF streaming |
| `src/lib/chat.ts` (SSE parse + block builder) | **Port, cleaned** → `lib/ai/stream.ts` + `lib/ai/blocks.ts` |
| `src/lib/agent-engine.ts` | **Port, cleaned** → `lib/ai/agent.ts` (Phase 2) |
| `src/lib/agent-tools.ts` | **Port** → `lib/ai/tools/*` (Phase 2) |
| `src/lib/sandbox.ts` (1441 lines) | **Refactor & split** → `lib/sandbox/*` (Phase 3); de-brand CLI shims |
| `src/app/api/v1/*`, `v2/*`, loose routes | **Collapse** → single clean `/api/*` surface |
| `prisma/` default schema | **Delete**; replace with real chat schema (SQLite) |
| `temp-nextjs/`, `scratch/`, `download/`, `*.zip` | **Drop** (not migrated) |
| `vaultgate-production-workspace/` | **Re-evaluate** in Phase 3 (sandbox SDK seeding) |
| `skills/` | **Keep** — copy into new repo (Phase 3) |
| `components/woozlit/*` | **Rename & port** → `components/chat/*` + `components/ui/*` |
| `components/ui/*` (shadcn) | **Port only what's used** |
| Theme / `globals.css` | **Port** |
| Electron | **New** (Phase 1) |
