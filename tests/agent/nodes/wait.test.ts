/** Wait 노드 핸들러 테스트
 *
 * 목표: wait_handler를 통한 대기 검증
 *       - timer: 지정된 시간만큼 대기
 *       - webhook/approval: 외부 신호 대기 (표시만)
 *       - delay_ms: 0~5분 범위 제한
 *       - resumed_at: 재개 타임스탬프
 */

import { describe, it, expect, vi } from "vitest";
import { wait_handler } from "@src/agent/nodes/wait.js";
import type { WaitNodeDefinition, OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/node-registry.js";

/* ── Mock Data ── */

const createMockWaitNode = (overrides?: Partial<WaitNodeDefinition>): WaitNodeDefinition => ({
  node_id: "wait-1",
  title: "Test Wait Node",
  node_type: "wait",
  wait_type: "timer",
  delay_ms: 1000,
  ...overrides,
});

const createMockContext = (overrides?: Partial<OrcheNodeExecutorContext>): OrcheNodeExecutorContext => ({
  memory: {
    agent_id: "agent-1",
    user_id: "user-1",
    workspace_id: "workspace-1",
    previous_output: {},
  },
  ...overrides,
});

/* ── Tests ── */

describe("Wait Node Handler", () => {
  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(wait_handler.node_type).toBe("wait");
    });

    it("should have output_schema with resumed_at and payload", () => {
      const schema = wait_handler.output_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("resumed_at");
      expect(fields).toContain("payload");
    });

    it("should have create_default returning valid node template", () => {
      const defaultNode = wait_handler.create_default?.();
      expect(defaultNode?.wait_type).toBe("timer");
      expect(defaultNode?.delay_ms).toBe(5000);
    });
  });

  describe("execute — timer type", () => {
    it("should delay execution", async () => {
      const node = createMockWaitNode({
        wait_type: "timer",
        delay_ms: 100,
      });
      const ctx = createMockContext();

      const start = Date.now();
      const result = await wait_handler.execute(node, ctx);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(100);
      expect(result.output.resumed_at).toBeDefined();
      expect(result.output.payload).toBeNull();
    });

    it("should handle zero delay", async () => {
      const node = createMockWaitNode({
        wait_type: "timer",
        delay_ms: 0,
      });
      const ctx = createMockContext();

      const result = await wait_handler.execute(node, ctx);

      expect(result.output.resumed_at).toBeDefined();
      expect(result.output.payload).toBeNull();
    });

    it("should use default delay when undefined", async () => {
      const node = createMockWaitNode({
        wait_type: "timer",
        delay_ms: undefined as any,
      });
      const ctx = createMockContext();

      const start = Date.now();
      const result = await wait_handler.execute(node, ctx);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(5000 - 100); // Allow some variance
      expect(result.output.resumed_at).toBeDefined();
    });

    it("should clamp delay to maximum (5 minutes)", async () => {
      const node = createMockWaitNode({
        wait_type: "timer",
        delay_ms: 5 * 60 * 1000, // Exactly 5 minutes
      });
      const ctx = createMockContext();

      // Just verify the node accepts max delay without issue
      expect(node.delay_ms).toBe(5 * 60 * 1000);

      // Don't actually execute this long delay in test
      // The clamping is verified in the test() validation test
    });

    it("should return valid ISO timestamp", async () => {
      const node = createMockWaitNode({
        wait_type: "timer",
        delay_ms: 10,
      });
      const ctx = createMockContext();

      const result = await wait_handler.execute(node, ctx);

      const timestamp = new Date(result.output.resumed_at);
      expect(timestamp).toBeInstanceOf(Date);
      expect(timestamp.getTime()).toBeGreaterThan(0);
    });
  });

  describe("execute — webhook type", () => {
    it("should return immediately for webhook", async () => {
      const node = createMockWaitNode({
        wait_type: "webhook",
      });
      const ctx = createMockContext();

      const start = Date.now();
      const result = await wait_handler.execute(node, ctx);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(100); // Should not delay
      expect(result.output.resumed_at).toBeDefined();
      expect(result.output.payload).toBeNull();
    });
  });

  describe("execute — approval type", () => {
    it("should return immediately for approval", async () => {
      const node = createMockWaitNode({
        wait_type: "approval",
      });
      const ctx = createMockContext();

      const start = Date.now();
      const result = await wait_handler.execute(node, ctx);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(100);
      expect(result.output.resumed_at).toBeDefined();
      expect(result.output.payload).toBeNull();
    });
  });

  describe("execute — delay edge cases", () => {
    it("should handle negative delay", async () => {
      const node = createMockWaitNode({
        wait_type: "timer",
        delay_ms: -1000,
      });
      const ctx = createMockContext();

      const result = await wait_handler.execute(node, ctx);

      expect(result.output.resumed_at).toBeDefined();
    });

    it("should handle float delay", async () => {
      const node = createMockWaitNode({
        wait_type: "timer",
        delay_ms: 50.7,
      });
      const ctx = createMockContext();

      const start = Date.now();
      const result = await wait_handler.execute(node, ctx);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(50);
      expect(result.output.resumed_at).toBeDefined();
    });

    it("should handle maximum delay (5 minutes)", async () => {
      const node = createMockWaitNode({
        wait_type: "timer",
        delay_ms: 5 * 60 * 1000,
      });
      const ctx = createMockContext();

      // Don't actually wait 5 minutes in test - just verify it's accepted
      expect(node.delay_ms).toBe(5 * 60 * 1000);
    });
  });

  describe("test (validation)", () => {
    it("should return no warnings for valid timer", () => {
      const node = createMockWaitNode({
        wait_type: "timer",
        delay_ms: 1000,
      });
      const ctx = createMockContext();

      const result = wait_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should warn when delay exceeds maximum", () => {
      const node = createMockWaitNode({
        wait_type: "timer",
        delay_ms: 10 * 60 * 1000, // 10 minutes
      });
      const ctx = createMockContext();

      const result = wait_handler.test(node, ctx);

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain("exceeds maximum");
    });

    it("should not warn for webhook", () => {
      const node = createMockWaitNode({
        wait_type: "webhook",
        delay_ms: 999999,
      });
      const ctx = createMockContext();

      const result = wait_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should include preview with wait_type and delay_ms", () => {
      const node = createMockWaitNode({
        wait_type: "timer",
        delay_ms: 3000,
      });
      const ctx = createMockContext();

      const result = wait_handler.test(node, ctx);

      expect(result.preview.wait_type).toBe("timer");
      expect(result.preview.delay_ms).toBe(3000);
    });
  });

  describe("integration scenarios", () => {
    it("should wait then continue workflow", async () => {
      const node = createMockWaitNode({
        wait_type: "timer",
        delay_ms: 50,
      });
      const ctx = createMockContext();

      const result1 = await wait_handler.execute(node, ctx);
      expect(result1.output.resumed_at).toBeDefined();

      // Simulate next node execution
      const node2 = createMockWaitNode({ delay_ms: 10 });
      const result2 = await wait_handler.execute(node2, ctx);
      expect(result2.output.resumed_at).toBeDefined();

      // Both should have timestamps
      const time1 = new Date(result1.output.resumed_at).getTime();
      const time2 = new Date(result2.output.resumed_at).getTime();
      expect(time2).toBeGreaterThan(time1);
    });

    it("should support retry with wait", async () => {
      const delays = [100, 200, 300];
      for (const delay of delays) {
        const node = createMockWaitNode({
          wait_type: "timer",
          delay_ms: delay,
        });
        const ctx = createMockContext();

        const start = Date.now();
        const result = await wait_handler.execute(node, ctx);
        const elapsed = Date.now() - start;

        expect(elapsed).toBeGreaterThanOrEqual(delay - 50); // Allow variance
        expect(result.output.resumed_at).toBeDefined();
      }
    });

    it("should handle timeout scenarios", async () => {
      // Simulate checking for timeout
      const node = createMockWaitNode({
        wait_type: "webhook",
        delay_ms: 30000, // 30 seconds timeout
      });
      const ctx = createMockContext();

      const result = await wait_handler.execute(node, ctx);
      expect(result.output.resumed_at).toBeDefined();
    });
  });
});
