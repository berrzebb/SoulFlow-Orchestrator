import { now_iso } from "../utils/common.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { hostname as os_hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

type LockPayload = {
  pid: number;
  started_at: string;
  cwd: string;
  key: string;
  hostname?: string;
  /** /proc/{pid}/stat의 starttime 필드(jiffies since boot) — PID 재사용 감지용 */
  start_jiffies?: number;
};

/** /proc/{pid}/stat에서 프로세스 시작 시간(jiffies) 읽기. Linux 전용, 실패 시 null. */
function get_pid_start_jiffies(pid: number): number | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
    // comm 필드가 괄호+공백 포함 가능 → 마지막 ')' 이후부터 파싱
    const rp = stat.lastIndexOf(")");
    if (rp < 0) return null;
    // ')' 뒤: state ppid pgrp session tty_nr tty_pgrp flags minflt cminflt
    //         majflt cmajflt utime stime cutime cstime priority nice
    //         num_threads itrealvalue starttime(19번째)
    const fields = stat.slice(rp + 2).split(" ");
    return Number(fields[19]) || null;
  } catch {
    return null;
  }
}

export type RuntimeInstanceLockHandle = {
  key: string;
  lock_path: string;
  holder_pid: number | null;
  acquired: boolean;
  release: () => Promise<void>;
};

const PROCESS_HOSTNAME = os_hostname();

/** PID가 살아있는지 체크. tini/PID1 환경에서 PID 재사용을 start_jiffies로 감지. */
function is_stale_lock(holder: LockPayload): boolean {
  const pid = holder.pid;
  if (!Number.isFinite(pid) || pid <= 0) return true;
  // 다른 hostname에서 만든 lock → 죽은 컨테이너의 lock
  if (holder.hostname && holder.hostname !== PROCESS_HOSTNAME) return true;
  try {
    process.kill(pid, 0);
    // PID 존재 확인 성공 — start_jiffies로 PID 재사용 여부 검증
    // (tini 환경에서 컨테이너 재시작 후 node가 동일 PID를 받는 경우 대응)
    if (holder.start_jiffies != null) {
      const current_jiffies = get_pid_start_jiffies(pid);
      if (current_jiffies !== null && current_jiffies !== holder.start_jiffies) return true;
    }
    return false;
  } catch {
    return true; // 프로세스 없음 → stale
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
      hostname: obj.hostname ? String(obj.hostname) : undefined,
      start_jiffies: obj.start_jiffies != null ? Number(obj.start_jiffies) : undefined,
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
        hostname: PROCESS_HOSTNAME,
        start_jiffies: get_pid_start_jiffies(process.pid) ?? undefined,
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
  if (holder && !is_stale_lock(holder)) {
    return { ok: false, holder_pid };
  }
  // stale lock 제거 후 즉시 재획득 시도
  await unlink(lock_path).catch(() => undefined);
  const fd = await open(lock_path, "wx").catch(() => null);
  if (!fd) return { ok: false, holder_pid };
  try {
    const payload: LockPayload = { pid: process.pid, started_at: now_iso(), cwd: process.cwd(), key, hostname: PROCESS_HOSTNAME };
    await fd.writeFile(`${JSON.stringify(payload)}\n`, "utf-8");
  } finally {
    await fd.close();
  }
  return { ok: true, holder_pid: process.pid };
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

