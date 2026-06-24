// OpenAI function-tool definitions for the agent, plus name canonicalization.
import type { ChatMode } from "@/types";

export const AGENT_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "Bash",
      description:
        "Execute a terminal command in the workspace. The first command starts at the workspace root; after that, `cd` persists like a real terminal, and any persisted cwd outside the workspace snaps back to root. Use `pwd` when unsure. On Windows this is PowerShell (pwsh when available, Windows PowerShell fallback; avoid bash-only syntax like `cat > file`, heredocs, or `/home/...` paths); elsewhere bash. Returns stdout, stderr, and exit code. Dev-server commands such as `npm run dev`, `pnpm dev`, `yarn dev`, `bun run dev`, `next dev`, and `next start` are automatically managed as persistent background servers with live logs and an App URL; do not wrap them in Start-Process, Start-Job, nohup, or `&`. Other server/watch commands are also auto-started in background without timeout. IMPORTANT: do not use Bash for tasks that have a dedicated tool — use Read (not cat/head/tail), Write (not `>` or here-docs), Edit (not sed/awk), Glob (not find), Grep (not grep/rg), and LS (not ls). Chain dependent commands with `&&` (or `;` if you don't care whether earlier ones fail); run independent read-only commands as separate parallel tool calls. Quote any path containing spaces.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The command to execute" },
          timeout: { type: "number", description: "Timeout in ms (max 600000, default 120000)" },
          description: { type: "string", description: "Brief description (5-10 words)" },
          run_in_background: { type: "boolean", description: "Run detached and return immediately with a background id. Use for long-running processes (servers, watchers); read its output later with BashOutput. No '&' needed." },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "Read",
      description:
        "Read a file. Returns content as `N: line` with 1-based line numbers (like cat -n). A relative path is workspace-root-relative; `.vaultgate/...` is a virtual path to VaultGate Home artifacts/state, not a project folder. An absolute path (or `~/...`) reads from the user's real machine. For large files pass offset/limit. Reads files, not directories — use LS for a directory. Prefer this over `Bash cat/head/tail`.",
      parameters: {
        type: "object",
        properties: {
          filepath: { type: "string", description: "Path to the file" },
          offset: { type: "number", description: "Start line (for large files)" },
          limit: { type: "number", description: "Number of lines to read" },
        },
        required: ["filepath"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "Write",
      description:
        "Write content to a file, creating parent directories. Overwrites if it exists. A relative path goes in the workspace root; `.vaultgate/...` writes to VaultGate Home artifacts/state outside the project tree. An ABSOLUTE path (e.g. `C:\\\\Users\\\\You\\\\Desktop\\\\note.txt` or `~/Desktop/note.txt`) writes to the user's real machine. ALWAYS prefer Edit on an existing file; only Write to create a new file or fully rewrite one. Prefer this over shell redirection.",
      parameters: {
        type: "object",
        properties: {
          filepath: { type: "string", description: "Path to write" },
          content: { type: "string", description: "File content" },
        },
        required: ["filepath", "content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "Edit",
      description:
        "Exact string replacement in a workspace file. Read the file first. `old_str` must match the current file content EXACTLY, including whitespace and indentation — when copying from Read output, do NOT include the `N: ` line-number prefix. The edit FAILS if `old_str` is not unique: add surrounding context to make it unique, or set replace_all to change every occurrence. Prefer Edit over rewriting a file with Write, and prefer this over `Bash sed/awk`.",
      parameters: {
        type: "object",
        properties: {
          filepath: { type: "string", description: "Path to edit" },
          old_str: { type: "string", description: "Exact text to replace" },
          new_str: { type: "string", description: "Replacement text" },
          replace_all: { type: "boolean", description: "Replace all occurrences (default false)" },
        },
        required: ["filepath", "old_str", "new_str"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "MultiEdit",
      description:
        "Apply multiple exact string replacements to one workspace file in a single operation, each applied in order to the result of the previous. Same matching rules as Edit (read first; exact match incl. whitespace; no `N: ` prefix). Use for several related changes to the same file.",
      parameters: {
        type: "object",
        properties: {
          filepath: { type: "string", description: "Path to edit" },
          edits: {
            type: "array",
            items: {
              type: "object",
              properties: {
                old_str: { type: "string" },
                new_str: { type: "string" },
                replace_all: { type: "boolean" },
              },
              required: ["old_str", "new_str"],
            },
          },
        },
        required: ["filepath", "edits"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "ApplyPatch",
      description:
        "Apply a multi-file patch in ONE atomic operation — the fastest way to make many related edits across several files at once. Provide a V4A-format patch. Every hunk is validated first and the whole patch is applied together: if any hunk fails to match, NOTHING is written and you get a precise error pointing at the failure. Matching is whitespace-tolerant, so minor indentation drift won't break it. Format:\n*** Begin Patch\n*** Update File: path/to/file.ts\n@@ optional context hint\n unchanged context line\n-removed line\n+added line\n*** Add File: path/to/new.ts\n+first line of new file\n+second line\n*** Delete File: path/to/old.ts\n*** End Patch\nEach update hunk should include a few unchanged context lines (prefixed with a space) around the change so it matches uniquely. Use Edit/MultiEdit for a single file; reach for ApplyPatch when a change spans multiple files.",
      parameters: {
        type: "object",
        properties: {
          patch: { type: "string", description: "The V4A-format patch text, including the '*** Begin Patch' / '*** End Patch' envelope." },
        },
        required: ["patch"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "Delete",
      description:
        "Permanently delete a file or directory. A relative path is workspace-relative; an absolute path targets the real machine (protected OS roots are refused). Deleting a non-empty directory requires `recursive: true`. This cannot be undone — only delete what the user asked for or files you created.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File or directory to delete" },
          recursive: { type: "boolean", description: "Required to delete a non-empty directory and its contents" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "Move",
      description:
        "Move or rename a file or directory. Use the same directory with a new name to rename, or a different directory to relocate. Paths are workspace-relative unless absolute (real machine; protected OS roots refused). Creates the destination's parent directory; pass `overwrite: true` to replace an existing destination.",
      parameters: {
        type: "object",
        properties: {
          source: { type: "string", description: "Existing file or directory to move" },
          destination: { type: "string", description: "New path (rename or relocate)" },
          overwrite: { type: "boolean", description: "Replace the destination if it already exists (default false)" },
        },
        required: ["source", "destination"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "Glob",
      description: "Find files matching a glob pattern (e.g. '**/*.tsx'). Fast; prefer this over `Bash find`. Returns matching workspace-relative paths.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Glob pattern" },
          path: { type: "string", description: "Directory to search (default workspace root)" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "Grep",
      description: "Search file contents with a regex (ripgrep). Prefer this over `Bash grep/rg`. Supports output_mode (content | files_with_matches | count), a glob filter, case-insensitive (-i), and line numbers (-n).",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Regex pattern" },
          path: { type: "string", description: "File or directory to search" },
          glob: { type: "string", description: "Glob filter, e.g. '*.ts'" },
          output_mode: { type: "string", enum: ["content", "files_with_matches", "count"] },
          "-i": { type: "boolean", description: "Case insensitive" },
          "-n": { type: "boolean", description: "Show line numbers" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "LS",
      description: "List files and directories at a workspace path. Use this instead of `Bash ls`.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Directory to list" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "WebSearch",
      description:
        "Search the live web and return ranked results (title, URL, snippet). Works on any provider — it does not depend on the configured model. Use this for current information, news, docs, or to find pages, then WebFetch a result URL to read it in full.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          num: { type: "number", description: "Number of results to return (default 8, max 15)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "WebFetch",
      description: "Fetch content from a URL (GET/POST). Returns status + body, useful for live info and reading pages.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to fetch" },
          method: { type: "string", enum: ["GET", "POST"] },
          headers: { type: "object", description: "HTTP headers" },
          body: { type: "string", description: "POST body" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "Open",
      description:
        "Open a URL/file/folder/protocol/app in the user's REAL, VISIBLE desktop session, AND control/manage visible browser tabs. Use action=open (default) for \"open this\", \"go to this site\", \"navigate to YouTube\", \"search/play this on YouTube\", \"show me this file\". Web URLs open in controllable-browser mode by default unless you explicitly pass control:false.\n\nIMPORTANT: visible browser work stays in Open control mode. For pages the user watches, use Open actions inspect/navigate/click/type/press/wait/screenshot plus tab actions. Do NOT load or call agent-browser for visible browser tasks; agent-browser is only for explicit headless/background/invisible automation.\n\nINSPECT-FIRST RULE: To understand what is on a page, ALWAYS use action=inspect first — it returns a structured text list of all visible interactive elements with CSS selectors, labels, roles, and values. No vision model is needed. Use action=screenshot ONLY when the user explicitly asks for a visual capture or to save a visual record; NEVER screenshot to \"see\" the page.\n\nBrowser actions: action=list_tabs (see tabs with id/title/url), action=close_tab (target_id or url/title substring), action=activate_tab, action=new_tab, action=close_browser, action=inspect (PREFERRED — structured text of all visible interactive elements, no vision needed), action=navigate (navigate the selected/active tab to target), action=click (selector, label/text, or x/y), action=type (focus selector/label or active element, then insert text), action=press (key/hotkey such as Enter, Ctrl+L), action=wait (milliseconds or until selector/text), action=screenshot (visual capture only when user asks — do NOT use to read page content). For invisible/background automation only, use the agent-browser headless skill.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["open", "list_tabs", "close_tab", "activate_tab", "new_tab", "close_browser", "inspect", "navigate", "click", "type", "press", "wait", "screenshot"], description: "What to do. Default 'open'. Browser control actions require a browser launched with control:true." },
          target: { type: "string", description: "For open/new_tab: URL, file path, folder, protocol, or app name. For close_tab/activate_tab: a url or title substring to match the tab." },
          target_id: { type: "string", description: "Exact tab/target id (from action=list_tabs) for close_tab/activate_tab." },
          app: { type: "string", description: "Optional app: 'spotify', 'brave', 'chrome', 'firefox', 'msedge', or another installed desktop app. Omit for the system default." },
          control: { type: "boolean", description: "Launch a visible Chromium browser with a debugging port so you can drive it and close/manage its exact tabs. Web URLs default to controllable mode; pass false only when the user explicitly wants an unmanaged default-browser open." },
          port: { type: "number", description: "CDP port for control mode / tab actions (default 9222; reuses the last controllable browser)." },
          selector: { type: "string", description: "CSS selector for inspect/click/type/focus/wait, e.g. input[name='search_query'] or a#video-title." },
          label: { type: "string", description: "Visible text, aria-label, title, placeholder, or value to find for click/type/wait when selector is not known." },
          text: { type: "string", description: "Text to insert for action=type, or text to wait for when action=wait." },
          key: { type: "string", description: "Key or hotkey for action=press, e.g. Enter, Space, Ctrl+L, Ctrl+A." },
          x: { type: "number", description: "Viewport X coordinate for action=click when selector/label are not used." },
          y: { type: "number", description: "Viewport Y coordinate for action=click when selector/label are not used." },
          clear: { type: "boolean", description: "For action=type, clear the focused/matched field before inserting text." },
          filename: { type: "string", description: "Optional base filename for action=screenshot; saved under virtual .vaultgate/download/screenshots in VaultGate Home." },
          amount: { type: "number", description: "Milliseconds for action=wait, default 1000." },
          timeout_ms: { type: "number", description: "Maximum wait time for selector/text waits, default 10000." },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "Desktop",
      description:
        "Control the user's real visible desktop on Windows using generic human-like primitives. Use after Open for installed apps and any non-browser visible UI. Actions: windows lists visible windows; focus brings a window forward; screenshot captures under virtual .vaultgate/download/screenshots in VaultGate Home. For only one app/window, pass target or hwnd with action=screenshot (or scope=window); it restores minimized windows briefly, captures only that window, then re-minimizes if needed. For full desktop, omit target/hwnd or set scope=screen. click/double_click/right_click/move/drag/scroll operate the mouse; type pastes text; press sends keys/hotkeys; clipboard_get/clipboard_set manage clipboard; wait pauses. This operates on the user's real machine, so be precise and do not send/post/delete externally visible content unless the user explicitly requested it.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["windows", "focus", "type", "press", "click", "double_click", "right_click", "move", "drag", "scroll", "screenshot", "clipboard_get", "clipboard_set", "wait"], description: "Desktop action to perform" },
          target: { type: "string", description: "Process/window title substring to target, e.g. WhatsApp, Antigravity, Spotify" },
          hwnd: { type: "string", description: "Optional exact window handle from Desktop windows" },
          scope: { type: "string", enum: ["screen", "window"], description: "For screenshot: screen captures the full desktop; window captures only target/hwnd or the active window." },
          window_only: { type: "boolean", description: "For screenshot: true captures only the target/hwnd window. Equivalent to scope=window." },
          text: { type: "string", description: "Text to type/paste for action=type" },
          key: { type: "string", description: "Key or hotkey for action=press, e.g. ENTER, CTRL+F, ALT+F4" },
          x: { type: "number", description: "Absolute screen X coordinate for action=click" },
          y: { type: "number", description: "Absolute screen Y coordinate for action=click" },
          x2: { type: "number", description: "Destination X coordinate for action=drag" },
          y2: { type: "number", description: "Destination Y coordinate for action=drag" },
          amount: { type: "number", description: "Scroll wheel amount or wait milliseconds depending on action" },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "BashOutput",
      description: "Read the captured output of a background command started with Bash run_in_background, or stop it. Returns whether it is still running plus its output so far.",
      parameters: {
        type: "object",
        properties: {
          bash_id: { type: "string", description: "The background id returned by Bash run_in_background" },
          kill: { type: "boolean", description: "Set true to stop the background process" },
        },
        required: ["bash_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "ListProcesses",
      description:
        "List the processes currently managed in this workspace — the dev server and any background commands started with Bash run_in_background — with their status, ports, and ids, plus runtime state. Bash commands resume from the tracked workspace cwd; safe exported env can persist. Use it to see what is already running before starting a server, or to find a background id to inspect with BashOutput.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "TodoWrite",
      description:
        "Create and update a structured task list for multi-step work (use when a task has 3+ meaningful steps). Send the full list each time. Keep exactly one task `in_progress`, and mark a task `completed` only after that step has actually succeeded — never batch-complete.",
      parameters: {
        type: "object",
        properties: {
          todos: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                content: { type: "string" },
                status: { type: "string", enum: ["pending", "in_progress", "completed"] },
                priority: { type: "string", enum: ["high", "medium", "low"] },
              },
              required: ["id", "content", "status"],
            },
          },
        },
        required: ["todos"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "Plan",
      description:
        "Present an implementation plan for the user to APPROVE before you write any code — the VaultGate plan-first workflow (Code mode). Provide the full plan as markdown: the goal, the files you will create/change, the approach, an ordered step list, and risks/verification. Calling Plan saves it as a plan file in the workspace AND shows it to the user as a rich approval card; your turn then ENDS and you must WAIT for their decision. Do NOT create, edit, run, or delete anything before approval. When the user approves, implement the plan exactly as written; if they request changes, revise and call Plan again. Use this whenever plan-first is enabled or the user asks to see a plan before implementation.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short title for the plan (e.g. 'Add OAuth login')" },
          plan: { type: "string", description: "The full implementation plan as markdown: goal, files to change, approach, ordered steps, risks, and how it will be verified." },
          files: { type: "array", items: { type: "string" }, description: "Optional list of key files the plan will create or modify." },
        },
        required: ["title", "plan"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "AskUserQuestion",
      description:
        "Ask the user a clarifying question when you genuinely need their input to proceed — a decision, preference, or missing detail you cannot reasonably infer. Provide 2-4 concrete options. This ends your turn and shows the user clickable choices; their selection arrives as their next message, and you continue from there. Use sparingly: prefer making a sensible default and stating it over asking.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "The question to ask the user" },
          header: { type: "string", description: "Optional short topic label (e.g. 'Framework', 'Auth method')" },
          options: {
            type: "array",
            description: "2-4 mutually-exclusive choices",
            items: {
              type: "object",
              properties: {
                label: { type: "string", description: "Short choice text" },
                description: { type: "string", description: "What this choice means / its trade-off" },
              },
              required: ["label"],
            },
          },
        },
        required: ["question", "options"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "Task",
      description:
        "Start a focused autonomous sub-agent in the background. The tool returns immediately with a sub-agent chat id so the parent can keep working; a completion report is appended to the parent chat when the sub-agent finishes. Use `explore` for read-only codebase research, `general` for implementation/research chunks, and `verification` to independently try to break non-trivial work. You may call Task multiple times in one turn to run sub-agents IN PARALLEL on independent, non-overlapping work. The sub-agent cannot see the chat — pass everything it needs in `prompt`, and have it return file paths, commands run, results, and residual risks.",
      parameters: {
        type: "object",
        properties: {
          description: { type: "string", description: "Short 3-7 word label for the sub-task" },
          subagent_type: { type: "string", enum: ["general", "explore", "verification"], description: "Agent specialization. Defaults to general." },
          prompt: { type: "string", description: "Detailed, self-contained instructions: full context, what to do, and exactly what to return" },
        },
        required: ["description", "prompt"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "Skill",
      description:
        "Load a specialized skill by name (e.g. 'charts', 'pdf', 'docx', 'xlsx', 'ppt', 'agent-browser'). Returns expert instructions to follow for that domain. Load a skill before starting non-code domain work it covers; software engineering belongs to Code mode, not software-development skills. Do not load agent-browser for visible browser opening/navigation/search/play/click/type; use Open control mode instead. Use agent-browser for explicit headless/background/invisible browser automation. For plain web search/reading use the WebSearch/WebFetch tools directly — no skill needed.",
      parameters: {
        type: "object",
        properties: { command: { type: "string", description: "Skill name to load" } },
        required: ["command"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "Kanban",
      description:
        "A durable task board for this chat — a stronger alternative to TodoWrite for plans that must survive context compaction, app restarts, or multi-session work. Unlike TodoWrite (an ephemeral checklist), Kanban cards persist on disk with status, priority, comments, and blocked-by links. One action-based tool: action=create (title + optional body/priority), action=list (optionally filter by status), action=show (one card by id), action=update (change status/title/body/priority), action=comment (append a note), action=link (set blocked_by card ids), action=delete. Statuses: todo, doing, blocked, done. Keep one card in 'doing' at a time and move cards to 'done' only when the work is actually finished and verified.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["create", "list", "show", "update", "comment", "link", "delete"], description: "Board operation. Default 'list'." },
          id: { type: "string", description: "Card id (e.g. 'c3') for show/update/comment/link/delete." },
          title: { type: "string", description: "Card title for action=create, or a new title for action=update." },
          body: { type: "string", description: "Optional longer description/details for create/update." },
          status: { type: "string", enum: ["todo", "doing", "blocked", "done"], description: "Status for create/update, or a filter for action=list." },
          priority: { type: "string", enum: ["high", "medium", "low"], description: "Priority for create/update (default medium)." },
          comment: { type: "string", description: "Note to append for action=comment." },
          blocked_by: { type: "array", items: { type: "string" }, description: "Card ids this card is blocked by, for action=link." },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "RecallSessions",
      description:
        "Explore the user's OWN chats — your durable memory of everything worked on with them — read LIVE from the local database, so chats that are still running are visible too. This is real conversation access, not a guess-the-keyword search. Actions:\n• action=list — every chat with title, message count, and its opening goal, newest first, plus the total count (use this to answer \"how many chats do we have\").\n• action=recent — the most recently active chats (default when you just need context).\n• action=read — dump a specific chat by chat_id to see exactly what was done there (works even while that chat is actively running).\n• action=search — keyword search across all messages when you need to pinpoint a specific term; returns chat title, snippet, and chat_id (then action=read that chat_id for the full picture).\nPrefer list/recent/read to build context fast; reach for search only when hunting a known keyword. Everything is local to this machine.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "recent", "search", "read"], description: "What to do. Defaults: read if chat_id is given, search if query is given, else recent." },
          query: { type: "string", description: "Search text for action=search." },
          chat_id: { type: "string", description: "Chat id to open for action=read (from list/recent/search results)." },
          limit: { type: "number", description: "Max results/messages (default 20, max 200)." },
          include_current: { type: "boolean", description: "Include the current chat (default false — usually you want OTHER chats)." },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "MultiModel",
      description:
        "Fan a single prompt across several models on the configured provider IN PARALLEL, then synthesize one consensus answer that reconciles their agreements and disagreements. Use for high-stakes reasoning, hard judgment calls, fact-checking, or when you want more than one model's perspective before committing. Returns each model's individual answer plus a synthesized best answer. Costs several model calls — reserve it for questions where a second opinion genuinely matters.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "The question or task to send to every model" },
          models: { type: "array", items: { type: "string" }, description: "Model ids to query. If omitted, uses up to 3 of the provider's available models." },
          system: { type: "string", description: "Optional shared system instruction for all models" },
        },
        required: ["prompt"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "Schedule",
      description:
        "Schedule a task to run later or on a recurring interval, even after this turn ends. When a job is due, VaultGate runs a real autonomous agent turn (like the Task tool) against THIS chat's workspace using your prompt, and appends the result to the chat — so a schedule actually performs work, not just reminds. Jobs persist on disk and resume when the app restarts; missed runs catch up on next launch. action=create (prompt + delay_seconds and/or interval_seconds), action=list, action=cancel (job id). Minimum interval is 60s. Confirm with the user before scheduling anything that sends messages, spends money, or has external side effects.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["create", "list", "cancel"], description: "Default 'list'." },
          prompt: { type: "string", description: "For action=create: the self-contained instructions the scheduled agent turn will execute." },
          title: { type: "string", description: "Optional short label for the job." },
          delay_seconds: { type: "number", description: "For action=create: seconds from now until the first run." },
          interval_seconds: { type: "number", description: "For action=create: repeat every N seconds (>=60). Omit for a one-time job." },
          id: { type: "string", description: "Job id for action=cancel." },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "XSearch",
      description:
        "Search X (Twitter) and social posts for recent public discussion, reactions, announcements, or real-time sentiment on a topic — the place to look for what people are saying right now rather than published articles. Returns ranked posts/threads with links. For general web research use WebSearch; for reading a specific page use WebFetch.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to search for on X/Twitter" },
          num: { type: "number", description: "Number of results (default 8, max 15)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "SwitchMode",
      description:
        "Change your operating mode when the task needs different capabilities. Modes: 'code' = VaultGate Code, the Claude-Code-style software engineering branch with Read, Write, Edit, MultiEdit, ApplyPatch, Bash, BashOutput, ListProcesses, Glob, Grep, LS, WebSearch, WebFetch, XSearch, TodoWrite, Kanban, RecallSessions, MultiModel, Schedule, Task, Skill, Delete, and Move; 'agent' = general autonomous operator with every tool including Open browser control and native Desktop automation; 'chat' = conversation, web/X search, past-chat recall, and file reading only. In Auto mode, YOU decide from the request and call SwitchMode; there is no client-side keyword router. Use code for anything code-related or codebase-related, including exploring repos, writing/editing files, debugging, refactoring, implementing features, creating/scaffolding/recreating software projects, installing deps, and running tests/builds. Use agent for opening visible websites/web apps, controlling browser tabs, playing/searching/watching media, background/headless browser automation, native desktop control, or broad non-code automation. Do not interpret natural-language media requests as shell commands unless the user clearly names a command/script/package. If a request needs capabilities your current mode lacks, call SwitchMode FIRST, then do the work. Switch only when genuinely needed; do not toggle back and forth.",
      parameters: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["agent", "code", "chat"], description: "Target mode to switch into" },
          reason: { type: "string", description: "One short sentence on why the switch is needed" },
        },
        required: ["mode"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "Vision",
      description:
        "Analyze images and video — describe scenes, OCR text, detect/count objects, compare images, read charts/screenshots, generate alt text. Use whenever the user supplies an image or video (URL or local path) and wants it analyzed. Works with any multimodal model configured in Settings. If the model does not support images, tell the user to set a vision-capable model.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "What to analyze or extract from the image(s)" },
          images: { type: "array", items: { type: "string" }, description: "Image URLs or local file paths to analyze" },
          output: { type: "string", description: "Optional file path to save the analysis text" },
          thinking: { type: "boolean", description: "Enable extended thinking for harder reasoning (counting, spatial)" },
        },
        required: ["prompt", "images"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "ImageGenerate",
      description:
        "Generate images from text prompts — illustrations, concept art, icons, hero images, product mockups, textures, og-images. Requires a provider/model with an image generation endpoint configured in Settings. If the call fails as unsupported, tell the user to configure an image-capable model — do not retry.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Text description of the image to generate" },
          output: { type: "string", description: "File path to save the image (default: download/generated-image.png)" },
          size: { type: "string", description: "Image dimensions, e.g. 1024x1024" },
          count: { type: "number", description: "Number of images to generate (default 1)" },
        },
        required: ["prompt"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "ImageEdit",
      description:
        "Edit or transform an existing image — restyle, recolor, inpaint/remove or add elements, change background, upscale, make variations. Use when the user supplies an image and wants it modified rather than described (use Vision) or generated from scratch (use ImageGenerate). Requires a provider with an image edit endpoint.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Description of the edit to apply" },
          input: { type: "string", description: "Source image path or URL" },
          output: { type: "string", description: "File path to save the edited image" },
        },
        required: ["prompt", "input"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "Transcribe",
      description:
        "Transcribe speech to text from audio files (and audio tracks of video) — meetings, voice notes, podcasts, interviews. Requires a provider with an audio transcription endpoint. For video, extract audio first with ffmpeg if needed.",
      parameters: {
        type: "object",
        properties: {
          input: { type: "string", description: "Audio or video file path to transcribe" },
          output: { type: "string", description: "Optional file path to save the transcript" },
          language: { type: "string", description: "Language hint (e.g. 'en', 'fr')" },
        },
        required: ["input"],
      },
    },
  },
];

const ALIASES: Record<string, string> = {
  bash: "Bash",
  command: "Bash",
  read: "Read",
  write: "Write",
  edit: "Edit",
  multiedit: "MultiEdit",
  multi_edit: "MultiEdit",
  applypatch: "ApplyPatch",
  apply_patch: "ApplyPatch",
  patch: "ApplyPatch",
  delete: "Delete",
  delete_file: "Delete",
  remove: "Delete",
  rm: "Delete",
  move: "Move",
  move_file: "Move",
  rename: "Move",
  mv: "Move",
  glob: "Glob",
  grep: "Grep",
  ls: "LS",
  list: "LS",
  webfetch: "WebFetch",
  web_fetch: "WebFetch",
  bashoutput: "BashOutput",
  bash_output: "BashOutput",
  killshell: "BashOutput",
  open: "Open",
  openurl: "Open",
  open_url: "Open",
  openbrowser: "Open",
  launch: "Open",
  desktop: "Desktop",
  computer: "Desktop",
  computeruse: "Desktop",
  computer_use: "Desktop",
  nativeapp: "Desktop",
  native_app: "Desktop",
  websearch: "WebSearch",
  web_search: "WebSearch",
  search: "WebSearch",
  todowrite: "TodoWrite",
  todo_write: "TodoWrite",
  todoread: "TodoWrite",
  skill: "Skill",
  task: "Task",
  agent: "Task",
  subagent: "Task",
  listprocesses: "ListProcesses",
  processes: "ListProcesses",
  ps: "ListProcesses",
  kanban: "Kanban",
  board: "Kanban",
  recallsessions: "RecallSessions",
  recall_sessions: "RecallSessions",
  sessionsearch: "RecallSessions",
  session_search: "RecallSessions",
  searchsessions: "RecallSessions",
  searchhistory: "RecallSessions",
  multimodel: "MultiModel",
  multi_model: "MultiModel",
  mixtureofagents: "MultiModel",
  mixture_of_agents: "MultiModel",
  moa: "MultiModel",
  schedule: "Schedule",
  cron: "Schedule",
  cronjob: "Schedule",
  scheduletask: "Schedule",
  xsearch: "XSearch",
  x_search: "XSearch",
  twittersearch: "XSearch",
  twitter_search: "XSearch",
  askuserquestion: "AskUserQuestion",
  ask_user_question: "AskUserQuestion",
  askquestion: "AskUserQuestion",
  plan: "Plan",
  implementationplan: "Plan",
  implementation_plan: "Plan",
  presentplan: "Plan",
  switchmode: "SwitchMode",
  switch_mode: "SwitchMode",
  setmode: "SwitchMode",
  set_mode: "SwitchMode",
  changemode: "SwitchMode",
  change_mode: "SwitchMode",
  vision: "Vision",
  vision_analyze: "Vision",
  analyze_image: "Vision",
  imagegenerate: "ImageGenerate",
  image_generate: "ImageGenerate",
  generateimage: "ImageGenerate",
  generate_image: "ImageGenerate",
  imagegen: "ImageGenerate",
  image_gen: "ImageGenerate",
  imageedit: "ImageEdit",
  image_edit: "ImageEdit",
  editimage: "ImageEdit",
  edit_image: "ImageEdit",
  transcribe: "Transcribe",
  asr: "Transcribe",
  speech_to_text: "Transcribe",
  transcription: "Transcribe",
};

export function canonicalToolName(name: string): string {
  const normalized = String(name || "")
    .trim()
    .replace(/^functions\./i, "")
    .replace(/[^a-z0-9_-]/gi, "")
    .toLowerCase();
  return ALIASES[normalized] || name;
}

const WORKSPACE_TOOLS = new Set(["Bash", "BashOutput", "ListProcesses", "Read", "Write", "Edit", "MultiEdit", "ApplyPatch", "Delete", "Move", "Glob", "Grep", "LS", "TodoWrite", "Kanban", "Plan", "Vision", "ImageGenerate", "ImageEdit", "Transcribe"]);
const WORKSPACE_SKILLS = new Set([
  "agent-browser",
  "agentbrowser",
  "browser",
  "web-browser",
  "charts",
  "docx",
  "document",
  "pdf",
  "powerpoint",
  "ppt",
  "pptx",
  "presentation",
  "skill-creator",
  "web-shader-extractor",
  "word",
  "xls",
  "xlsx",
]);

export function toolNeedsWorkspace(name: string, args?: Record<string, unknown>): boolean {
  const canonical = canonicalToolName(name);
  if (WORKSPACE_TOOLS.has(canonical)) return true;
  if (canonical === "Skill") {
    const skill = String(args?.command || "").trim().toLowerCase();
    return WORKSPACE_SKILLS.has(skill);
  }
  return false;
}

// ── Mode capability tree ──────────────────────────────────────
// Composable tool groups; each mode (branch) is built from groups, so the
// policy is declarative data — not conditionals scattered across the loop.
// SwitchMode + AskUserQuestion are always present so any branch can escalate
// and clarify. Visible browser/desktop control belongs to Agent, not Code.
const CONTROL_TOOLS = ["AskUserQuestion", "SwitchMode"];

const ALL_TOOL_NAMES = AGENT_TOOLS.map((t) => t.function.name);
const CODE_TOOL_NAMES = ALL_TOOL_NAMES.filter((name) => name !== "Desktop" && name !== "Open");
const CHAT_TOOL_NAMES = ["Read", "Glob", "Grep", "LS", "WebSearch", "WebFetch", "RecallSessions", "XSearch", "Vision", "Transcribe", ...CONTROL_TOOLS];

// The three branches. Adding a mode is one entry here.
export const MODE_TOOLNAMES: Record<ChatMode, readonly string[]> = {
  // Unlimited: every tool, including native-desktop automation.
  agent: ALL_TOOL_NAMES,
  // Full software-engineering toolset: Read/Write/Edit/MultiEdit, Bash,
  // search, web research, process/output tools, TodoWrite, Task, Skill, etc.
  code: CODE_TOOL_NAMES,
  // Conversation only: read + research + clarify + escalate. No building.
  chat: CHAT_TOOL_NAMES,
};

function modeToolSet(mode: ChatMode): Set<string> {
  return new Set(MODE_TOOLNAMES[mode] ?? MODE_TOOLNAMES.agent);
}

/**
 * The tool definitions a given mode may use (filtered AGENT_TOOLS). When
 * `canSwitch` is false (a manually-locked mode), SwitchMode is withheld so the
 * model stays on its branch.
 */
export function toolsForMode(mode: ChatMode, canSwitch = true): typeof AGENT_TOOLS {
  const allowed = modeToolSet(mode);
  return AGENT_TOOLS.filter((t) => allowed.has(t.function.name) && (canSwitch || t.function.name !== "SwitchMode"));
}

/** Whether a (possibly aliased) tool name is permitted in the given mode. */
export function isToolAllowed(mode: ChatMode, name: string, canSwitch = true): boolean {
  const canonical = canonicalToolName(name);
  if (canonical === "SwitchMode") return canSwitch;
  return modeToolSet(mode).has(canonical);
}
