/** SSE 브로드캐스터 인터페이스 + NullBroadcaster 구현. */

import type { ProcessEntry } from "../orchestration/process-tracker.js";
import type { TaskState } from "../contracts.js";
import type { ProgressEvent } from "../bus/types.js";
import type { AgentEvent } from "../agent/agent.types.js";
import type { PhaseLoopEvent } from "../agent/phase-loop.types.js";

export type MirrorMessageEvent = {
  session_key: string;
  direction: string;
  sender_id: string;
  content: string;
  at: string;
};

/**
 * 웹 채팅 세션별 NDJSON 스트리밍 이벤트.
 * 프로바이더 무관하게 통일된 포맷 — 텍스트 delta, 도구 사용, usage 통계 포함.
 */
export type WebStreamEvent =
  | { type: "delta"; content: string }
  | { type: "tool_start"; name: string; id: string; params?: Record<string, unknown> }
  | { type: "tool_result"; name: string; id: string; result: string; is_error?: boolean }
  | { type: "usage"; input: number; output: number; cache_read?: number; cache_creation?: number }
  | { type: "done" };

/** AgentEvent → WebStreamEvent 변환. 관련 없는 이벤트는 null 반환. */
export function agent_event_to_web_stream(event: AgentEvent): WebStreamEvent | null {
  switch (event.type) {
    case "tool_use":
      return { type: "tool_start", name: event.tool_name, id: event.tool_id, params: event.params };
    case "tool_result":
      return { type: "tool_result", name: event.tool_name, id: event.tool_id, result: event.result, is_error: event.is_error };
    case "usage":
      return {
        type: "usage",
        input: event.tokens.input,
        output: event.tokens.output,
        cache_read: event.tokens.cache_read,
        cache_creation: event.tokens.cache_creation,
      };
    default:
      return null;
  }
}

export interface SseBroadcasterLike {
  broadcast_process_event(type: "start" | "end", entry: ProcessEntry): void;
  broadcast_message_event(direction: "inbound" | "outbound", sender_id: string, content?: string, chat_id?: string): void;
  broadcast_cron_event(type: string, job_id?: string): void;
  broadcast_progress_event(event: ProgressEvent): void;
  broadcast_task_event(type: "status_change", task: TaskState): void;
  broadcast_web_stream(chat_id: string, content: string, done: boolean): void;
  /** 어시스턴트 메시지가 세션에 저장된 직후 발송 — 프론트엔드가 폴링 없이 즉시 refetch. */
  broadcast_web_message(chat_id: string): void;
  broadcast_mirror_message(event: MirrorMessageEvent): void;
  broadcast_workflow_event(event: PhaseLoopEvent): void;
  broadcast_agent_event(event: AgentEvent): void;
  /** 웹 채팅 세션에 rich 이벤트(도구, usage) 발행 — on_web_rich_event에서 호출. */
  broadcast_web_rich_event(chat_id: string, event: WebStreamEvent): void;
  /** 세션별 WebStreamEvent 리스너 등록. 반환값은 해제 함수. */
  add_rich_stream_listener?(chat_id: string, fn: (event: WebStreamEvent) => void): () => void;
}

/** dashboard가 비활성일 때 사용하는 no-op broadcaster. */
export const NULL_BROADCASTER: SseBroadcasterLike = {
  broadcast_process_event() {},
  broadcast_message_event() {},
  broadcast_cron_event() {},
  broadcast_progress_event() {},
  broadcast_task_event() {},
  broadcast_web_stream() {},
  broadcast_web_message() {},
  broadcast_mirror_message() {},
  broadcast_workflow_event() {},
  broadcast_agent_event() {},
  broadcast_web_rich_event() {},
};

/**
 * Stable sink: 내부 대상(SseManager 등)을 attach/detach로 교체.
 * 다른 서비스는 이 객체만 참조하고, dashboard lifecycle은 attach/detach로 처리.
 */
export class MutableBroadcaster implements SseBroadcasterLike {
  private target: SseBroadcasterLike = NULL_BROADCASTER;

  attach(sse: SseBroadcasterLike): void { this.target = sse; }
  detach(): void { this.target = NULL_BROADCASTER; }

  broadcast_process_event(...args: Parameters<SseBroadcasterLike["broadcast_process_event"]>): void { this.target.broadcast_process_event(...args); }
  broadcast_message_event(...args: Parameters<SseBroadcasterLike["broadcast_message_event"]>): void { this.target.broadcast_message_event(...args); }
  broadcast_cron_event(...args: Parameters<SseBroadcasterLike["broadcast_cron_event"]>): void { this.target.broadcast_cron_event(...args); }
  broadcast_progress_event(...args: Parameters<SseBroadcasterLike["broadcast_progress_event"]>): void { this.target.broadcast_progress_event(...args); }
  broadcast_task_event(...args: Parameters<SseBroadcasterLike["broadcast_task_event"]>): void { this.target.broadcast_task_event(...args); }
  broadcast_web_stream(...args: Parameters<SseBroadcasterLike["broadcast_web_stream"]>): void { this.target.broadcast_web_stream(...args); }
  broadcast_web_message(...args: Parameters<SseBroadcasterLike["broadcast_web_message"]>): void { this.target.broadcast_web_message(...args); }
  broadcast_mirror_message(...args: Parameters<SseBroadcasterLike["broadcast_mirror_message"]>): void { this.target.broadcast_mirror_message(...args); }
  broadcast_workflow_event(...args: Parameters<SseBroadcasterLike["broadcast_workflow_event"]>): void { this.target.broadcast_workflow_event(...args); }
  broadcast_agent_event(...args: Parameters<SseBroadcasterLike["broadcast_agent_event"]>): void { this.target.broadcast_agent_event(...args); }
  broadcast_web_rich_event(...args: Parameters<SseBroadcasterLike["broadcast_web_rich_event"]>): void { this.target.broadcast_web_rich_event(...args); }
  add_rich_stream_listener(chat_id: string, fn: (event: WebStreamEvent) => void): () => void {
    return this.target.add_rich_stream_listener?.(chat_id, fn) ?? (() => undefined);
  }
}
