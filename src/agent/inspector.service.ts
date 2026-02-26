import type { AgentDomain } from "./index.js";
import type { AgentInspectorLike } from "./inspector.types.js";

export class AgentInspectorAdapter implements AgentInspectorLike {
  private readonly domain: AgentDomain;

  constructor(domain: AgentDomain) {
    this.domain = domain;
  }

  list_runtime_tasks() {
    return this.domain.loop.list_tasks();
  }

  list_stored_tasks() {
    return this.domain.task_store.list();
  }

  list_subagents() {
    return this.domain.subagents.list();
  }
}

export function create_agent_inspector(domain: AgentDomain): AgentInspectorLike {
  return new AgentInspectorAdapter(domain);
}
