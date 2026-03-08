import { describe, it, expect } from "vitest";
import { duration_handler } from "../../../src/agent/nodes/duration.js";
import type { DurationNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("duration_handler", () => {
  const createMockNode = (overrides?: Partial<DurationNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "duration",
    action: "parse",
    duration: "PT1H",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be duration", () => {
    expect(duration_handler.node_type).toBe("duration");
  });

  it("metadata: output_schema should have result and ms fields", () => {
    expect(duration_handler.output_schema).toEqual([
      { name: "result", type: "unknown", description: "Duration calculation result" },
      { name: "ms", type: "number", description: "Duration in milliseconds" },
    ]);
  });

  it("metadata: input_schema should have action and duration fields", () => {
    expect(duration_handler.input_schema).toEqual([
      { name: "action", type: "string", description: "parse / format / to_ms / from_ms / add / subtract / humanize" },
      { name: "duration", type: "string", description: "Duration string (ISO 8601 or human)" },
    ]);
  });

  it("create_default: should return default config", () => {
    const defaults = duration_handler.create_default?.();
    expect(defaults).toEqual({ action: "parse", duration: "PT1H" });
  });

  it("execute: should handle parse action", async () => {
    const node = createMockNode({ action: "parse", duration: "PT1H" });
    const ctx = createMockContext();
    const result = await duration_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(result.output).toHaveProperty("result");
    expect(result.output).toHaveProperty("ms");
  });

  it("execute: should resolve templates in duration", async () => {
    const node = createMockNode({ action: "parse", duration: "${val}" });
    const ctx = createMockContext({ val: "PT30M" });
    const result = await duration_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(result.output).toHaveProperty("ms");
  });

  it("test validation: should warn if duration is missing and action is not from_ms", () => {
    const node = createMockNode({ action: "parse", duration: "" });
    const result = duration_handler.test(node);
    expect(result.warnings).toContain("duration is required");
  });

  it("test validation: should not warn if action is from_ms without duration", () => {
    const node = createMockNode({ action: "from_ms", duration: "" });
    const result = duration_handler.test(node);
    expect(result.warnings).not.toContain("duration is required");
  });

  it("test: preview should contain action and duration", () => {
    const node = createMockNode({ action: "parse", duration: "PT2H" });
    const result = duration_handler.test(node);
    expect(result.preview).toEqual({ action: "parse", duration: "PT2H" });
  });

  it("execute: should handle missing action (default to parse)", async () => {
    const node = createMockNode({ action: undefined, duration: "PT1H" });
    const ctx = createMockContext();
    const result = await duration_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle missing duration (default to empty string)", async () => {
    const node = createMockNode({ action: "parse", duration: undefined });
    const ctx = createMockContext();
    const result = await duration_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
