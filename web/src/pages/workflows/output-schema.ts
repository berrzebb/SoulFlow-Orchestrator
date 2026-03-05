/**
 * 노드 입출력 스키마 — 그래프 에디터 포트 렌더링.
 * 오케 노드: registry 조회. Phase/Trigger/Channel: 로컬 상수.
 */

import type { OrcheNodeDef, PhaseDef } from "./graph-editor";
import { get_frontend_node } from "./node-registry";
import { register_all_frontend_nodes } from "./nodes";

// 최초 1회 등록 보장
register_all_frontend_nodes();

export interface OutputField {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array" | "unknown";
  description?: string;
}

// ── Non-Orche Node Schemas (registry 외) ────────────

const PHASE_OUTPUT: OutputField[] = [
  { name: "result", type: "string", description: "Agent output" },
  { name: "agents", type: "array",  description: "Per-agent results" },
];

const PHASE_INPUT: OutputField[] = [
  { name: "prompt",  type: "string", description: "Input prompt / context" },
  { name: "context", type: "object", description: "Previous phase result" },
  { name: "channel", type: "object", description: "HITL channel binding" },
];

const TRIGGER_OUTPUT: OutputField[] = [
  { name: "payload",  type: "object", description: "Trigger data" },
  { name: "metadata", type: "object", description: "Trigger meta (timestamp, source)" },
];

const CHANNEL_OUTPUT: OutputField[] = [
  { name: "message",    type: "string", description: "Received message" },
  { name: "sender",     type: "object", description: "Sender info" },
  { name: "channel_id", type: "string", description: "Channel ID" },
  { name: "files",      type: "array",  description: "Received attachments" },
];

const CHANNEL_INPUT: OutputField[] = [
  { name: "message", type: "string", description: "Message to send" },
  { name: "files",   type: "array",  description: "Files to deliver" },
];

/** non-orche 노드의 출력 스키마 fallback. */
const EXTRA_OUTPUT: Record<string, OutputField[]> = {
  phase: PHASE_OUTPUT,
  trigger: TRIGGER_OUTPUT,
  channel: CHANNEL_OUTPUT,
};

/** non-orche 노드의 입력 스키마 fallback. */
const EXTRA_INPUT: Record<string, OutputField[]> = {
  phase: PHASE_INPUT,
  trigger: [],
  channel: CHANNEL_INPUT,
};

// ── Compat Accessors (graph-editor에서 직접 참조하는 곳용) ──

/** @deprecated get_output_fields / get_input_fields 사용 권장. */
export const NODE_OUTPUT_SCHEMAS: Record<string, OutputField[]> = new Proxy({} as Record<string, OutputField[]>, {
  get(_, key: string) {
    const desc = get_frontend_node(key);
    if (desc) return desc.output_schema;
    return EXTRA_OUTPUT[key] || [];
  },
});

/** @deprecated get_output_fields / get_input_fields 사용 권장. */
export const NODE_INPUT_SCHEMAS: Record<string, OutputField[]> = new Proxy({} as Record<string, OutputField[]>, {
  get(_, key: string) {
    const desc = get_frontend_node(key);
    if (desc) return desc.input_schema;
    return EXTRA_INPUT[key] || [];
  },
});

// ── Field Type Colors ───────────────────────────────

export const FIELD_TYPE_COLORS: Record<string, string> = {
  string:  "#3498db",
  number:  "#2ecc71",
  boolean: "#f39c12",
  object:  "#9b59b6",
  array:   "#e67e22",
  unknown: "#95a5a6",
};

// ── Public API ──────────────────────────────────────

/** 노드의 출력 필드를 반환. */
export function get_output_fields(node: OrcheNodeDef | PhaseDef): OutputField[] {
  if ("node_type" in node) {
    // Set: assignments 키에서 동적 추출
    if (node.node_type === "set") {
      const assignments = (node as OrcheNodeDef & { assignments?: Array<{ key: string }> }).assignments || [];
      return assignments.map((a) => ({ name: a.key, type: "unknown" as const }));
    }
    // Merge: depends_on에서 동적 추출
    if (node.node_type === "merge") {
      return (node.depends_on || []).map((dep) => ({
        name: dep, type: "unknown" as const, description: `Output of ${dep}`,
      }));
    }
    const desc = get_frontend_node(node.node_type);
    if (desc) return desc.output_schema;
    return EXTRA_OUTPUT[node.node_type] || [];
  }
  return PHASE_OUTPUT;
}

/** 노드의 입력 필드를 반환. */
export function get_input_fields(node: OrcheNodeDef | PhaseDef): OutputField[] {
  if ("node_type" in node) {
    // Merge: depends_on에서 동적 추출
    if (node.node_type === "merge") {
      return (node.depends_on || []).map((dep) => ({
        name: dep, type: "unknown" as const, description: `From ${dep}`,
      }));
    }
    const desc = get_frontend_node(node.node_type);
    if (desc) return desc.input_schema;
    return EXTRA_INPUT[node.node_type] || [];
  }
  return PHASE_INPUT;
}
