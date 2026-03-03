import { describe, it, expect } from "vitest";
import { __cli_provider_test__ } from "@src/providers/cli-protocol.ts";

describe("cli provider tool call parser", () => {
  it("extracts tool block from json-event encoded text", () => {
    const raw = [
      "{\"type\":\"thread.started\"}",
      "{\"type\":\"item.completed\",\"item\":{\"id\":\"item_1\",\"type\":\"agent_message\",\"text\":\"<<ORCH_TOOL_CALLS>>\\n{\\\"tool_calls\\\":[{\\\"id\\\":\\\"call_1\\\",\\\"name\\\":\\\"list_dir\\\",\\\"arguments\\\":{\\\"path\\\":\\\".\\\",\\\"limit\\\":5}}]}\\n<<ORCH_TOOL_CALLS_END>>\"}}",
      "{\"type\":\"turn.completed\"}",
    ].join("\n");

    const calls = __cli_provider_test__.parse_tool_calls_from_output(raw);
    expect(calls.length).toBe(1);
    expect(calls[0].name).toBe("list_dir");
    expect(String(calls[0].arguments.path)).toBe(".");
  });

  it("extracts tool_calls from final json content without markers", () => {
    const raw = [
      "{\"type\":\"thread.started\"}",
      "{\"type\":\"item.completed\",\"item\":{\"id\":\"item_2\",\"type\":\"agent_message\",\"text\":\"{\\\"tool_calls\\\":[{\\\"id\\\":\\\"call_9\\\",\\\"name\\\":\\\"request_file\\\",\\\"arguments\\\":{\\\"prompt\\\":\\\"업로드\\\"}}]}\"}}",
      "{\"type\":\"turn.completed\"}",
    ].join("\n");

    const calls = __cli_provider_test__.parse_tool_calls_from_output(raw);
    expect(calls.length).toBe(1);
    expect(calls[0].name).toBe("request_file");
    expect(String(calls[0].arguments.prompt)).toBe("업로드");
  });
});
