import { describe, it, expect } from "vitest";
import { AgentLoopStore } from "@src/agent/loop.ts";
import { LlmResponse } from "@src/providers/types.ts";

describe("agent loop tool guard", () => {
  it("stops early when identical tool calls repeat", async () => {
    const loop = new AgentLoopStore();
    let tool_handler_calls = 0;
    let provider_calls = 0;

    const providers = {
      run_headless_with_context: async () => {
        provider_calls += 1;
        return new LlmResponse({
          content: null,
          tool_calls: [
            {
              id: "call_1",
              name: "read_file",
              arguments: { path: "README.md" },
            },
          ],
          finish_reason: "tool_calls",
        });
      },
    };

    const result = await loop.run_agent_loop({
      loop_id: "loop-guard-1",
      agent_id: "assistant",
      objective: "반복 도구호출 방지 테스트",
      context_builder: {} as never,
      providers: providers as never,
      tools: [],
      provider_id: "chatgpt",
      current_message: "test",
      history_days: [],
      max_turns: 10,
      on_tool_calls: async () => {
        tool_handler_calls += 1;
        return "tool executed";
      },
      check_should_continue: async () => false,
    });

    expect(result.state.status).toBe("failed");
    expect(result.state.terminationReason).toBe("repeated_tool_calls");
    expect(tool_handler_calls).toBe(2);
    expect(provider_calls).toBe(3);
    expect(String(result.final_content || "")).toMatch(/반복/i);
  });
});
