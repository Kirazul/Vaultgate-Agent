// ============================================================
// Server-only configuration & paths.
// User-data-dir aware: in the packaged Electron app the data dir
// is injected via VAULTGATE_DATA_DIR (set by electron/main.ts);
// in dev it falls back to ./.data.
// ============================================================
import path from "node:path";
import { mkdirSync } from "node:fs";

export function getDataDir(): string {
  const dir = process.env.VAULTGATE_DATA_DIR
    ? path.resolve(process.env.VAULTGATE_DATA_DIR)
    : path.join(/* turbopackIgnore: true */ process.cwd(), ".data");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getDbPath(): string {
  return path.join(getDataDir(), "vaultgate.db");
}

/** First-run provider defaults seeded from env (runtime values live in SQLite). */
export function getProviderDefaults() {
  return {
    endpoint: (process.env.OPENAI_API_ENDPOINT || "").trim().replace(/\/+$/, ""),
    apiKey: process.env.OPENAI_API_KEY || "",
    model: (process.env.DEFAULT_MODEL || "").trim(),
  };
}
