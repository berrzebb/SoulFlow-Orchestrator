/**
 * F4: Workflow Compiler Quality Policy — 컴파일된 워크플로우의 품질 판정.
 *
 * workflow-compiler-rules.md의 5개 규칙을 정책 인터페이스로 고정:
 * 1. catalog 먼저 조회 (trigger/entry point 존재)
 * 2. role baseline 재사용 (context_template 남용 금지)
 * 3. agentless/direct node 우선
 * 4. ai_agent/phase 노드는 꼭 필요한 경우만
 * 5. role baseline을 새 문자열로 재창작 금지
 */

import type { WorkflowNodeDefinition } from "../agent/workflow-node.types.js";

export type CompilerViolationCode =
  | "agent_heavy"           // phase 노드 비율 초과 — direct 노드 부족
  | "inline_role_prompt"    // context_template에 role baseline 재창작 (긴 인라인 프롬프트)
  | "missing_entry_point"   // trigger 노드 없음
  | "no_direct_nodes";      // http/code/llm 등 직접 실행 노드 전혀 없음

export interface CompilerViolation {
  code: CompilerViolationCode;
  severity: "major" | "minor";
  detail?: string;
}

export interface WorkflowAuditResult {
  passed: boolean;
  violations: CompilerViolation[];
  /** phase 노드 수 / 전체 노드 수. 0이면 phase 없음. */
  agent_node_ratio: number;
}

export interface WorkflowCompilerPolicy {
  /** phase 노드 비율 한도. 초과 시 agent_heavy 위반. 기본 0.5. */
  max_agent_ratio: number;
  /** context_template 길이가 이 값 초과 시 inline_role_prompt 경고. 기본 300자. */
  max_inline_prompt_chars: number;
  /** trigger 노드 필수 여부. 기본 true. */
  require_entry_point: boolean;
}

/** 합리적인 기본 정책: agent ≤ 50%, 인라인 프롬프트 300자 이하, 진입점 필수. */
export const DEFAULT_COMPILER_POLICY: WorkflowCompilerPolicy = {
  max_agent_ratio: 0.5,
  max_inline_prompt_chars: 300,
  require_entry_point: true,
};

/** 직접 실행 노드 타입 — agent(phase) 외의 실질적 작업 노드. */
const DIRECT_NODE_TYPES = new Set(["http", "code", "llm", "retriever", "db", "file", "transform"]);

/**
 * 워크플로우 노드 목록을 정책에 따라 감사.
 * nodes가 비어있으면 violations 없이 passed: true (빈 워크플로우는 별도 검증 대상).
 */
export function audit_workflow_nodes(
  nodes: WorkflowNodeDefinition[],
  policy: WorkflowCompilerPolicy = DEFAULT_COMPILER_POLICY,
): WorkflowAuditResult {
  if (nodes.length === 0) {
    return { passed: true, violations: [], agent_node_ratio: 0 };
  }

  const violations: CompilerViolation[] = [];

  const phase_count = nodes.filter((n) => n.node_type === "phase").length;
  const has_trigger = nodes.some((n) => n.node_type === "trigger");
  const has_direct = nodes.some((n) => DIRECT_NODE_TYPES.has(n.node_type));
  const agent_node_ratio = phase_count / nodes.length;

  // 규칙 3+4: phase 노드 비율 초과
  if (agent_node_ratio > policy.max_agent_ratio) {
    violations.push({
      code: "agent_heavy",
      severity: "major",
      detail: `phase 노드 ${phase_count}/${nodes.length} (${(agent_node_ratio * 100).toFixed(0)}%) > ${(policy.max_agent_ratio * 100).toFixed(0)}% 한도`,
    });
  }

  // 규칙 3: 직접 실행 노드 전무
  if (!has_direct && phase_count > 0) {
    violations.push({ code: "no_direct_nodes", severity: "minor" });
  }

  // 규칙 1: 진입점(trigger) 없음
  if (policy.require_entry_point && !has_trigger) {
    violations.push({ code: "missing_entry_point", severity: "minor" });
  }

  // 규칙 2+5: phase 노드의 context_template 길이 검사
  for (const node of nodes) {
    if (node.node_type !== "phase") continue;
    const tmpl = node.context_template ?? "";
    if (tmpl.length > policy.max_inline_prompt_chars) {
      violations.push({
        code: "inline_role_prompt",
        severity: "minor",
        detail: `node "${node.node_id}" context_template ${tmpl.length}자 > ${policy.max_inline_prompt_chars}자 한도`,
      });
    }
  }

  const has_major = violations.some((v) => v.severity === "major");
  return { passed: !has_major, violations, agent_node_ratio };
}
