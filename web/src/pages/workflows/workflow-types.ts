/** 워크플로우 타입 정의 — 프론트엔드 단일 소스. */

import type { OutputField } from "./output-schema";

export interface AgentDef {
  agent_id: string;
  role: string;
  label: string;
  backend: string;
  model?: string;
  system_prompt: string;
  tools?: string[];
  max_turns?: number;
}

export interface CriticDef {
  backend: string;
  model?: string;
  system_prompt: string;
  gate: boolean;
  on_rejection?: string;
  goto_phase?: string;
  max_retries?: number;
}

export interface PhaseDef {
  phase_id: string;
  title: string;
  agents: AgentDef[];
  critic?: CriticDef;
  context_template?: string;
  failure_policy?: string;
  mode?: "parallel" | "interactive" | "sequential_loop";
  max_loop_iterations?: number;
  loop_until?: string;
  depends_on?: string[];
  tools?: string[];
  skills?: string[];
}

/** 오케 노드 타입 리터럴 — 프론트엔드 단일 소스. */
export type OrcheNodeType = "http" | "code" | "if" | "merge" | "set" | "split"
  | "llm" | "switch" | "wait" | "template" | "oauth" | "sub_workflow"
  | "filter" | "loop" | "transform" | "db" | "file"
  | "analyzer" | "retriever" | "ai_agent" | "text_splitter"
  | "task" | "spawn_agent" | "decision" | "promise"
  | "embedding" | "vector_store"
  | "notify" | "aggregate" | "send_file" | "error_handler" | "webhook"
  | "hitl" | "approval" | "form" | "tool_invoke" | "gate" | "escalation"
  | "cache" | "retry" | "batch" | "assert";

/** 오케스트레이션 노드 정의. */
export interface OrcheNodeDef {
  node_id: string;
  node_type: OrcheNodeType;
  title: string;
  depends_on?: string[];
  [key: string]: unknown;
}

/** 노드 그룹 (시각적 프레임). */
export interface NodeGroup {
  group_id: string;
  label: string;
  color: string;
  node_ids: string[];
  collapsed?: boolean;
}

export interface ToolNodeDef {
  id: string;
  tool_id: string;
  description: string;
  attach_to?: string[];
  params?: Record<string, unknown>;
}

export interface SkillNodeDef {
  id: string;
  skill_name: string;
  description: string;
  attach_to?: string[];
}

export type TriggerType = "cron" | "webhook" | "manual" | "channel_message";

export interface TriggerNodeDef {
  id: string;
  trigger_type: TriggerType;
  schedule?: string;
  timezone?: string;
  webhook_path?: string;
  channel_type?: string;
  chat_id?: string;
}

/** 필드 레벨 데이터 매핑 (소스 노드 필드 → 타겟 노드). */
export interface FieldMapping {
  from_node: string;
  from_field: string;
  to_node: string;
  to_field: string;
}

export interface WorkflowDef {
  title: string;
  objective: string;
  variables?: Record<string, string>;
  phases: PhaseDef[];
  orche_nodes?: OrcheNodeDef[];
  tool_nodes?: ToolNodeDef[];
  skill_nodes?: SkillNodeDef[];
  /** @deprecated trigger_nodes 사용. */
  trigger?: { type: "cron"; schedule: string; timezone?: string };
  hitl_channel?: { channel_type: string; chat_id?: string };
  trigger_nodes?: TriggerNodeDef[];
  field_mappings?: FieldMapping[];
  groups?: NodeGroup[];
}

export type NodeType = "phase" | "tool" | "skill" | "cron" | "channel" | "trigger"
  | OrcheNodeType
  | "sub_node";

export type SubNodeType = "agent" | "critic" | "tool" | "skill";

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  sub_label?: string;
  orche_data?: Record<string, unknown>;
  input_fields?: OutputField[];
  output_fields?: OutputField[];
  sub_type?: SubNodeType;
  parent_phase_id?: string;
  trigger_detail?: string;
}
