/** Dashboard model ops. */

import type { DashboardModelOps } from "../service.js";
import type { OrchestratorLlmRuntime } from "../../providers/orchestrator-llm.runtime.js";

export function create_model_ops(runtime: OrchestratorLlmRuntime): DashboardModelOps {
  return {
    list: () => runtime.list_models(),
    pull: (name) => runtime.pull_model_by_name(name),
    pull_stream: (name) => runtime.pull_model_stream(name),
    delete: (name) => runtime.delete_model(name),
    list_active: () => runtime.list_running(),
    get_runtime_status: () => runtime.health_check().then((s) => s as unknown as Record<string, unknown>),
    switch_model: (name) => runtime.switch_model(name).then((s) => s as unknown as Record<string, unknown>),
  };
}
