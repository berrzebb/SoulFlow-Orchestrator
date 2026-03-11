import type { MemoryStoreLike, MemoryConsolidateOptions } from "./memory.types.js";
import type { Logger } from "../logger.js";
import type { ServiceLike } from "../runtime/service.types.js";
import type { SessionStoreLike } from "../session/service.js";
import { promote_sessions_to_daily, type SessionPromotionConfig } from "./session-memory-promoter.js";
import { error_message } from "../utils/common.js";

export type MemoryConsolidationConfig = {
  enabled: boolean;
  trigger: "idle" | "cron";
  idle_after_ms: number;
  interval_ms: number;
  window_days: number;
  archive_used: boolean;
};

export type MemoryConsolidationDeps = {
  memory_store: MemoryStoreLike;
  config: MemoryConsolidationConfig;
  logger: Logger;
  /** 세션 스토어. 제공 시 idle 후 만료 임박 메시지를 daily 메모리로 자동 승격. */
  sessions?: SessionStoreLike | null;
  /** 세션 히스토리 최대 수명 (ms). sessions 제공 시 승격 타이밍 계산에 사용. */
  session_max_age_ms?: number;
};

/**
 * 메모리 압축 서비스.
 * idle trigger: 모든 활성 turn이 종료된 후 idle_after_ms 경과 시 consolidation 실행.
 * cron trigger: 외부에서 run_consolidation()을 직접 호출 (cron 스케줄러 연동).
 */
export class MemoryConsolidationService implements ServiceLike {
  readonly name = "memory-consolidation";

  private readonly store: MemoryStoreLike;
  private readonly config: MemoryConsolidationConfig;
  private readonly logger: Logger;
  private readonly sessions: SessionStoreLike | null;
  private readonly promotion_config: Partial<SessionPromotionConfig>;
  private idle_timer: ReturnType<typeof setTimeout> | null = null;
  private cron_timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private consolidating = false;
  /** 활성 turn 수. 0이 되어야 idle timer 시작 가능. */
  private busy_count = 0;

  constructor(deps: MemoryConsolidationDeps) {
    this.store = deps.memory_store;
    this.config = deps.config;
    this.logger = deps.logger;
    this.sessions = deps.sessions ?? null;
    this.promotion_config = deps.session_max_age_ms
      ? { session_max_age_ms: deps.session_max_age_ms }
      : {};
  }

  async start(): Promise<void> {
    this.running = true;
    if (this.config.enabled && this.config.trigger === "cron") {
      this.cron_timer = setInterval(() => {
        this.run_consolidation().catch((e) =>
          this.logger.warn("cron consolidation failed", { error: error_message(e) }),
        );
      }, this.config.interval_ms);
      if (this.cron_timer.unref) this.cron_timer.unref();
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.idle_timer) {
      clearTimeout(this.idle_timer);
      this.idle_timer = null;
    }
    if (this.cron_timer) {
      clearInterval(this.cron_timer);
      this.cron_timer = null;
    }
  }

  health_check(): { ok: boolean; details?: Record<string, unknown> } {
    return { ok: this.running, details: { consolidating: this.consolidating, busy_count: this.busy_count } };
  }

  /**
   * 세션 활동 시 호출. idle trigger 타이머를 리셋.
   * 단순 이벤트 (메시지 수신 등)에 사용. turn 보호가 필요하면 touch_start/touch_end 사용.
   */
  touch(): void {
    if (!this.config.enabled || this.config.trigger !== "idle") return;
    if (this.busy_count > 0) return; // 활성 turn 중이면 timer 시작하지 않음
    this.reset_idle_timer();
  }

  /** 활성 turn 시작. idle timer를 중단하고 busy guard를 활성화. */
  touch_start(): void {
    this.busy_count++;
    if (this.idle_timer) {
      clearTimeout(this.idle_timer);
      this.idle_timer = null;
    }
  }

  /** 활성 turn 종료. 모든 turn이 끝나면 idle timer를 시작. */
  touch_end(): void {
    this.busy_count = Math.max(0, this.busy_count - 1);
    if (this.busy_count === 0 && this.config.enabled && this.config.trigger === "idle") {
      this.reset_idle_timer();
    }
  }

  private reset_idle_timer(): void {
    if (this.idle_timer) clearTimeout(this.idle_timer);
    this.idle_timer = setTimeout(() => {
      this.idle_timer = null;
      this.run_consolidation().catch((e) =>
        this.logger.warn("idle consolidation failed", { error: error_message(e) }),
      );
    }, this.config.idle_after_ms);
    if (this.idle_timer.unref) this.idle_timer.unref();
  }

  /** 압축 실행. cron 또는 수동 호출용. */
  async run_consolidation(options?: Partial<MemoryConsolidateOptions>): Promise<{ ok: boolean; summary: string }> {
    if (!this.running) return { ok: false, summary: "service not running" };
    if (this.consolidating) return { ok: false, summary: "consolidation already in progress" };
    if (this.busy_count > 0) return { ok: false, summary: "active turns in progress" };

    this.consolidating = true;
    try {
      const result = await this.store_consolidate({
        memory_window: options?.memory_window ?? this.config.window_days,
        archive: options?.archive ?? this.config.archive_used,
        session: options?.session,
        provider: options?.provider,
        model: options?.model,
      });
      this.logger.info("memory consolidated", {
        entries: result.daily_entries_used.length,
        archived: result.archived_files.length,
        chars: result.longterm_appended_chars,
      });

      // 세션 승격: 만료 임박 대화를 daily 메모리로 보존
      if (this.sessions) {
        const promotion = await promote_sessions_to_daily(
          this.sessions, this.store, this.logger, this.promotion_config,
        );
        if (promotion.promoted > 0) {
          this.logger.info("sessions promoted to daily", promotion);
        }
      }

      return { ok: result.ok, summary: result.summary };
    } catch (e) {
      this.logger.error("consolidation failed", { error: error_message(e) });
      return { ok: false, summary: error_message(e) };
    } finally {
      this.consolidating = false;
    }
  }

  private async store_consolidate(options: MemoryConsolidateOptions) {
    if (typeof this.store.consolidate === "function") {
      return this.store.consolidate(options);
    }
    // consolidate()를 구현하지 않은 MemoryStoreLike fallback
    const days = await this.store.list_daily();
    const window = options.memory_window ?? 7;
    const now = Date.now();
    const used: string[] = [];
    const chunks: string[] = [];
    for (const day of days) {
      const d = new Date(`${day}T00:00:00Z`);
      if (!Number.isFinite(d.getTime())) continue;
      if (Math.floor((now - d.getTime()) / 86_400_000) > window) continue;
      const content = (await this.store.read_daily(day)).trim();
      if (!content) continue;
      used.push(day);
      chunks.push(`## Daily ${day}\n${content}`);
    }
    if (chunks.length > 0) {
      await this.store.append_longterm(`\n## Consolidated ${new Date().toISOString().slice(0, 10)}\n${chunks.join("\n\n")}\n`);
    }
    return {
      ok: true,
      longterm_appended_chars: chunks.join("").length,
      daily_entries_used: used,
      archived_files: [] as string[],
      summary: used.length > 0 ? `consolidated ${used.length} daily entries` : "no daily entries",
      compressed_prompt: "",
    };
  }
}
