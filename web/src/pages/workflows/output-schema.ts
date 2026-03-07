/**
 * 노드 입출력 스키마 — 그래프 에디터 포트 렌더링.
 * 오케 노드: registry 조회. Phase/Trigger/Channel: 로컬 상수.
 */

import type { OrcheNodeDef, PhaseDef } from "./workflow-types";
import { get_frontend_node } from "./node-registry";
import { register_all_frontend_nodes } from "./nodes";

// 최초 1회 등록 보장
register_all_frontend_nodes();

export interface OutputField {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array" | "unknown" | "any";
  description?: string;
}

// ── Non-Orche Node Schemas (registry 외) ────────────

export const PHASE_OUTPUT: OutputField[] = [
  { name: "result", type: "string", description: "Agent output" },
  { name: "agents", type: "array",  description: "Per-agent results" },
];

export const PHASE_INPUT: OutputField[] = [
  { name: "prompt",  type: "string", description: "Input prompt / context" },
  { name: "context", type: "object", description: "Previous phase result" },
  { name: "channel", type: "object", description: "HITL channel binding" },
];

export const TRIGGER_OUTPUT: OutputField[] = [
  { name: "payload",  type: "object", description: "Trigger data" },
  { name: "metadata", type: "object", description: "Trigger meta (timestamp, source)" },
];

export const CHANNEL_OUTPUT: OutputField[] = [
  { name: "message",    type: "string", description: "Received message" },
  { name: "sender",     type: "object", description: "Sender info" },
  { name: "channel_id", type: "string", description: "Channel ID" },
  { name: "files",      type: "array",  description: "Received attachments" },
];

export const CHANNEL_INPUT: OutputField[] = [
  { name: "message", type: "string", description: "Message to send" },
  { name: "files",   type: "array",  description: "Files to deliver" },
];

export const END_INPUT: OutputField[] = [
  { name: "result", type: "any", description: "Final result to output" },
];

/** 출력 대상별 필요 파라미터 스키마. */
export const END_TARGET_PARAMS: Record<string, OutputField[]> = {
  channel: [
    { name: "channel.message", type: "string", description: "node.end.param.channel.message" },
    { name: "channel.channel_type", type: "string", description: "node.end.param.channel.channel_type" },
    { name: "channel.chat_id", type: "string", description: "node.end.param.channel.chat_id" },
  ],
  media: [
    { name: "media.data", type: "any", description: "node.end.param.media.data" },
    { name: "media.mime_type", type: "string", description: "node.end.param.media.mime_type" },
    { name: "media.filename", type: "string", description: "node.end.param.media.filename" },
  ],
  webhook: [
    { name: "webhook.url", type: "string", description: "node.end.param.webhook.url" },
    { name: "webhook.method", type: "string", description: "node.end.param.webhook.method" },
    { name: "webhook.body", type: "object", description: "node.end.param.webhook.body" },
  ],
  http: [
    { name: "http.status", type: "number", description: "node.end.param.http.status" },
    { name: "http.body", type: "any", description: "node.end.param.http.body" },
    { name: "http.headers", type: "object", description: "node.end.param.http.headers" },
  ],
};

/** 선택된 출력 대상에 따른 End 노드 동적 input 필드 계산. */
export function get_end_input_fields(output_targets: string[]): OutputField[] {
  const fields: OutputField[] = [...END_INPUT];
  for (const target of output_targets) {
    const params = END_TARGET_PARAMS[target];
    if (params) fields.push(...params);
  }
  return fields;
}

/** non-orche 노드의 출력 스키마 fallback. */
const EXTRA_OUTPUT: Record<string, OutputField[]> = {
  phase: PHASE_OUTPUT,
  trigger: TRIGGER_OUTPUT,
  channel: CHANNEL_OUTPUT,
  end: [],
};

/** non-orche 노드의 입력 스키마 fallback. */
const EXTRA_INPUT: Record<string, OutputField[]> = {
  phase: PHASE_INPUT,
  trigger: [],
  channel: CHANNEL_INPUT,
  end: END_INPUT,
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
