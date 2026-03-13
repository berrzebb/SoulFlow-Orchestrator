/** Dashboard agent definition ops. */

import { error_message } from "../../utils/common.js";
import type { AgentDefinition, CreateAgentDefinitionInput, UpdateAgentDefinitionInput, GeneratedAgentFields } from "../../agent/agent-definition.types.js";
import type { AgentDefinitionStore, ScopeFilter } from "../../agent/agent-definition.store.js";

/** 자연어 설명 → 구조화된 에이전트 정의 필드 생성 함수. */
export type AgentGenerateFn = (prompt: string) => Promise<GeneratedAgentFields | null>;

export interface DashboardAgentDefinitionOps {
  list(scope_filter?: ScopeFilter): AgentDefinition[];
  get(id: string): AgentDefinition | null;
  create(input: CreateAgentDefinitionInput): { ok: boolean; data?: AgentDefinition; error?: string };
  update(id: string, patch: UpdateAgentDefinitionInput): { ok: boolean; error?: string };
  delete(id: string): { ok: boolean; error?: string };
  fork(id: string): { ok: boolean; data?: AgentDefinition; error?: string };
  generate(prompt: string): Promise<{ ok: boolean; data?: GeneratedAgentFields; error?: string }>;
}

export function create_agent_definition_ops(deps: {
  store: AgentDefinitionStore;
  generate_fn?: AgentGenerateFn;
}): DashboardAgentDefinitionOps {
  const { store, generate_fn } = deps;

  return {
    list: (scope_filter?) => store.list(scope_filter),

    get: (id) => store.get(id),

    create(input) {
      try {
        const data = store.create(input);
        return { ok: true, data };
      } catch (e) {
        return { ok: false, error: error_message(e) };
      }
    },

    update(id, patch) {
      try {
        const ok = store.update(id, patch);
        if (!ok) return { ok: false, error: "not_found_or_builtin" };
        return { ok: true };
      } catch (e) {
        return { ok: false, error: error_message(e) };
      }
    },

    delete(id) {
      try {
        const ok = store.delete(id);
        if (!ok) return { ok: false, error: "not_found_or_builtin" };
        return { ok: true };
      } catch (e) {
        return { ok: false, error: error_message(e) };
      }
    },

    fork(id) {
      try {
        const data = store.fork(id);
        if (!data) return { ok: false, error: "not_found" };
        return { ok: true, data };
      } catch (e) {
        return { ok: false, error: error_message(e) };
      }
    },

    async generate(prompt) {
      if (!generate_fn) return { ok: false, error: "generate_unavailable" };
      try {
        const data = await generate_fn(prompt);
        if (!data) return { ok: false, error: "generate_failed" };
        return { ok: true, data };
      } catch (e) {
        return { ok: false, error: error_message(e) };
      }
    },
  };
}
