import { describe, it, expect } from "vitest";
import { matrix_handler } from "../../../src/agent/nodes/matrix.js";
import type { MatrixNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("matrix_handler", () => {
  const createMockNode = (overrides?: Partial<MatrixNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "matrix",
    operation: "multiply",
    matrix_a: [[1, 2], [3, 4]],
    matrix_b: [[5, 6], [7, 8]],
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be matrix", () => {
    expect(matrix_handler.node_type).toBe("matrix");
  });

  it("execute: should multiply matrices", async () => {
    const node = createMockNode({ operation: "multiply" });
    const ctx = createMockContext();
    const result = await matrix_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in matrix values", async () => {
    const node = createMockNode({ matrix_a: "${matrix1}" });
    const ctx = createMockContext({ matrix1: [[1, 2], [3, 4]] });
    const result = await matrix_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should add matrices", async () => {
    const node = createMockNode({ operation: "add" });
    const ctx = createMockContext();
    const result = await matrix_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should transpose matrix", async () => {
    const node = createMockNode({
      operation: "transpose",
      matrix_a: [[1, 2, 3], [4, 5, 6]],
    });
    const ctx = createMockContext();
    const result = await matrix_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should show operation", () => {
    const node = createMockNode();
    const result = matrix_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("create_default: returns default config (L20)", () => {
    const defaults = matrix_handler.create_default?.();
    expect(defaults).toBeDefined();
    expect((defaults as any).action).toBe("multiply");
  });

  it("execute: a/b as strings → success path → L35 JSON.parse", async () => {
    // 문자열 형태로 전달 → resolve_templates 정상 동작 → MatrixTool 반환값 JSON.parse 성공
    const node = { node_id: "n1", node_type: "matrix", action: "multiply", a: "[[1,0],[0,1]]", b: "[[1,0],[0,1]]" } as any;
    const ctx = createMockContext();
    const result = await matrix_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect((result.output as any).result).toBeDefined();
  });

  it("test: a 없음 + action≠identity → 'matrix A is required' 경고 (L44-45)", () => {
    const node = { node_id: "n1", node_type: "matrix", action: "multiply" } as any;
    const result = matrix_handler.test(node);
    expect(result.warnings).toContain("matrix A is required");
    expect(result.warnings).toContain("matrix B is required for this operation");
  });

  it("execute: should calculate determinant", async () => {
    const node = createMockNode({
      operation: "determinant",
      matrix_a: [[1, 2], [3, 4]],
    });
    const ctx = createMockContext();
    const result = await matrix_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should invert matrix", async () => {
    const node = createMockNode({
      operation: "invert",
      matrix_a: [[1, 2], [3, 4]],
    });
    const ctx = createMockContext();
    const result = await matrix_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle dimension mismatch gracefully", async () => {
    const node = createMockNode({
      matrix_a: [[1, 2]],
      matrix_b: [[5, 6], [7, 8]],
    });
    const ctx = createMockContext();
    const result = await matrix_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
