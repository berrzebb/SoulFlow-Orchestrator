import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

function parse_line(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const eq = trimmed.indexOf("=");
  if (eq <= 0) return null;
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

function load_one(path: string): number {
  if (!existsSync(path)) return 0;
  const raw = readFileSync(path, "utf-8");
  let loaded = 0;
  for (const line of raw.split(/\r?\n/)) {
    const parsed = parse_line(line);
    if (!parsed) continue;
    process.env[parsed.key] = parsed.value;
    loaded += 1;
  }
  return loaded;
}

export function load_env_files(workspace: string): { loaded: number; files: string[] } {
  const base = resolve(workspace);
  const candidates = [
    join(base, "..", ".env"),
    join(base, "..", ".env.local"),
    join(base, ".env"),
    join(base, ".env.local"),
  ];
  let loaded = 0;
  const files: string[] = [];
  for (const path of candidates) {
    const n = load_one(path);
    if (n > 0) {
      loaded += n;
      files.push(path);
    }
  }
  return { loaded, files };
}
