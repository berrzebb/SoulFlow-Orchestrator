import { describe, it, expect } from "vitest";
import type { OrchestrationRequest } from "@src/orchestration/types.ts";
import { ApprovalService } from "@src/channels/approval.service.ts";
import {
  create_harness, create_noop_logger, FakeDispatchService, FakeChannelRegistry,
  inbound,
} from "@helpers/harness.ts";

describe("channel manager agent runtime interface", () => {
  it("delegates orchestration execution and dispatches result", async () => {
    let captured_req: OrchestrationRequest | null = null;
    const harness = await create_harness({
      orchestration_handler: async (req) => {
        captured_req = req;
        return { reply: "RUNTIME_OK", mode: "agent", tool_calls_count: 1, streamed: false };
      },
    });
    try {
      await harness.manager.handle_inbound_message(inbound("인터페이스 기반 실행 테스트"));
      expect(captured_req).toBeTruthy();
      expect(captured_req!.provider).toBe("telegram");
      expect(captured_req!.message.chat_id).toBe("chat-1");
      expect(harness.registry.sent.length).toBeGreaterThan(0);
      expect(String(harness.registry.sent[harness.registry.sent.length - 1]?.content || "")).toMatch(/RUNTIME_OK/);
    } finally {
      await harness.cleanup();
    }
  });

  it("approval reply path works with real approval service", async () => {
    const logger = create_noop_logger();
    const registry = new FakeChannelRegistry();
    const dispatch = new FakeDispatchService(registry);

    let execute_called = 0;
    const approval = new ApprovalService({
      agent_runtime: {
        get_context_builder: () => ({ build_messages: async () => [] } as never),
        get_always_skills: () => [],
        recommend_skills: () => [],
        has_tool: () => true,
        register_tool: () => undefined,
        get_tool_definitions: () => [],
        execute_tool: async () => "ok",
        append_daily_memory: async () => undefined,
        list_approval_requests: () => [{
          request_id: "req-approve-1",
          tool_name: "exec",
          params: {},
          created_at: new Date().toISOString(),
          status: "pending" as const,
          context: { channel: "telegram", chat_id: "chat-1" },
        }],
        get_approval_request: () => ({
          request_id: "req-approve-1",
          tool_name: "exec",
          params: {},
          created_at: new Date().toISOString(),
          status: "pending" as const,
          context: { channel: "telegram", chat_id: "chat-1" },
        }),
        resolve_approval_request: () => ({
          ok: true,
          decision: "approve" as const,
          status: "approved" as const,
          confidence: 1,
        }),
        execute_approved_request: async () => {
          execute_called += 1;
          return { ok: true, status: "approved" as const, tool_name: "exec", result: "APPROVED_OK" };
        },
        run_agent_loop: async () => ({ state: {} as never, final_content: "ok" }),
        run_task_loop: async () => ({ state: { taskId: "t", title: "t", currentTurn: 1, maxTurns: 1, status: "completed", memory: {} } }),
      },
      send_reply: async (provider, message) => {
        return dispatch.send(provider, message);
      },
      resolve_reply_to: () => "",
      logger,
    });

    const harness = await create_harness({ approval_service: approval });
    try {
      await harness.manager.handle_inbound_message(inbound("✅ request_id:req-approve-1"));
      expect(execute_called).toBe(1);
      const approval_result = registry.sent.find((row) =>
        String((row.metadata as Record<string, unknown> | undefined)?.kind || "") === "approval_result",
      );
      expect(approval_result).toBeTruthy();
      expect(String(approval_result?.content || "")).toMatch(/승인.*확인|승인.*재개|APPROVED_OK/i);
    } finally {
      await harness.cleanup();
    }
  });
});
