import { describe, it, expect } from "vitest";
import { system_info_handler } from "../../../src/agent/nodes/system-info.js";
import type { OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("system_info_handler", () => {
  const createMockNode = (overrides?: Partial<any>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "system_info",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be system_info", () => {
    expect(system_info_handler.node_type).toBe("system_info");
  });

  it("execute: should execute handler", async () => {
    const node = createMockNode();
    const ctx = createMockContext();
    const result = await system_info_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should be defined", () => {
    const node = createMockNode();
    const result = system_info_handler.test(node);
    expect(result.preview).toBeDefined();
  });
});

describe("system_info — 미커버 분기", () => {
  it("execute: category=unknown_cat → CATEGORY_CMDS 누락 → L40 continue", async () => {
    const node = { node_id: "n1", node_type: "system_info", category: "unknown_cat" } as any;
    const ctx = { memory: {}, workspace: "/tmp", abort_signal: undefined };
    const result = await system_info_handler.execute(node, ctx);
    expect(result.output.success).toBe(true);
  });

  it("test: 유효하지 않은 category → L61 경고 추가", () => {
    const node = { node_id: "n1", node_type: "system_info", category: "invalid_cat" } as any;
    const result = system_info_handler.test(node);
    expect(result.warnings.some((w: string) => w.includes("unknown category"))).toBe(true);
  });
});
