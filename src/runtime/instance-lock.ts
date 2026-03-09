import { now_iso } from "../utils/common.js";
import { createHash } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

type LockPayload = {
  pid: number;
  started_at: string;
  cwd: string;
  key: string;
};

export type RuntimeInstanceLockHandle = {
  key: string;
  lock_path: string;
  holder_pid: number | null;
  acquired: boolean;
  release: () => Promise<void>;
};

function process_alive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function normalize_token(value: unknown): string {
  return String(value || "").trim();
}

function build_lock_key(workspace: string): string {
  const provider = normalize_token(process.env.CHANNEL_PROVIDER || "mixed").toLowerCase();
  const tokens = [
    normalize_token(process.env.SLACK_BOT_TOKEN),
    normalize_token(process.env.DISCORD_BOT_TOKEN),
    normalize_token(process.env.TELEGRAM_BOT_TOKEN),
  ].filter(Boolean);
  const source = tokens.length > 0 ? tokens.sort().join("|") : `cwd:${resolve(workspace)}`;
  return createHash("sha1")
    .update(`${provider}|${source}`, "utf-8")
    .digest("hex")
    .slice(0, 24);
}

async function read_lock_payload(lock_path: string): Promise<LockPayload | null> {
  const raw = await readFile(lock_path, "utf-8").catch(() => "");
  if (!raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    return {
      pid: Number(obj.pid || 0),
      started_at: String(obj.started_at || ""),
      cwd: String(obj.cwd || ""),
      key: String(obj.key || ""),
    };
  } catch {
    return null;
  }
}

async function try_acquire_lock(lock_path: string, key: string): Promise<{ ok: boolean; holder_pid: number | null }> {
  await mkdir(dirname(lock_path), { recursive: true });
  try {
    const fd = await open(lock_path, "wx");
    try {
      const payload: LockPayload = {
        pid: process.pid,
        started_at: now_iso(),
        cwd: process.cwd(),
        key,
      };
      await fd.writeFile(`${JSON.stringify(payload)}\n`, "utf-8");
    } finally {
      await fd.close();
    }
    return { ok: true, holder_pid: process.pid };
  } catch (error) {
    const code = (error as { code?: string } | null)?.code || "";
    if (code !== "EEXIST") return { ok: false, holder_pid: null };
  }

  const holder = await read_lock_payload(lock_path);
  const holder_pid = Number(holder?.pid || 0) || null;
  if (holder_pid && process_alive(holder_pid)) {
    return { ok: false, holder_pid };
  }
  await unlink(lock_path).catch(() => undefined);
  return { ok: false, holder_pid };
}

export async function acquire_runtime_instance_lock(args: {
  workspace: string;
  retries?: number;
  retry_ms?: number;
}): Promise<RuntimeInstanceLockHandle> {
  const workspace = args.workspace;
  const retries = Math.max(1, Number(args?.retries || 20));
  const retry_ms = Math.max(50, Number(args?.retry_ms || 200));
  const key = build_lock_key(workspace);
  const lock_path = join(resolve(workspace), "runtime", ".locks", `${key}.lock`);
  let last_holder_pid: number | null = null;

  for (let i = 0; i < retries; i += 1) {
    const attempt = await try_acquire_lock(lock_path, key);
    if (attempt.ok) {
      const release = async (): Promise<void> => {
        const payload = await read_lock_payload(lock_path);
        if (Number(payload?.pid || 0) !== process.pid) return;
        await unlink(lock_path).catch(() => undefined);
      };
      return {
        key,
        lock_path,
        holder_pid: process.pid,
        acquired: true,
        release,
      };
    }
    last_holder_pid = attempt.holder_pid;
    if (i < retries - 1) await sleep(retry_ms);
  }

  return {
    key,
    lock_path,
    holder_pid: last_holder_pid,
    acquired: false,
    release: async () => undefined,
  };
}

