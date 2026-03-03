import { describe, it, expect } from "vitest";
import type { OrchestrationRequest } from "@src/orchestration/types.ts";
import { create_harness, inbound } from "@helpers/harness.ts";

describe("orchestrator execution routing", () => {
  it("once mode orchestration result is dispatched to channel", async () => {
    let captured_req: OrchestrationRequest | null = null;
    const harness = await create_harness({
      orchestration_handler: async (req) => {
        captured_req = req;
        return {
          reply: "현재 워크스페이스 상태 요약입니다.",
          mode: "once",
          tool_calls_count: 0,
          streamed: false,
        };
      },
    });
    try {
      await harness.manager.handle_inbound_message(inbound("워크스페이스 상태 요약해줘"));
      expect(captured_req).toBeTruthy();
      expect(captured_req!.provider).toBe("telegram");
      const last = harness.registry.sent[harness.registry.sent.length - 1];
      expect(String(last.content || "")).toMatch(/현재 워크스페이스 상태 요약/i);
    } finally {
      await harness.cleanup();
    }
  });

  it("task mode orchestration result is dispatched to channel", async () => {
    const harness = await create_harness({
      orchestration_handler: async () => ({
        reply: "task-loop-completed",
        mode: "task",
        tool_calls_count: 3,
        streamed: false,
      }),
    });
    try {
      await harness.manager.handle_inbound_message(inbound("승인 받으면서 순서대로 작업을 진행해줘"));
      const last = harness.registry.sent[harness.registry.sent.length - 1];
      expect(String(last.content || "")).toMatch(/task-loop-completed/i);
    } finally {
      await harness.cleanup();
    }
  });
});
