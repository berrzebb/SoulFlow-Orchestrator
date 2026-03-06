import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";

export interface InstanceLockResult {
  /** 잠금 획득 성공 여부. */
  acquired: boolean;
  /** 잠금 파일 경로. */
  lock_path: string;
  /** 잠금을 보유 중인 프로세스 PID (acquired=false 일 때 유효). */
  holder_pid?: number;
  /** 잠금 해제. 잠금을 획득하지 못한 경우에도 안전하게 호출 가능하다. */
  release(): Promise<void>;
}

/**
 * 워크스페이스 디렉토리에 PID 파일 기반 인스턴스 잠금을 시도한다.
 *
 * - 잠금 파일이 없거나 파일 내 PID가 더 이상 실행 중이 아니면 잠금 획득.
 * - retries / retry_ms 옵션으로 재시도 간격을 지정할 수 있다.
 */
export async function acquire_runtime_instance_lock(opts: {
  workspace: string;
  retries?: number;
  retry_ms?: number;
}): Promise<InstanceLockResult> {
  const { workspace, retries = 0, retry_ms = 200 } = opts;
  const lock_path = join(workspace, "soulflow.lock");
  const current_pid = process.pid;

  const noop_release = async (): Promise<void> => undefined;

  const try_acquire = async (): Promise<InstanceLockResult | null> => {
    let existing_pid: number | undefined;
    try {
      const raw = await readFile(lock_path, "utf8");
      existing_pid = parseInt(raw.trim(), 10);
    } catch {
      // 파일 없음 → 잠금 시도
    }

    if (existing_pid !== undefined && !Number.isNaN(existing_pid)) {
      const is_running = is_pid_running(existing_pid);
      if (is_running) {
        return {
          acquired: false,
          lock_path,
          holder_pid: existing_pid,
          release: noop_release,
        };
      }
      // 스테일 잠금 제거
      await unlink(lock_path).catch(() => undefined);
    }

    try {
      await writeFile(lock_path, String(current_pid), { flag: "wx" });
    } catch {
      // 경쟁 조건: 다른 프로세스가 먼저 생성
      return null;
    }

    return {
      acquired: true,
      lock_path,
      release: async () => {
        await unlink(lock_path).catch(() => undefined);
      },
    };
  };

  for (let attempt = 0; attempt <= retries; attempt++) {
    const result = await try_acquire();
    if (result !== null) return result;
    if (attempt < retries) await sleep(retry_ms);
  }

  // 모든 시도 실패 시 현재 PID 확인 재시도
  let final_pid: number | undefined;
  try {
    const raw = await readFile(lock_path, "utf8");
    final_pid = parseInt(raw.trim(), 10);
  } catch {
    // ignore
  }

  return {
    acquired: false,
    lock_path,
    holder_pid: final_pid,
    release: noop_release,
  };
}

function is_pid_running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
