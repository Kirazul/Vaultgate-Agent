// ============================================================
// Skills library (server-only).
// Skills are markdown instruction packs the agent can load on
// demand. This module builds the inventory for the system prompt
// and loads a skill's SKILL.md, normalized to the local runtime.
// ============================================================
import "server-only";
import path from "node:path";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, type Dirent } from "node:fs";
import { resolvedRoot } from "./resolved-roots";
import { skillSearchDirs, userSkillsDir } from "./skill-paths";

const ALIASES: Record<string, string> = {
  agentbrowser: "agent-browser",
  browser: "agent-browser",
  "web-browser": "agent-browser",
  uiux: "ui-ux-pro-max",
  design: "visual-design-foundations",
  search: "web-search",
  reader: "web-reader",
  pptx: "ppt",
  powerpoint: "ppt",
  presentation: "ppt",
  word: "docx",
  document: "docx",
  excel: "xlsx",
  xls: "xlsx",
  spreadsheet: "xlsx",
  autodiagram: "auto-diagram",
  "diagram-repo": "auto-diagram",
  "excalidraw-toolkit": "excalidraw",
};

export interface SkillMeta {
  name: string;
  description: string;
}

let inventoryCache: { text: string; at: number } | null = null;

function extractDescription(content: string): string {
  const inline = content.match(/^description:\s*["']?([^"'\n|>]+)["']?/m)?.[1]?.trim();
  if (inline) return inline;

  const lines = content.split(/\r?\n/);
  const descriptionIndex = lines.findIndex((line) => /^description:\s*[|>]\s*$/.test(line));
  if (descriptionIndex !== -1) {
    const body = lines
      .slice(descriptionIndex + 1)
      .filter((line) => /^\s+\S/.test(line))
      .map((line) => line.trim())
      .find(Boolean);
    if (body) return body;
  }

  return content.match(/^#\s+(.+)$/m)?.[1]?.trim() || "";
}

function resolveSkillDirectoryName(name: string): string | null {
  const requested = ALIASES[name.toLowerCase()] || name;
  for (const dir of skillSearchDirs()) {
    if (!existsSync(dir)) continue;
    if (existsSync(path.join(dir, requested, "SKILL.md"))) return requested;
    try {
      const match = readdirSync(dir, { withFileTypes: true }).find((entry) => entry.isDirectory() && entry.name.toLowerCase() === requested.toLowerCase());
      if (match) return match.name;
    } catch {
      /* try next dir */
    }
  }
  return requested;
}

/** List installed skills (user skills + bundled) with a one-line description.
 * User skills (first dir) take precedence over bundled ones of the same name. */
export function listSkills(): SkillMeta[] {
  const seen = new Map<string, SkillMeta>();
  for (const dir of skillSearchDirs()) {
    if (!existsSync(dir)) continue;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || seen.has(entry.name)) continue;
      const skillFile = path.join(dir, entry.name, "SKILL.md");
      if (!existsSync(skillFile)) continue;
      let description = "";
      try {
        description = extractDescription(readFileSync(skillFile, "utf-8").slice(0, 1500));
      } catch {
        /* ignore */
      }
      seen.set(entry.name, { name: entry.name, description });
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export interface SkillEntry extends SkillMeta {
  /** "user" skills live in the data-dir and can be edited/deleted; "bundled" ship with the app. */
  source: "user" | "bundled";
}

function userSkillNames(): Set<string> {
  const names = new Set<string>();
  try {
    for (const entry of readdirSync(userSkillsDir(), { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(path.join(userSkillsDir(), entry.name, "SKILL.md"))) names.add(entry.name);
    }
  } catch {
    /* no user skills dir yet */
  }
  return names;
}

/** Skills with their origin, for the Inventory UI. */
export function listSkillsWithSource(): SkillEntry[] {
  const userNames = userSkillNames();
  return listSkills().map((s) => ({ ...s, source: userNames.has(s.name) ? "user" : "bundled" }));
}

/** Create a user skill from the guided form. Writes a native SKILL.md to the
 * user skills dir (which takes precedence over bundled). */
export function createUserSkill(input: { name: string; description: string; instructions: string }): { ok: boolean; error?: string; name?: string } {
  const slug = input.name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9._-]/g, "");
  if (!slug || !/^[a-z0-9][a-z0-9._-]*$/.test(slug)) return { ok: false, error: "Use a name with letters, numbers, and dashes (e.g. my-skill)." };
  const description = input.description.trim().replace(/\s+/g, " ");
  if (!description) return { ok: false, error: "A description is required — it's how the agent knows when to use the skill." };
  const dir = path.join(userSkillsDir(), slug);
  const file = path.join(dir, "SKILL.md");
  if (existsSync(file)) return { ok: false, error: `A skill named "${slug}" already exists.` };
  const title = input.name.trim() || slug;
  const body = input.instructions.trim() || "Describe the steps the agent should follow here.";
  const content = `---\nname: ${slug}\ndescription: "${description.replace(/"/g, "'")}"\nlicense: MIT\n---\n\n# ${title}\n\n${body}\n`;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, content, "utf-8");
    inventoryCache = null;
    return { ok: true, name: slug };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to write the skill file." };
  }
}

/** Import a skill from an uploaded/pasted SKILL.md (Claude-Code-style: a skill
 * is just a SKILL.md). Derives the name from frontmatter `name:` or the
 * filename, ensures valid frontmatter, and writes it to the user skills dir. */
export function importUserSkill(content: string, filename?: string): { ok: boolean; error?: string; name?: string } {
  if (!content || !content.trim()) return { ok: false, error: "The file is empty." };

  let name = content.match(/^\s*name:\s*["']?([A-Za-z0-9._-]+)["']?/m)?.[1]?.trim() || "";
  if (!name && filename) {
    const base = filename.replace(/\.(md|markdown|txt)$/i, "").split(/[\\/]/).pop() || "";
    if (base && !/^skill$/i.test(base)) name = base;
  }
  const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9._-]/g, "");
  if (!slug || !/^[a-z0-9][a-z0-9._-]*$/.test(slug)) {
    return { ok: false, error: "Couldn't determine a skill name. Add a `name:` line to the frontmatter, or name the file like `my-skill.md`." };
  }

  const dir = path.join(userSkillsDir(), slug);
  const file = path.join(dir, "SKILL.md");
  if (existsSync(file)) return { ok: false, error: `A skill named "${slug}" already exists.` };

  const lines = content.split(/\r?\n/);
  let final = content;
  if ((lines[0] || "").trim() !== "---") {
    // No frontmatter — wrap it, deriving a description from the first real line.
    const firstLine = lines.find((l) => l.trim()) || slug;
    const description = firstLine.replace(/^#+\s*/, "").replace(/"/g, "'").slice(0, 200);
    final = `---\nname: ${slug}\ndescription: "${description}"\nlicense: MIT\n---\n\n${content.trim()}\n`;
  } else if (!/^name:/m.test(content)) {
    // Frontmatter present but missing name — inject it after the opening fence.
    final = content.replace(/^---\s*\r?\n/, `---\nname: ${slug}\n`);
  }

  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, final, "utf-8");
    inventoryCache = null;
    return { ok: true, name: slug };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to write the skill." };
  }
}

/** Delete a user-created skill (bundled skills are protected). */
export function deleteUserSkill(name: string): { ok: boolean; error?: string } {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return { ok: false, error: "Invalid skill name." };
  const dir = path.join(userSkillsDir(), name);
  if (!existsSync(path.join(dir, "SKILL.md"))) return { ok: false, error: "Only your own (user-created) skills can be deleted here." };
  try {
    rmSync(dir, { recursive: true, force: true });
    inventoryCache = null;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to delete the skill." };
  }
}

/** Read a skill's raw SKILL.md (for the Inventory detail view). */
export function readSkillSource(name: string): { name: string; content: string; source: "user" | "bundled" } | null {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return null;
  const resolved = resolveSkillDirectoryName(name);
  if (!resolved) return null;
  const userNames = userSkillNames();
  for (const dir of skillSearchDirs()) {
    const file = path.join(dir, resolved, "SKILL.md");
    if (existsSync(file)) {
      try {
        return { name: resolved, content: readFileSync(file, "utf-8"), source: userNames.has(resolved) ? "user" : "bundled" };
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function skillInventoryText(): string {
  // Cache for the process lifetime (5 min TTL) — avoids re-reading
  // ~50 SKILL.md files on every chat request.
  if (inventoryCache && Date.now() - inventoryCache.at < 60 * 1000) return inventoryCache.text;
  const skills = listSkills();
  const text = skills.length
    ? skills.map((s) => (s.description ? `- ${s.name}: ${s.description}` : `- ${s.name}`)).join("\n")
    : "- (no skills installed)";
  inventoryCache = { text, at: Date.now() };
  return text;
}

/** Locate a skill's SKILL.md across the workspace + search dirs, or null. */
function findSkillFile(resolved: string, chatId?: string): string | null {
  const candidates = [
    chatId ? path.join(resolvedRoot(chatId), "skills", resolved, "SKILL.md") : "",
    ...skillSearchDirs().map((dir) => path.join(dir, resolved, "SKILL.md")),
  ].filter(Boolean);
  return candidates.find((c) => existsSync(c)) ?? null;
}

/** Lenient relevance score of a requested name against an installed skill name. */
function scoreSkill(query: string, name: string): number {
  const q = query.toLowerCase();
  const n = name.toLowerCase();
  if (q === n) return 100;
  if (n.includes(q) || q.includes(n)) return 70;
  const qt = q.split(/[-_ .]+/).filter(Boolean);
  const nt = n.split(/[-_ .]+/).filter(Boolean);
  return qt.filter((t) => t.length > 1 && nt.some((x) => x.includes(t) || t.includes(x))).length * 25;
}

export function loadSkill(name: string, chatId?: string): string {
  const skillName = name.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(skillName)) return "Error: Invalid skill name.";
  let resolved = resolveSkillDirectoryName(skillName);
  let file = resolved ? findSkillFile(resolved, chatId) : null;

  // Fuzzy fallback: a near-miss name (typo, plural, partial) auto-resolves to a
  // confident single match; otherwise we return the closest names so the model
  // retries with a real one instead of failing blindly.
  if (!file) {
    const ranked = listSkills()
      .map((s) => ({ name: s.name, score: scoreSkill(skillName, s.name) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    if (ranked.length && ranked[0].score >= 70 && (ranked.length === 1 || ranked[0].score > ranked[1].score)) {
      resolved = ranked[0].name;
      file = findSkillFile(resolved, chatId);
    }
    if (!file) {
      const suggestions = ranked.slice(0, 5).map((x) => x.name);
      return `Skill '${skillName}' not found.${suggestions.length ? ` Closest available: ${suggestions.join(", ")}. Load one of those exact names.` : " See the skill inventory for available skills."}`;
    }
  }

  try {
    const raw = readFileSync(file, "utf-8");
    const content = normalizeSkill(raw, path.dirname(file), chatId);
    const max = 12000;
    return `Skill loaded: ${resolved}\n\n${content.slice(0, max)}${content.length > max ? "\n\n... (truncated — Read the SKILL.md and its scripts/ for the rest)" : ""}`;
  } catch (err) {
    return `Error loading skill '${skillName}': ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * Resolve placeholders to concrete runtime paths and prepend a short runtime
 * header. VaultGate skills are authored native (no vendor branding to strip),
 * so this only does path substitution — `${SKILL_DIR}` → the skill's own
 * directory (for referencing bundled scripts/refs), and the workspace root.
 * Legacy `{Skill Location}` / `{project_path}` tokens are still mapped so any
 * not-yet-rebuilt skill keeps working during the migration.
 */
function normalizeSkill(content: string, skillDir: string, chatId?: string): string {
  const dir = skillDir.replace(/\\/g, "/");
  const root = chatId ? resolvedRoot(chatId).replace(/\\/g, "/") : "the current workspace";
  const shellNote =
    process.platform === "win32"
      ? "Terminal commands run in PowerShell on Windows (pwsh when available, Windows PowerShell fallback). Avoid bash-only syntax (`mkdir -p`, `cat > file`, heredocs); use Write/Edit to create files."
      : "Terminal commands run in bash. Prefer Write/Edit over shell redirection for source files.";
  const runtimeNote =
    `> **Runtime:** local-first VaultGate workspace at \`${root}\`. ` +
    `Bash uses a persistent workspace cwd: first command starts at the workspace root, then \`cd\` persists; if the captured cwd is outside the workspace it snaps back to root. ` +
    `\`${SKILL_DIR_TOKEN}\` in this skill resolves to \`${dir}\` — run its bundled scripts by absolute path. ` +
    `Keep source/project files in normal project paths. Use virtual \`.vaultgate/...\` only for VaultGate-managed uploads, screenshots, downloads, plans, todos, runtime state, and temporary artifacts. ` +
    `${shellNote}\n\n`;

  const body = content
    .replace(new RegExp(escapeRegExp(SKILL_DIR_TOKEN), "g"), dir)
    .replace(/\{Skill Location\}/g, dir)
    .replace(/\{project_path\}\/skills\/[A-Za-z0-9._-]+/g, dir)
    .replace(/\{project_path\}/g, root);

  return runtimeNote + body;
}

const SKILL_DIR_TOKEN = "${SKILL_DIR}";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
