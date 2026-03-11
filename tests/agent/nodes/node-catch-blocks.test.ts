/**
 * 여러 노드 핸들러 catch 분기 및 미커버 분기 보충:
 * - prometheus.ts L66: PrometheusTool 예외 → catch → success: false
 * - stats.ts L47: StatsTool 예외 → catch → success: false
 * - vcard.ts L72: VcardTool 예외 → catch → valid: false
 * - tree-data.ts L57: TreeTool 예외 → catch → error 반환
 * - validator.ts L37: email operation + non-validate action → 결과 직접 노출
 */
import { describe, it, expect, vi } from "vitest";
import type { OrcheNodeDefinition } from "@src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/nodes/orche-node-executor.js";

vi.mock("@src/agent/tools/prometheus.js", () => ({
  PrometheusTool: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockRejectedValue(new Error("prometheus error")),
  })),
}));
vi.mock("@src/agent/tools/stats.js", () => ({
  StatsTool: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockRejectedValue(new Error("stats error")),
  })),
}));
vi.mock("@src/agent/tools/timeseries.js", () => ({
  TimeseriesTool: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockRejectedValue(new Error("timeseries error")),
  })),
}));
vi.mock("@src/agent/tools/vcard.js", () => ({
  VcardTool: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockRejectedValue(new Error("vcard error")),
  })),
}));
vi.mock("@src/agent/tools/tree.js", () => ({
  TreeTool: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockRejectedValue(new Error("tree error")),
  })),
}));
vi.mock("@src/agent/tools/email-validate.js", () => ({
  EmailValidateTool: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockResolvedValue(JSON.stringify({ valid: true, normalized: "test@example.com" })),
  })),
}));

import { prometheus_handler } from "@src/agent/nodes/prometheus.js";
import { stats_handler } from "@src/agent/nodes/stats.js";
import { vcard_handler } from "@src/agent/nodes/vcard.js";
import { tree_data_handler } from "@src/agent/nodes/tree-data.js";
import { validator_handler } from "@src/agent/nodes/validator.js";

function make_ctx(): OrcheNodeExecutorContext {
  return { memory: {}, workspace: "/tmp", abort_signal: undefined };
}

function make_node(type: string, extras: Record<string, unknown> = {}): OrcheNodeDefinition {
  return { node_id: "n1", node_type: type, ...extras } as unknown as OrcheNodeDefinition;
}

// ── prometheus.ts L66 ────────────────────────────────────────────────────────

describe("prometheus_handler — L66: 예외 → catch → success: false", () => {
  it("PrometheusTool 예외 → { result: error_message, success: false } (L66)", async () => {
    const node = make_node("prometheus", { action: "format", metrics: "# TYPE x gauge\nx 1" });
    const result = await prometheus_handler.execute(node, make_ctx());
    expect(result.output.success).toBe(false);
    expect(typeof result.output.result).toBe("string");
  });
});

// ── stats.ts L47 ─────────────────────────────────────────────────────────────

describe("stats_handler — L47: 예외 → catch → success: false", () => {
  it("StatsTool 예외 → { result: error_message, success: false } (L47)", async () => {
    const node = make_node("stats", { action: "describe", data: "[1,2,3]" });
    const result = await stats_handler.execute(node, make_ctx());
    expect(result.output.success).toBe(false);
    expect(typeof result.output.result).toBe("string");
  });
});

// ── vcard.ts L72 ─────────────────────────────────────────────────────────────

describe("vcard_handler — L72: 예외 → catch → valid: false", () => {
  it("VcardTool 예외 → { result: '', valid: false, errors: [...] } (L72)", async () => {
    const node = make_node("vcard", { action: "parse", input: "BEGIN:VCARD" });
    const result = await vcard_handler.execute(node, make_ctx());
    expect(result.output.valid).toBe(false);
    expect(Array.isArray(result.output.errors)).toBe(true);
  });
});

// ── tree-data.ts L57 ─────────────────────────────────────────────────────────

describe("tree_data_handler — L57: 예외 → catch → error 반환", () => {
  it("TreeTool 예외 → { error: error_message } (L57)", async () => {
    const node = make_node("tree_data", { action: "build", data: "[]" });
    const result = await tree_data_handler.execute(node, make_ctx());
    expect(typeof result.output.error).toBe("string");
  });
});

// ── validator.ts L37 ─────────────────────────────────────────────────────────

describe("validator_handler — L37: email + non-validate action → 결과 직접 노출", () => {
  it("operation=email, email_action=normalize → else branch → 결과 spread (L37)", async () => {
    const node = make_node("validator", {
      operation: "email",
      input: "test@example.com",
      email_action: "normalize",
    });
    const result = await validator_handler.execute(node, make_ctx());
    // non-validate action → 결과 직접 노출 (L37)
    expect(result.output).toBeDefined();
    expect("valid" in result.output).toBe(true);
  });
});
