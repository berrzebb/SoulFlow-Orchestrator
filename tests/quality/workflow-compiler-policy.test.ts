import { describe, it, expect } from "vitest";
import {
  audit_workflow_nodes,
  DEFAULT_COMPILER_POLICY,
  type WorkflowCompilerPolicy,
} from "@src/quality/workflow-compiler-policy.ts";
import type { WorkflowNodeDefinition } from "@src/agent/workflow-node.types.ts";

function make_phase(id: string, context_template?: string): WorkflowNodeDefinition {
  return {
    node_id: id,
    title: id,
    node_type: "phase",
    agents: [],
    ...(context_template !== undefined ? { context_template } : {}),
  };
}

function make_http(id: string): WorkflowNodeDefinition {
  return { node_id: id, title: id, node_type: "http", url: "https://example.com", method: "GET" };
}

function make_trigger(id: string): WorkflowNodeDefinition {
  return { node_id: id, title: id, node_type: "trigger", trigger_type: "manual" };
}

function make_code(id: string): WorkflowNodeDefinition {
  return { node_id: id, title: id, node_type: "code", language: "javascript", code: "return 1;" };
}

// ── 빈 입력 ──────────────────────────────────────────────────────────────────

describe("audit_workflow_nodes — 빈 노드 목록", () => {
  it("빈 배열 → passed: true, violations 없음", () => {
    const r = audit_workflow_nodes([]);
    expect(r.passed).toBe(true);
    expect(r.violations).toHaveLength(0);
    expect(r.agent_node_ratio).toBe(0);
  });
});

// ── agent_heavy ───────────────────────────────────────────────────────────────

describe("audit_workflow_nodes — agent_heavy 위반", () => {
  it("phase 100% (trigger + phase만) → agent_heavy [major]", () => {
    const nodes: WorkflowNodeDefinition[] = [make_trigger("t"), make_phase("p1"), make_phase("p2")];
    const r = audit_workflow_nodes(nodes);
    expect(r.violations.some((v) => v.code === "agent_heavy")).toBe(true);
    expect(r.passed).toBe(false);
  });

  it("phase 50% (한도 정확히) → agent_heavy 없음", () => {
    const nodes: WorkflowNodeDefinition[] = [make_trigger("t"), make_http("h"), make_phase("p")];
    const r = audit_workflow_nodes(nodes);
    expect(r.violations.some((v) => v.code === "agent_heavy")).toBe(false);
  });

  it("agent_node_ratio 값 정확히 계산", () => {
    const nodes: WorkflowNodeDefinition[] = [make_phase("p"), make_http("h"), make_http("h2"), make_http("h3")];
    const r = audit_workflow_nodes(nodes);
    expect(r.agent_node_ratio).toBeCloseTo(0.25);
  });
});

// ── no_direct_nodes ───────────────────────────────────────────────────────────

describe("audit_workflow_nodes — no_direct_nodes 위반", () => {
  it("phase만 있고 http/code 없음 → no_direct_nodes [minor]", () => {
    const nodes: WorkflowNodeDefinition[] = [make_trigger("t"), make_phase("p")];
    const r = audit_workflow_nodes(nodes);
    expect(r.violations.some((v) => v.code === "no_direct_nodes")).toBe(true);
  });

  it("http 노드 있으면 no_direct_nodes 없음", () => {
    const nodes: WorkflowNodeDefinition[] = [make_trigger("t"), make_phase("p"), make_http("h")];
    const r = audit_workflow_nodes(nodes);
    expect(r.violations.some((v) => v.code === "no_direct_nodes")).toBe(false);
  });

  it("code 노드 있으면 no_direct_nodes 없음", () => {
    const nodes: WorkflowNodeDefinition[] = [make_trigger("t"), make_phase("p"), make_code("c")];
    const r = audit_workflow_nodes(nodes);
    expect(r.violations.some((v) => v.code === "no_direct_nodes")).toBe(false);
  });
});

// ── missing_entry_point ───────────────────────────────────────────────────────

describe("audit_workflow_nodes — missing_entry_point 위반", () => {
  it("trigger 없음 → missing_entry_point [minor]", () => {
    const nodes: WorkflowNodeDefinition[] = [make_http("h"), make_phase("p")];
    const r = audit_workflow_nodes(nodes);
    expect(r.violations.some((v) => v.code === "missing_entry_point")).toBe(true);
  });

  it("trigger 있으면 missing_entry_point 없음", () => {
    const nodes: WorkflowNodeDefinition[] = [make_trigger("t"), make_http("h")];
    const r = audit_workflow_nodes(nodes);
    expect(r.violations.some((v) => v.code === "missing_entry_point")).toBe(false);
  });

  it("require_entry_point=false 이면 검사 안 함", () => {
    const policy: WorkflowCompilerPolicy = { ...DEFAULT_COMPILER_POLICY, require_entry_point: false };
    const nodes: WorkflowNodeDefinition[] = [make_http("h"), make_phase("p")];
    const r = audit_workflow_nodes(nodes, policy);
    expect(r.violations.some((v) => v.code === "missing_entry_point")).toBe(false);
  });
});

// ── inline_role_prompt ────────────────────────────────────────────────────────

describe("audit_workflow_nodes — inline_role_prompt 위반", () => {
  it("context_template 300자 초과 → inline_role_prompt [minor]", () => {
    const long_prompt = "A".repeat(301);
    const nodes: WorkflowNodeDefinition[] = [make_trigger("t"), make_phase("p", long_prompt), make_http("h")];
    const r = audit_workflow_nodes(nodes);
    expect(r.violations.some((v) => v.code === "inline_role_prompt")).toBe(true);
  });

  it("context_template 정확히 300자 → 위반 없음", () => {
    const ok_prompt = "A".repeat(300);
    const nodes: WorkflowNodeDefinition[] = [make_trigger("t"), make_phase("p", ok_prompt), make_http("h")];
    const r = audit_workflow_nodes(nodes);
    expect(r.violations.some((v) => v.code === "inline_role_prompt")).toBe(false);
  });

  it("context_template 없는 phase → 위반 없음", () => {
    const nodes: WorkflowNodeDefinition[] = [make_trigger("t"), make_phase("p"), make_http("h")];
    const r = audit_workflow_nodes(nodes);
    expect(r.violations.some((v) => v.code === "inline_role_prompt")).toBe(false);
  });
});

// ── 통과 케이스 ───────────────────────────────────────────────────────────────

describe("audit_workflow_nodes — 정상 워크플로우 통과", () => {
  it("trigger + http + phase(≤50%) → passed: true, violations 없음", () => {
    const nodes: WorkflowNodeDefinition[] = [make_trigger("t"), make_http("h1"), make_http("h2"), make_phase("p")];
    const r = audit_workflow_nodes(nodes);
    expect(r.passed).toBe(true);
    expect(r.violations).toHaveLength(0);
  });
});
