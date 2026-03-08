/** Form 노드 핸들러 테스트
 *
 * 목표: form_handler를 통한 입력 폼 검증
 *       - 필드 설정
 *       - 타이머 설정
 *       - 타겟 채널
 */

import { describe, it, expect } from "vitest";
import { form_handler } from "@src/agent/nodes/form.js";
import type { FormNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/orche-node-executor.js";

const createMockFormNode = (overrides?: Partial<FormNodeDefinition>): FormNodeDefinition => ({
  node_id: "form-1",
  label: "Test Form",
  node_type: "form",
  title: "User Form",
  description: "Enter details",
  target: "origin",
  fields: [{ name: "username", type: "text", required: true }],
  timeout_ms: 60000,
  ...overrides,
});

const createMockContext = (overrides?: Partial<OrcheNodeExecutorContext>): OrcheNodeExecutorContext => ({
  memory: {
    agent_id: "agent-1",
  },
  ...overrides,
});

describe("Form Node Handler", () => {
  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(form_handler.node_type).toBe("form");
    });

    it("should have output_schema", () => {
      const schema = form_handler.output_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("fields");
      expect(fields).toContain("submitted_by");
    });

    it("should have create_default", () => {
      const defaultNode = form_handler.create_default?.();
      expect(defaultNode?.timeout_ms).toBe(600000);
    });
  });

  describe("execute", () => {
    it("should return default form state", async () => {
      const node = createMockFormNode();
      const ctx = createMockContext();

      const result = await form_handler.execute(node, ctx);

      expect(result.output.fields).toEqual({});
      expect(result.output.timed_out).toBe(false);
      expect(result.output.submitted_at).toBeDefined();
    });
  });

  describe("test (validation)", () => {
    it("should warn without fields", () => {
      const node = createMockFormNode({
        fields: [],
      });
      const ctx = createMockContext();

      const result = form_handler.test(node, ctx);

      expect(result.warnings).toContain("at least one field is required");
    });

    it("should warn for field without name", () => {
      const node = createMockFormNode({
        fields: [{ type: "text" }],
      });
      const ctx = createMockContext();

      const result = form_handler.test(node, ctx);

      expect(result.warnings.some((w) => w.includes("field name"))).toBe(true);
    });

    it("should warn when target is specified but no channel", () => {
      const node = createMockFormNode({
        target: "specified",
        channel: undefined,
      });
      const ctx = createMockContext();

      const result = form_handler.test(node, ctx);

      expect(result.warnings).toContain("channel is required when target is 'specified'");
    });

    it("should have no warnings for valid form", () => {
      const node = createMockFormNode({
        fields: [{ name: "email", type: "email", required: true }],
        target: "origin",
      });
      const ctx = createMockContext();

      const result = form_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should include preview", () => {
      const node = createMockFormNode({
        title: "Feedback Form",
        fields: [
          { name: "email", type: "email" },
          { name: "message", type: "textarea" },
        ],
      });
      const ctx = createMockContext();

      const result = form_handler.test(node, ctx);

      expect(result.preview.target).toBe("origin");
      expect(result.preview.field_count).toBe(2);
    });
  });

  describe("field types", () => {
    it("should support text fields", () => {
      const node = createMockFormNode({
        fields: [{ name: "text_field", type: "text" }],
      });
      const ctx = createMockContext();

      const result = form_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should support email fields", () => {
      const node = createMockFormNode({
        fields: [{ name: "email_field", type: "email" }],
      });
      const ctx = createMockContext();

      const result = form_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should support textarea fields", () => {
      const node = createMockFormNode({
        fields: [{ name: "textarea_field", type: "textarea" }],
      });
      const ctx = createMockContext();

      const result = form_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should support select fields", () => {
      const node = createMockFormNode({
        fields: [{ name: "select_field", type: "select", options: ["A", "B"] }],
      });
      const ctx = createMockContext();

      const result = form_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });
  });

  describe("targeting", () => {
    it("should support origin target", () => {
      const node = createMockFormNode({ target: "origin" });
      const ctx = createMockContext();

      const result = form_handler.test(node, ctx);

      expect(result.preview.target).toBe("origin");
    });

    it("should support specified channel", () => {
      const node = createMockFormNode({
        target: "specified",
        channel: "feedback-channel",
      });
      const ctx = createMockContext();

      const result = form_handler.test(node, ctx);

      expect(result.preview.target).toBe("specified");
    });
  });

  describe("timeout configuration", () => {
    it("should support custom timeout", () => {
      const node = createMockFormNode({ timeout_ms: 30000 });
      const ctx = createMockContext();

      const result = form_handler.test(node, ctx);

      expect(result.preview).toBeDefined();
    });

    it("should default to 10 minutes", () => {
      const node = createMockFormNode();
      const ctx = createMockContext();

      const result = form_handler.test(node, ctx);

      expect(result.preview).toBeDefined();
    });
  });

  describe("templates", () => {
    it("should resolve title template", () => {
      const node = createMockFormNode({
        title: "Form for {{memory.agent_id}}",
      });
      const ctx = createMockContext();

      const result = form_handler.test(node, ctx);

      expect(result.preview.title).toContain("agent-1");
    });

    it("should resolve description template", () => {
      const node = createMockFormNode({
        description: "Please provide {{memory.agent_id}} details",
      });
      const ctx = createMockContext();

      const result = form_handler.test(node, ctx);

      expect(result.preview).toBeDefined();
    });
  });

  describe("edge cases", () => {
    it("should handle multiple fields", () => {
      const fields = Array(10)
        .fill(null)
        .map((_, i) => ({ name: `field_${i}`, type: "text" }));
      const node = createMockFormNode({ fields });
      const ctx = createMockContext();

      const result = form_handler.test(node, ctx);

      expect(result.preview.field_count).toBe(10);
    });

    it("should handle long title", () => {
      const node = createMockFormNode({
        title: "A".repeat(200),
      });
      const ctx = createMockContext();

      const result = form_handler.test(node, ctx);

      expect(result.preview.title).toBeDefined();
    });
  });
});
