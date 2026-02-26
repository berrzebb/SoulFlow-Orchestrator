import assert from "node:assert/strict";
import test from "node:test";
import { AgentLoopStore } from "../src/agent/loop.service.ts";
import { LlmResponse } from "../src/providers/types.ts";

class FakeProviders {
  private turn = 0;

  async run_headless_with_context(): Promise<LlmResponse> {
    this.turn += 1;
    if (this.turn === 1) {
      return new LlmResponse({
        content: "{\"tool_calls\":[{\"id\":\"call_1\",\"name\":\"ping\",\"arguments\":{\"value\":\"ok\"}}]}",
      });
    }
    return new LlmResponse({ content: "done" });
  }
}

test("agent loop executes implicit tool_calls encoded in content JSON", async () => {
  const loop = new AgentLoopStore();
  let executed = 0;
  const providers = new FakeProviders();

  const result = await loop.run_agent_loop({
    loop_id: "loop-test-implicit-tool-calls",
    agent_id: "assistant",
    objective: "test",
    context_builder: {} as never,
    providers: providers as never,
    tools: [],
    provider_id: "chatgpt",
    current_message: "test",
    history_days: [],
    max_turns: 3,
    check_should_continue: async () => false,
    on_tool_calls: async ({ tool_calls }) => {
      executed += tool_calls.length;
      return "[tool:ping] ok";
    },
  });

  assert.equal(executed, 1);
  assert.equal(result.state.status, "completed");
  assert.equal(result.final_content, "done");
});

