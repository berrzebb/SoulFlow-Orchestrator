import { access, mkdir, readFile } from "node:fs/promises";

export function now_ms(): number {
  return Date.now();
}

export function now_iso(): string {
  return new Date().toISOString();
}

export function today_key(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function file_exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function ensure_dir(path: string): Promise<string> {
  await mkdir(path, { recursive: true });
  return path;
}

export function safe_filename(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}

export async function read_text_if_exists(path: string): Promise<string | null> {
  if (!(await file_exists(path))) return null;
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

