/**
 * analyzer.ts — 미커버 분기 (cov):
 * - L48: SentimentTool.execute() 예외 → catch → { analysis: {}, category: "error", ... }
 */
import { describe, it, expect, vi } from "vitest";
import type { OrcheNodeDefinition } from "@src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/nodes/orche-node-executor.js";

vi.mock("@src/agent/tools/sentiment.js", () => ({
  SentimentTool: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockRejectedValue(new Error("sentiment tool error")),
  })),
}));

import { analyzer_handler } from "@src/agent/nodes/analyzer.js";

function make_ctx(): OrcheNodeExecutorContext {
  return { memory: {}, workspace: "/tmp", abort_signal: undefined };
}

// ── L48: sentiment 모드에서 SentimentTool 예외 → catch ──────────────────────

describe("analyzer_handler — L48: SentimentTool throw → catch", () => {
  it("SentimentTool.execute() 예외 → category='error', confidence=0 (L48)", async () => {
    const node = {
      node_id: "n1",
      node_type: "analyzer",
      mode: "sentiment",
      input_field: "hello world",
      sentiment_action: "analyze",
    } as unknown as OrcheNodeDefinition;

    const result = await analyzer_handler.execute(node, make_ctx());
    expect(result.output.category).toBe("error");
    expect(result.output.confidence).toBe(0);
    expect(typeof result.output.error).toBe("string");
  });
});
