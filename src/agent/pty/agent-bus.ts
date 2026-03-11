/** AgentBus — 레인 직렬화 + followup 큐 + 전송 계층 위임. */

import type { Logger } from "../../logger.js";
import type { AgentInputMessage, AgentOutputMessage, AgentTransport, Disposable, BuildArgsOptions } from "./types.js";
import type { CliAdapter } from "./types.js";
import { LaneQueue, type LaneQueueOptions } from "./lane-queue.js";
import { ContainerPool } from "./container-pool.js";
import { PtyTransport } from "./pty-transport.js";
import type { CommPermissionGuard } from "./comm-permission.js";

export type AgentBusOptions = {
  pool: ContainerPool;
  adapter: CliAdapter;
  logger: Logger;
  lane_options?: LaneQueueOptions;
  /** 커스텀 전송 계층. 미주입 시 PtyTransport 자동 생성. */
  transport?: AgentTransport;
  /** 에이전트간 통신 권한 매트릭스. 미주입 시 deny-all. */
  permission_guard?: CommPermissionGuard;
};

export class AgentBus {
  private readonly transport: AgentTransport;
  private readonly lanes: LaneQueue;
  private readonly _logger: Logger;
  private readonly permission_guard?: CommPermissionGuard;

  constructor(options: AgentBusOptions) {
    this._logger = options.logger;
    this.lanes = new LaneQueue(options.lane_options);
    this.permission_guard = options.permission_guard;
    this.transport = options.transport ?? new PtyTransport({
      pool: options.pool,
      adapter: options.adapter,
      logger: options.logger,
    });
  }

  /** 에이전트에게 메시지를 보내고 complete 이벤트까지 대기. */
  async send_and_wait(session_key: string, prompt: string, args_options: BuildArgsOptions, env?: Record<string, string>): Promise<AgentOutputMessage> {
    return this.lanes.execute(session_key, async () => {
      const input: AgentInputMessage = { type: "user_message", content: prompt };
      return this.transport.send(session_key, input, args_options, env);
    });
  }

  /** 출력 이벤트 구독. */
  on_output(handler: (key: string, msg: AgentOutputMessage) => void): Disposable {
    return this.transport.on_output(handler);
  }

  /** followup 메시지 큐잉. 현재 턴 완료 후 전달. */
  queue_followup(session_key: string, content: string): void {
    this.lanes.followup(session_key, content);
  }

  /**
   * Steer Mode: 실행 중인 에이전트 stdin에 직접 쓰기.
   * stdin_mode="keep" 어댑터(Codex CLI 등)에서만 동작.
   * 연결 없음 또는 transport 미지원 시 false 반환.
   */
  steer(session_key: string, content: string): boolean {
    return this.transport.write_stdin?.(session_key, content) ?? false;
  }

  get lane_queue(): LaneQueue {
    return this.lanes;
  }

  /** 세션 연결 제거. crash recovery 시 pool에서도 정리. */
  async remove_session(session_key: string): Promise<void> {
    await this.transport.remove_session(session_key);
    this.lanes.clear(session_key);
  }

  /** 활성 세션 목록. */
  list_sessions(): string[] {
    return this.transport.list_sessions();
  }

  // ── 에이전트간 통신 ──

  /** 다른 에이전트에 질의 후 응답 대기. followup 큐 주입 방식. */
  async ask(opts: AskOptions): Promise<string> {
    if (this.permission_guard && !this.permission_guard.is_allowed({ from: opts.from, to: opts.to })) {
      throw new Error(`ask: comm denied: ${opts.from} → ${opts.to}`);
    }
    const sessions = this.transport.list_sessions();
    if (!sessions.includes(opts.to)) {
      throw new Error(`ask: target session not found: ${opts.to}`);
    }
    const formatted = `[Agent Request from ${opts.from}]\n${opts.content}`;
    this.lanes.followup(opts.to, formatted);

    return new Promise<string>((resolve, reject) => {
      const timeout_ms = opts.timeout_ms ?? 60_000;
      const timer = setTimeout(() => {
        sub.dispose();
        reject(new Error(`ask: timeout after ${timeout_ms}ms waiting for ${opts.to}`));
      }, timeout_ms);

      const sub = this.transport.on_output((key, msg) => {
        if (key !== opts.to || msg.type !== "complete") return;
        clearTimeout(timer);
        sub.dispose();
        resolve(msg.result);
      });
    });
  }

  /** 모든 (또는 필터된) 에이전트에 일방향 메시지. */
  broadcast(content: string, from: string, filter?: (session_key: string) => boolean): void {
    for (const key of this.transport.list_sessions()) {
      if (filter && !filter(key)) continue;
      if (this.permission_guard && !this.permission_guard.is_allowed({ from, to: key })) continue;
      this.lanes.followup(key, content);
    }
  }

  /** 전체 정리. */
  async shutdown(): Promise<void> {
    await this.transport.shutdown();
  }
}

export type AskOptions = {
  from: string;
  to: string;
  content: string;
  timeout_ms?: number;
};
