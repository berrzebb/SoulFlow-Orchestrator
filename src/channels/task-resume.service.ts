/**
 * TaskResumeService — 인바운드 메시지가 대기 중인 Task에 대한 응답인지 판별하여 재개.
 *
 * ChannelManager 파이프라인에서 ApprovalService 다음, CommandRouter 이전에 위치.
 * 대기/실패 Task이 있으면 사용자 입력을 memory에 주입하고 Task을 재개한다.
 */
import type { InboundMessage } from "../bus/types.js";
import type { ChannelProvider } from "./types.js";
import type { TaskState } from "../contracts.js";
import type { Logger } from "../logger.js";
import type { AgentRuntimeLike } from "../agent/runtime.types.js";

export type TaskResumeResult = {
  resumed: boolean;
  task_id: string;
  previous_status: TaskState["status"];
  /** 완료 작업의 컨텍스트 요약 — 새 오케스트레이션 시 메시지에 포함. */
  referenced_context?: string;
};

export type TaskResumeServiceDeps = {
  agent_runtime: AgentRuntimeLike;
  logger: Logger;
};

/** 대기 Task 재개를 건너뛰어야 하는 메시지 패턴. */
const SKIP_PATTERNS: RegExp[] = [
  /^\/\S/,          // 슬래시 명령
  /^!/,             // 관리 명령 접두사
];

/** failed Task 재시도 시 최대 경과 시간 (ms). */
const FAILED_TASK_TTL_MS = 30 * 60 * 1000; // 30분

export class TaskResumeService {
  private readonly runtime: AgentRuntimeLike;
  private readonly logger: Logger;

  constructor(deps: TaskResumeServiceDeps) {
    this.runtime = deps.agent_runtime;
    this.logger = deps.logger;
  }

  /**
   * 현재 채팅에서 사용자 입력을 기다리는 Task이 있으면 재개.
   * 재개된 경우 result를 반환하여 새 오케스트레이션 생성을 방지.
   */
  async try_resume(
    provider: ChannelProvider,
    message: InboundMessage,
  ): Promise<TaskResumeResult | null> {
    const text = String(message.content || "").trim();
    if (!text) return null;
    if (SKIP_PATTERNS.some((p) => p.test(text))) return null;

    // 만료된 대기 작업 자동 정리 (10분 TTL)
    const expired = this.runtime.expire_stale_tasks();
    if (expired.length > 0) {
      this.logger.info("expired_stale_tasks", { count: expired.length, ids: expired.map((t) => t.taskId) });
    }

    // 레퍼런스 메시지가 있으면 연결된 Task를 우선 탐색 (thread_id → reply_to 순서)
    const ref_id = String(message.thread_id || message.reply_to || "").trim();
    if (ref_id) {
      const referenced = await this.runtime.find_task_by_trigger_message(provider, ref_id);
      if (referenced) {
        const resumable = ["waiting_user_input", "waiting_approval", "failed", "max_turns_reached"];
        if (resumable.includes(referenced.status)) {
          const previous_status = referenced.status;
          const reason = previous_status === "failed" ? "retry_with_enrichment" : "referenced_message_reply";
          this.logger.info("resuming task from referenced message", {
            task_id: referenced.taskId,
            previous_status,
            reason,
            ref_id,
          });
          const resumed = await this.runtime.resume_task(referenced.taskId, text, reason);
          if (!resumed || resumed.status !== "running") return null;
          return { resumed: true, task_id: referenced.taskId, previous_status };
        }
        if (referenced.status === "completed") {
          this.logger.info("completed task referenced, enriching new request", {
            task_id: referenced.taskId,
            ref_id,
          });
          return {
            resumed: false,
            task_id: referenced.taskId,
            previous_status: "completed",
            referenced_context: build_task_context_summary(referenced),
          };
        }
      }
    }

    // 폴백: 채팅 전체 대기 Task 조회
    const waiting = await this.runtime.find_waiting_task(provider, message.chat_id);
    if (!waiting) return null;

    // failed Task은 TTL 이내만 재시도 대상
    if (waiting.status === "failed") {
      const updated = String(waiting.memory.__updated_at_seoul || "");
      if (updated && !this.is_within_ttl(updated, FAILED_TASK_TTL_MS)) {
        return null;
      }
    }

    const previous_status = waiting.status;
    const reason = previous_status === "failed" ? "retry_with_enrichment" : "user_input_received";

    this.logger.info("resuming waiting task", {
      task_id: waiting.taskId,
      previous_status,
      reason,
      chat_id: message.chat_id,
    });

    const resumed = await this.runtime.resume_task(waiting.taskId, text, reason);
    if (!resumed || resumed.status !== "running") return null;

    return { resumed: true, task_id: waiting.taskId, previous_status };
  }

  /**
   * 승인 완료 후 waiting_approval 상태의 Task을 재개.
   * 도구 실행 결과를 memory.__user_input에 주입하여 컨텍스트를 유지.
   */
  async resume_after_approval(task_id: string, tool_result: string): Promise<boolean> {
    const task = await this.runtime.get_task(task_id);
    if (!task || task.status !== "waiting_approval") {
      this.logger.debug("resume_after_approval: task not in waiting_approval", { task_id, status: task?.status });
      return false;
    }

    const input = `[승인됨] 도구 실행 결과:\n${tool_result}`;
    const resumed = await this.runtime.resume_task(task_id, input, "approval_resolved");
    if (!resumed || resumed.status !== "running") {
      this.logger.warn("resume_after_approval: resume_task failed", { task_id, status: resumed?.status });
      return false;
    }

    this.logger.info("task resumed after approval", { task_id });
    return true;
  }

  /** 승인 거부/취소 시 좀비 Task 방지를 위한 즉시 취소. */
  async cancel_task(task_id: string, reason: string): Promise<void> {
    const result = await this.runtime.cancel_task(task_id, reason);
    if (result) this.logger.info("task cancelled", { task_id, reason, status: result.status });
  }

  private is_within_ttl(iso_date: string, ttl_ms: number): boolean {
    try {
      const then = new Date(iso_date).getTime();
      return Date.now() - then < ttl_ms;
    } catch {
      return false;
    }
  }
}

function build_task_context_summary(task: TaskState): string {
  const objective = String(task.memory.objective || "").trim();
  const last_output = String(task.memory.last_output || "").trim();
  const parts: string[] = ["[이전 작업 컨텍스트]"];
  if (objective) parts.push(`목적: ${objective.slice(0, 300)}`);
  if (last_output) parts.push(`결과: ${last_output.slice(0, 500)}`);
  return parts.join("\n");
}
