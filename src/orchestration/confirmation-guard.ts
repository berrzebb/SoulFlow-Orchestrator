/** Confirmation Guard — 크론/task 등 중요 작업 실행 전 HITL 확인. */

export type PendingConfirmation = {
  original_text: string;
  mode: string;
  tool_categories: string[];
  summary: string;
  created_at: number;
};

export type GuardResolution =
  | { action: "confirmed"; original_text: string }
  | { action: "cancelled" };

const YES = new Set(["네", "yes", "y", "확인", "진행", "ok", "예", "ㅇㅇ"]);
const NO = new Set(["아니오", "아니", "no", "n", "취소", "ㄴㄴ"]);

const GUARD_MODES = new Set(["task"]);
const GUARD_TOOL_CATEGORIES = new Set(["scheduling"]);

const DEFAULT_TTL_MS = 120_000;

export class ConfirmationGuard {
  enabled: boolean;
  private readonly pending = new Map<string, PendingConfirmation>();
  /** 확인 완료 직후 1회 가드 스킵용. invoke_and_reply에서 재진입 시 무한루프 방지. */
  private readonly skip_once = new Set<string>();
  private readonly ttl_ms: number;

  constructor(opts?: { enabled?: boolean; ttl_ms?: number }) {
    this.enabled = opts?.enabled ?? false;
    this.ttl_ms = opts?.ttl_ms ?? DEFAULT_TTL_MS;
  }

  set_enabled(on: boolean): void {
    this.enabled = on;
    if (!on) {
      this.pending.clear();
      this.skip_once.clear();
    }
  }

  needs_confirmation(mode: string, tool_categories: string[], provider?: string, chat_id?: string): boolean {
    if (!this.enabled) return false;
    if (provider && chat_id) {
      const key = chat_key(provider, chat_id);
      if (this.skip_once.has(key)) {
        this.skip_once.delete(key);
        return false;
      }
    }
    if (GUARD_MODES.has(mode)) return true;
    return tool_categories.some((c) => GUARD_TOOL_CATEGORIES.has(c));
  }

  store(
    provider: string,
    chat_id: string,
    original_text: string,
    summary: string,
    mode: string,
    tool_categories: string[],
  ): void {
    this.prune_expired();
    this.pending.set(chat_key(provider, chat_id), {
      original_text, mode, tool_categories, summary, created_at: Date.now(),
    });
  }

  has_pending(provider: string, chat_id: string): boolean {
    const entry = this.pending.get(chat_key(provider, chat_id));
    if (!entry) return false;
    if (Date.now() - entry.created_at > this.ttl_ms) {
      this.pending.delete(chat_key(provider, chat_id));
      return false;
    }
    return true;
  }

  try_resolve(provider: string, chat_id: string, text: string): GuardResolution | null {
    const key = chat_key(provider, chat_id);
    const entry = this.pending.get(key);
    if (!entry) return null;

    if (Date.now() - entry.created_at > this.ttl_ms) {
      this.pending.delete(key);
      return null;
    }

    const norm = text.trim().toLowerCase();
    if (YES.has(norm)) {
      this.pending.delete(key);
      this.skip_once.add(key);
      return { action: "confirmed", original_text: entry.original_text };
    }
    if (NO.has(norm)) {
      this.pending.delete(key);
      return { action: "cancelled" };
    }

    // 관련 없는 메시지 → pending 폐기, 정상 플로우로 진행
    this.pending.delete(key);
    return null;
  }

  get_status(): { enabled: boolean; pending_count: number } {
    this.prune_expired();
    return { enabled: this.enabled, pending_count: this.pending.size };
  }

  private prune_expired(): void {
    const now = Date.now();
    for (const [key, entry] of this.pending) {
      if (now - entry.created_at > this.ttl_ms) this.pending.delete(key);
    }
    // skip_once는 즉시 소비되어야 하므로 비정상 잔류 시 정리
    if (this.skip_once.size > 10) this.skip_once.clear();
  }
}

function chat_key(provider: string, chat_id: string): string {
  return `${provider}:${chat_id}`;
}

/** 가드 확인 메시지 포맷. */
export function format_guard_prompt(
  summary: string,
  mode: string,
  tool_categories: string[],
): string {
  const tools_label = tool_categories.length > 0 ? tool_categories.join(", ") : "기본";
  return [
    "⚠️ **실행 확인**",
    "",
    `📋 ${summary}`,
    `🔧 모드: ${mode} / 도구: ${tools_label}`,
    "",
    "진행하시겠습니까? (`네` / `아니오`)",
  ].join("\n");
}
