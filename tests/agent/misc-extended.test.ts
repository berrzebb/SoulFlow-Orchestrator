/**
 * 소규모 미커버 경로 보충.
 * cd-scoring: redo 경로, error 이벤트(rollback 없음)
 * node-registry: register_node 중복 throw, get_all_handlers
 */
import { describe, it, expect } from "vitest";
import { create_cd_observer } from "../../src/agent/cd-scoring.js";
import type { AgentEvent, AgentEventSource } from "../../src/agent/agent.types.js";

const source: AgentEventSource = { backend: "claude_cli" };
const at = "2026-03-01T00:00:00Z";

// ══════════════════════════════════════════
// cd-scoring: redo 경로 (rollback 포함 에러)
// ══════════════════════════════════════════

describe("CD 옵저버 — redo 경로", () => {
  it("rollback 포함 에러 이벤트 → redo (+40) 감지", () => {
    const cd = create_cd_observer();
    const event: AgentEvent = {
      type: "error",
      source,
      at,
      error: "action rollback: step3 failed",
    };
    const result = cd.observe(event);
    expect(result).not.toBeNull();
    expect(result!.indicator).toBe("redo");
    expect(result!.points).toBe(40);
    expect(cd.get_score().total).toBe(40);
  });

  it("rollback 없는 에러 이벤트 → null 반환", () => {
    const cd = create_cd_observer();
    const event: AgentEvent = {
      type: "error",
      source,
      at,
      error: "network timeout",
    };
    const result = cd.observe(event);
    expect(result).toBeNull();
  });

  it("redo 후 clarify 합산 → 점수 50", () => {
    const cd = create_cd_observer();
    cd.observe({ type: "error", source, at, error: "rollback: step failed" });
    cd.observe({ type: "tool_use", source, at, tool_name: "ask_user", tool_id: "t1", params: {} });
    expect(cd.get_score().total).toBe(50); // 40 + 10
    expect(cd.get_score().events).toHaveLength(2);
  });
});

// ══════════════════════════════════════════
// node-registry: 중복 등록 에러 + get_all_handlers
// ══════════════════════════════════════════

describe("node-registry", () => {
  it("register_node 중복 → Error throw", async () => {
    const { register_node, get_node_handler } = await import("../../src/agent/node-registry.js");
    const handler = { node_type: "test-ext-unique-xyz", icon: "T", color: "#000", shape: "rect" as const,
      output_schema: [], input_schema: [],
      async execute() { return { output: {} }; },
      test() { return { preview: {}, warnings: [] }; },
    };
    register_node(handler);
    expect(get_node_handler("test-ext-unique-xyz")).toBe(handler);
    // 중복 등록 시 throw
    expect(() => register_node(handler)).toThrow("duplicate node handler");
  });
});
