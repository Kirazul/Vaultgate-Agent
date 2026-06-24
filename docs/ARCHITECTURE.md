# VaultGate — Target Architecture

> The production-grade design the rebuild implements. Optimized for **organization, scalability, and a real-time desktop experience**.

---

## 1. High-level shape

```
┌──────────────────────────── Electron (desktop shell) ────────────────────────────┐
│  electron/main.ts        — app lifecycle, window, spawns/owns the Next server      │
│  electron/preload.ts     — typed, minimal IPC bridge (no nodeIntegration in renderer)│
│                                                                                    │
│   ┌──────────────── Next.js (renderer + local server, one process) ────────────┐  │
│   │  Renderer (React 19)            │   Route Handlers (Node runtime)           │  │
│   │  • app/page.tsx (chat UI)       │   • /api/chat        (SSE streaming)      │  │
│   │  • components/chat/*            │   • /api/chats[/...]  (CRUD, SQLite)      │  │
│   │  • lib/store/* (Zustand)        │   • /api/models       (list provider)    │  │
│   │  • hooks/use-chat-stream.ts     │   • /api/settings     (config)           │  │
│   └──────────────┬──────────────────┴───────────────┬───────────────────────────┘  │
│                  │ fetch + ReadableStream (SSE)      │                              │
│                  ▼                                    ▼                              │
│         lib/ai/stream.ts (parse)            lib/ai/provider.ts (OpenAI-compatible)  │
│         lib/store (rAF-batched)             lib/ai/agent.ts (loop, Phase 2)         │
│                                             lib/sandbox/* (host exec, Phase 3)      │
│                                             lib/db/* (better-sqlite3)              │
└────────────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼  user-configured base URL
                       Any OpenAI-compatible LLM endpoint
```

**One process, clean layering.** Electron owns the Next.js server (started on a free localhost port in production, `next dev` in development) and points a `BrowserWindow` at it. Node-only concerns (SQLite, child_process sandbox, filesystem) live exclusively in route handlers / `lib/*` server modules, never in the renderer.

---

## 2. Folder structure (FANG-style, feature-first)

```
vaultgate/
├─ docs/                      # AUDIT, ARCHITECTURE, ROADMAP (this folder)
├─ electron/
│  ├─ main.ts                 # window + server lifecycle
│  └─ preload.ts              # contextBridge IPC
├─ src/
│  ├─ app/
│  │  ├─ layout.tsx
│  │  ├─ page.tsx             # thin shell; composes feature components
│  │  ├─ globals.css          # theme tokens + animations (ported)
│  │  └─ api/
│  │     ├─ chat/route.ts     # POST: SSE stream (the streaming core)
│  │     ├─ chats/route.ts    # GET list / POST create
│  │     ├─ chats/[id]/route.ts        # GET / PATCH / DELETE
│  │     ├─ chats/[id]/messages/route.ts
│  │     ├─ models/route.ts   # GET provider model list
│  │     └─ settings/route.ts # GET/POST provider config
│  ├─ components/
│  │  ├─ chat/                # ChatView, MessageList, MessageBubble, Composer, ...
│  │  ├─ markdown/            # Markdown renderer, CodeBlock, Reasoning
│  │  └─ ui/                  # shadcn primitives (only what's used)
│  ├─ hooks/
│  │  ├─ use-chat-stream.ts   # network→store streaming bridge (rAF batched)
│  │  └─ use-auto-scroll.ts   # scroll anchoring (replaces setInterval)
│  ├─ lib/
│  │  ├─ ai/
│  │  │  ├─ provider.ts       # build request, call OpenAI-compatible API
│  │  │  ├─ stream.ts         # SSE frame parser → typed events
│  │  │  ├─ blocks.ts         # content-block builder (text/reasoning/tools)
│  │  │  ├─ agent.ts          # agent loop (Phase 2)
│  │  │  └─ tools/            # one file per tool (Phase 2)
│  │  ├─ db/
│  │  │  ├─ client.ts         # better-sqlite3 singleton (user-data dir)
│  │  │  ├─ schema.sql        # migrations
│  │  │  └─ repo.ts           # typed chat/message/settings repositories
│  │  ├─ store/
│  │  │  ├─ chat-store.ts     # chats + messages (granular, rAF stream slice)
│  │  │  ├─ ui-store.ts       # sidebar, panels, theme
│  │  │  └─ settings-store.ts # provider config, features
│  │  ├─ sandbox/             # workspace lifecycle + exec (Phase 3)
│  │  ├─ config/
│  │  │  └─ env.ts            # typed env + paths (user-data aware)
│  │  └─ utils.ts             # cn(), ids, formatting
│  └─ types/                  # shared TS types (Chat, Message, SSE events)
├─ package.json
├─ tsconfig.json
├─ next.config.ts
├─ tailwind / postcss config
├─ .env.example
└─ README.md
```

**Principles:** one responsibility per module; server-only code never imported by the renderer bundle; types shared via `src/types`; no file over ~300 lines without a good reason; no dead code.

---

## 3. Streaming (the core fix)

**Goal:** true token-by-token rendering at ~60fps, no jank, regardless of provider.

### Server (`/api/chat`)
1. Build an OpenAI-compatible request (`stream: true`) via `lib/ai/provider.ts`.
2. Pipe the upstream `ReadableStream` through with correct SSE headers
   (`Content-Type: text/event-stream`, `Cache-Control: no-store, no-transform`, `X-Accel-Buffering: no`).
3. `start(controller)` returns synchronously; the read loop runs detached and `enqueue`s frames immediately.
4. **Non-streaming providers**: if upstream returns a single JSON body, the server re-emits it as simulated token chunks so the client always sees a real stream.
5. In agent mode (Phase 2), forward provider deltas verbatim; never accumulate a whole answer before emitting.

### Client (`hooks/use-chat-stream.ts`)
1. `fetch` → `response.body.getReader()`; read in a **tight loop** into a mutable string accumulator (a `ref`), parsing SSE frames with `lib/ai/stream.ts`. **This loop does not touch React state.**
2. A single `requestAnimationFrame` scheduler flushes the accumulated delta into the store **once per frame** (~16ms), coalescing many tokens into one update. **No `flushSync`, ever.**
3. The store keeps the **active streaming message** in a dedicated slice keyed by `messageId`. Only the active `MessageBubble` subscribes to it; all completed bubbles are `React.memo`'d and never re-render mid-stream.
4. On `done`, the final content/blocks are committed to the chat and persisted to SQLite.

### Why this works
The browser only paints when the main thread is free. Per-token `flushSync` never frees it. Reading off-thread-ish (microtask loop) + one rAF-batched commit per frame + isolated re-render = smooth, real streaming.

---

## 4. Persistence (SQLite via sql.js / WASM)

- **`sql.js`** (SQLite compiled to WebAssembly) opened once in `lib/db/client.ts`.
  Chosen over `better-sqlite3` because it needs **no native compilation and no
  install-time binary download** — it installs and runs identically on every
  machine and CI. Same SQLite on-disk file format, so data is portable to any
  SQLite tooling and we can swap in a native driver later without schema changes.
- The DB is held in memory; mutations write the file back **atomically and
  debounced** (`export()` → temp file → rename).
- DB file lives in Electron's `app.getPath('userData')/data/vaultgate.db`
  (dev: `./.data/vaultgate.db`).
- Schema (`schema.ts`): `chats`, `messages` (JSON `blocks`), `settings` (key/value).
- `repo.ts` exposes typed **async** functions (`listChats`, `createChat`,
  `upsertMessage`, `getSetting`, `setSetting`, …); all SQL lives here.
- The Zustand store is the in-memory client view; the server persists via the
  `/api/chats*` routes.

---

## 5. Configuration

- Provider config (endpoint, apiKey, defaultModel) stored in the `settings` table (not a repo JSON file).
- `.env` only seeds first-run defaults; runtime changes go through `/api/settings`.
- `lib/config/env.ts` centralizes all paths and reads, user-data-dir aware.
- Provider-agnostic: any OpenAI-compatible endpoint. No hardcoded vendor.

---

## 6. Security posture (desktop)

- Renderer runs with `contextIsolation: true`, `nodeIntegration: false`; only a typed `preload` bridge.
- Sandbox command execution stays host-side (it's the user's machine) but: scoped to `workspaces/<chatId>`, path-traversal guarded (`assertInside`), secret-stripped env, explicit timeouts and abort signals.
- No telemetry, no remote calls except the user's configured LLM endpoint.

---

## 7. Naming & branding (single source of truth)

- Product name: **VaultGate**. Package: `vaultgate`. Store key / DB: `vaultgate`.
- One env namespace: `VAULTGATE_*` plus standard `OPENAI_API_*` for the provider.
- No legacy alias zoo. Components are named for what they do.
