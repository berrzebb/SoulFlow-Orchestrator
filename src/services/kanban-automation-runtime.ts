/** Kanban 자동화 facade — trigger watcher + rule executor를 단일 stable 객체로 통합. */

import { create_logger } from "../logger.js";
import type { KanbanStoreLike } from "./kanban-store.js";
import type { KanbanTriggerWatcher } from "./kanban-trigger-watcher.js";
import type { KanbanRuleExecutor, RuleExecutionBridge } from "./kanban-rule-executor.js";

const log = create_logger("kanban-automation-runtime");

export interface KanbanAutomationRuntimeLike {
  notify_workflow_waiting(workflow_id: string): void;
  get_rule_executor(): KanbanRuleExecutor | null;
  dispose(): void;
}

export interface TriggerWatcherDeps {
  kanban_store: KanbanStoreLike;
  workflow_store: {
    list(): Promise<Array<{ workflow_id: string; status: string; memory: Record<string, unknown> }>>;
    get(workflow_id: string): Promise<{ workflow_id: string; status: string; memory: Record<string, unknown> } | null>;
    upsert(state: never): Promise<void>;
  };
  resumer: {
    resume(workflow_id: string): Promise<{ ok: boolean; error?: string }>;
  };
}

/** Stable facade: 서비스는 이 객체만 참조. 내부 watcher/executor는 init()으로 지연 초기화. */
export class KanbanAutomationRuntime implements KanbanAutomationRuntimeLike {
  private watcher: KanbanTriggerWatcher | null = null;
  private executor: KanbanRuleExecutor | null = null;

  notify_workflow_waiting(workflow_id: string): void {
    this.watcher?.notify(workflow_id);
  }

  get_rule_executor(): KanbanRuleExecutor | null {
    return this.executor;
  }

  async init_trigger_watcher(deps: TriggerWatcherDeps): Promise<void> {
    try {
      const { setup_kanban_trigger_watcher } = await import("./kanban-trigger-watcher.js");
      this.watcher = await setup_kanban_trigger_watcher(deps);
    } catch (err) {
      log.warn("kanban_trigger_watcher_init_error", { error: String(err) });
    }
  }

  async init_rule_executor(store: KanbanStoreLike, bridge?: RuleExecutionBridge): Promise<void> {
    try {
      const { setup_kanban_rule_listeners } = await import("./kanban-rule-executor.js");
      this.executor = await setup_kanban_rule_listeners(store, bridge);
    } catch (err) {
      log.warn("kanban_rule_executor_init_error", { error: String(err) });
    }
  }

  dispose(): void {
    this.watcher?.dispose();
    this.executor?.dispose();
    this.watcher = null;
    this.executor = null;
  }
}
