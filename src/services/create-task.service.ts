/** create_task 서비스 팩토리. 워크플로우 노드에서 하위 태스크 생성 지원. */

import { create_logger } from "../logger.js";
import { error_message } from "../utils/common.js";

const log = create_logger("create-task");

export interface CreateTaskDeps {
  /** 에이전트 루프 실행 (orchestration.execute 래핑). */
  execute: (opts: {
    title: string;
    objective: string;
    channel: string;
    chat_id: string;
    max_turns?: number;
    initial_memory?: Record<string, unknown>;
  }) => Promise<{ task_id: string; status: string; result?: unknown; error?: string }>;
}

/** create_task 서비스 생성. deps는 lazy로 주입 가능 (순환 참조 회피). */
export function create_task_service(get_deps: () => CreateTaskDeps) {
  return async (opts: {
    title: string;
    objective: string;
    channel?: string;
    chat_id?: string;
    max_turns?: number;
    initial_memory?: Record<string, unknown>;
  }): Promise<{ task_id: string; status: string; result?: unknown; error?: string }> => {
    const deps = get_deps();
    const task_id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    log.info("create_task", { task_id, title: opts.title });

    try {
      const result = await deps.execute({
        title: opts.title,
        objective: opts.objective,
        channel: opts.channel || "workflow",
        chat_id: opts.chat_id || "internal",
        max_turns: opts.max_turns,
        initial_memory: opts.initial_memory,
      });
      return { ...result, task_id: result.task_id || task_id };
    } catch (e) {
      log.warn("create_task error", { task_id, error: error_message(e) });
      return { task_id, status: "failed", error: error_message(e) };
    }
  };
}
