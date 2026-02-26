import assert from "node:assert/strict";
import test from "node:test";
import { __cli_provider_test__ } from "../src/providers/cli.provider.ts";

test("cli parser extracts tool block from json-event encoded text", () => {
  const raw = [
    "{\"type\":\"thread.started\"}",
    "{\"type\":\"item.completed\",\"item\":{\"id\":\"item_1\",\"type\":\"agent_message\",\"text\":\"<<ORCH_TOOL_CALLS>>\\n{\\\"tool_calls\\\":[{\\\"id\\\":\\\"call_1\\\",\\\"name\\\":\\\"list_dir\\\",\\\"arguments\\\":{\\\"path\\\":\\\".\\\",\\\"limit\\\":5}}]}\\n<<ORCH_TOOL_CALLS_END>>\"}}",
    "{\"type\":\"turn.completed\"}",
  ].join("\n");

  const calls = __cli_provider_test__.parse_tool_calls_from_output(raw);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "list_dir");
  assert.equal(String(calls[0].arguments.path), ".");
});

test("cli parser extracts tool_calls from final json content without markers", () => {
  const raw = [
    "{\"type\":\"thread.started\"}",
    "{\"type\":\"item.completed\",\"item\":{\"id\":\"item_2\",\"type\":\"agent_message\",\"text\":\"{\\\"tool_calls\\\":[{\\\"id\\\":\\\"call_9\\\",\\\"name\\\":\\\"request_file\\\",\\\"arguments\\\":{\\\"prompt\\\":\\\"업로드\\\"}}]}\"}}",
    "{\"type\":\"turn.completed\"}",
  ].join("\n");

  const calls = __cli_provider_test__.parse_tool_calls_from_output(raw);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "request_file");
  assert.equal(String(calls[0].arguments.prompt), "업로드");
});

