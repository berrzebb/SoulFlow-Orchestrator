import { describe, it, expect } from "vitest";
import { ai_agent_handler } from "@src/agent/nodes/ai-agent.js";
import type { AiAgentNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/orche-node-executor.js";

const createMockNode = (overrides?: Partial<AiAgentNodeDefinition>): AiAgentNodeDefinition => ({
  node_id: "agent-1",
  label: "Test Agent",
  node_type: "ai_agent",
  backend: "openrouter",
  system_prompt: "You are helpful",
  user_prompt: "Hello",
  tool_nodes: ["tool1"],
  max_turns: 10,
  ...overrides,
});

const createMockContext = (overrides?: Partial<OrcheNodeExecutorContext>): OrcheNodeExecutorContext => ({
  memory: { agent_id: "agent-1" },
  ...overrides,
});

describe("AI Agent Node Handler", () => {
  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(ai_agent_handler.node_type).toBe("ai_agent");
    });

    it("should have output_schema", () => {
      const schema = ai_agent_handler.output_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("result");
      expect(fields).toContain("tool_calls");
    });

    it("should have create_default", () => {
      const defaultNode = ai_agent_handler.create_default?.();
      expect(defaultNode?.backend).toBe("openrouter");
      expect(defaultNode?.max_turns).toBe(10);
    });
  });

  describe("execute", () => {
    it("should return empty result", async () => {
      const node = createMockNode();
      const ctx = createMockContext();
      const result = await ai_agent_handler.execute(node, ctx);
      expect(result.output.result).toBe("");
      expect(result.output.tool_calls).toEqual([]);
    });

    it("should resolve templates", async () => {
      const node = createMockNode({
        system_prompt: "Agent {{memory.agent_id}}",
      });
      const ctx = createMockContext();
      const result = await ai_agent_handler.execute(node, ctx);
      expect(result.output._meta?.system_prompt).toContain("agent-1");
    });

    it("should preserve backend", async () => {
      const node = createMockNode({ backend: "claude_sdk" });
      const ctx = createMockContext();
      const result = await ai_agent_handler.execute(node, ctx);
      expect(result.output._meta?.backend).toBe("claude_sdk");
    });

    it("should preserve tool_nodes", async () => {
      const node = createMockNode({ tool_nodes: ["t1", "t2"] });
      const ctx = createMockContext();
      const result = await ai_agent_handler.execute(node, ctx);
      expect(result.output._meta?.tool_nodes).toEqual(["t1", "t2"]);
    });
  });

  describe("test", () => {
    it("should return no warnings for valid config", () => {
      const node = createMockNode();
      const ctx = createMockContext();
      const result = ai_agent_handler.test(node, ctx);
      expect(result.warnings).toEqual([]);
    });

    it("should warn when backend missing", () => {
      const node = createMockNode() as any;
      delete node.backend;
      const ctx = createMockContext();
      const result = ai_agent_handler.test(node, ctx);
      expect(result.warnings).toContain("backend is not set");
    });

    it("should warn when user_prompt missing", () => {
      const node = createMockNode() as any;
      delete node.user_prompt;
      const ctx = createMockContext();
      const result = ai_agent_handler.test(node, ctx);
      expect(result.warnings.some((w) => w.includes("user_prompt"))).toBe(true);
    });

    it("should warn on high max_turns", () => {
      const node = createMockNode({ max_turns: 100 });
      const ctx = createMockContext();
      const result = ai_agent_handler.test(node, ctx);
      expect(result.warnings.some((w) => w.includes("expensive"))).toBe(true);
    });

    it("should warn when no tools", () => {
      const node = createMockNode({ tool_nodes: [] });
      const ctx = createMockContext();
      const result = ai_agent_handler.test(node, ctx);
      expect(result.warnings.some((w) => w.includes("tool_nodes"))).toBe(true);
    });

    it("should include preview", () => {
      const node = createMockNode({ backend: "openrouter", model: "claude-3" });
      const ctx = createMockContext();
      const result = ai_agent_handler.test(node, ctx);
      expect(result.preview.backend).toBe("openrouter");
      expect(result.preview.model).toBe("claude-3");
    });

    it("should count tools", () => {
      const node = createMockNode({ tool_nodes: ["t1", "t2", "t3"] });
      const ctx = createMockContext();
      const result = ai_agent_handler.test(node, ctx);
      expect(result.preview.tool_count).toBe(3);
    });
  });

  describe("edge cases", () => {
    it("should handle long prompts", () => {
      const longPrompt = "A".repeat(5000);
      const node = createMockNode({ system_prompt: longPrompt });
      const ctx = createMockContext();
      const result = ai_agent_handler.test(node, ctx);
      expect(result.warnings).toEqual([]);
    });

    it("should handle many tools", () => {
      const tools = Array(20)
        .fill(null)
        .map((_, i) => `tool-${i}`);
      const node = createMockNode({ tool_nodes: tools });
      const ctx = createMockContext();
      const result = ai_agent_handler.test(node, ctx);
      expect(result.preview.tool_count).toBe(20);
    });

    it("should default model to auto", () => {
      const node = createMockNode() as any;
      delete node.model;
      const ctx = createMockContext();
      const result = ai_agent_handler.test(node, ctx);
      expect(result.preview.model).toBe("auto");
    });

    it("should include schema indicator", () => {
      const node = createMockNode();
      const ctx = createMockContext();
      const result = ai_agent_handler.test(node, ctx);
      expect(result.preview.has_schema).toBe(false);
    });
  });
});
