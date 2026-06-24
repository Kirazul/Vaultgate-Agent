# VaultGate — Rebuild Roadmap

> Core-first delivery. Each phase ends with something runnable. Checkboxes track real progress.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done

---

## Phase 1 — Foundation + real streaming + desktop shell  ← CURRENT
Goal: a clean app you can run, send a message, and watch it **truly stream** token-by-token, persisted to SQLite, in an Electron window.

- [x] New clean folder + docs (AUDIT / ARCHITECTURE / ROADMAP)
- [~] Project scaffold (package.json, tsconfig, next.config, tailwind/postcss, eslint, .gitignore, .env.example)
- [~] Theme: port `globals.css` tokens + animations
- [~] Types: `src/types` (Chat, Message, ContentBlock, SSE events)
- [~] Streaming core: `lib/ai/provider.ts`, `lib/ai/stream.ts`, `lib/ai/blocks.ts`
- [~] Store: `lib/store/chat-store.ts` (rAF-batched stream slice), `settings-store.ts`, `ui-store.ts`
- [~] Hook: `hooks/use-chat-stream.ts` (network→store bridge, no flushSync)
- [~] API: `/api/chat` (SSE, non-streaming fallback), `/api/models`, `/api/settings`
- [~] DB: `lib/db/client.ts` + `schema.sql` + `repo.ts`; `/api/chats*` CRUD
- [~] UI: layout, page shell, Sidebar, Composer, MessageList, MessageBubble, Markdown/CodeBlock/Reasoning, settings dialog
- [~] Electron: `main.ts` (own Next server + window), `preload.ts`
- [ ] `npm install` + `npm run lint` + `npm run build` clean
- [ ] Manual verify: streaming is smooth, chat persists across restart

## Phase 2 — Agent loop + tools
Goal: agent mode with iterative tool calling, streamed tool cards.

- [ ] `lib/ai/agent.ts` (clean port of `agent-engine.ts`: retries, timeouts, abort, reasoning split)
- [ ] `lib/ai/tools/*` (Bash, Read, Write, Edit, MultiEdit, Grep, Glob, WebFetch, Skill, TodoWrite)
- [ ] Tool-call + tool-result SSE phases wired to UI cards (Explored / Edit / Terminal / Skill / Todo)
- [ ] Web search + deep-thinking feature toggles
- [ ] Scene/system-prompt selection

## Phase 3 — Workspace / sandbox + skills
Goal: per-chat host workspace, live preview, code & terminal tabs, skills library.

- [ ] `lib/sandbox/*` (refactor & de-brand `sandbox.ts`: lifecycle, exec, file ops, dev-server, terminal history)
- [ ] `/api/sandbox/*` (status, files ls-tree/read/raw/write, execute, preview proxy, up/delete)
- [ ] WorkspacePanel (Preview / Code / Terminal tabs) + file tree + resizer
- [ ] Copy + index `skills/` into the new repo; skill inventory in system prompt
- [ ] Attachments upload + context injection

## Phase 4 — Production polish & packaging
Goal: shippable desktop installers and hardened UX.

- [ ] All UI bugs swept (regenerate wired, scroll anchoring, spacing/typography pass, empty/error states)
- [ ] Settings: provider config UX, model fetch, theme toggle, data location
- [ ] Error boundaries, toasts, offline/endpoint-down handling, abort/stop button
- [ ] electron-builder config → Windows installer (.exe / NSIS), optional mac/linux
- [ ] Auto-update strategy (optional), app icons, code signing notes
- [ ] README + first-run onboarding

---

## Out of scope / dropped from legacy
`temp-nextjs/`, `scratch/`, `download/`, legacy production archives, default Prisma `User`/`Post`, `next-auth`, `next-intl`, dual lockfiles, the multi-version API surface, and all legacy branding.

---

## Conventions
- TypeScript strict. No `any` in new code (legacy `any` islands cleaned on port).
- Server-only modules never imported by client components.
- One feature per folder; files < ~300 lines.
- Conventional commits; small, reviewable changes.
