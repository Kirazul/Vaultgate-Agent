import "server-only";
import path from "node:path";
import { existsSync } from "node:fs";
import { getDataDir } from "@/lib/config/env";

/** Bundled skills directory (`src/skills/`, overridable via env). */
export function skillsDir(): string {
  const cwd = /* turbopackIgnore: true */ process.cwd();
  const candidates = [
    process.env.VAULTGATE_SKILLS_DIR,
    path.join(cwd, "src", "skills"),
    path.join(cwd, "skills"), // legacy fallback (pre-move layout)
    path.join(cwd, "..", "src", "skills"),
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    const resolved = path.resolve(c);
    if (existsSync(resolved)) return resolved;
  }
  return path.join(cwd, "src", "skills");
}

/** User-installed skills directory (drop custom skills here; they extend and
 * override the bundled set). Lives under the app data dir so it persists. */
export function userSkillsDir(): string {
  return path.join(/* turbopackIgnore: true */ getDataDir(), "skills");
}

/** All skill source directories, in precedence order (user skills win). */
export function skillSearchDirs(): string[] {
  return [userSkillsDir(), skillsDir()].filter((d, i, arr) => arr.indexOf(d) === i);
}
