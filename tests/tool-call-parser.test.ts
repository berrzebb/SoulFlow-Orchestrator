import assert from "node:assert/strict";
import test from "node:test";
import { parse_tool_calls_from_text, parse_tool_calls_from_unknown } from "../src/agent/tool-call-parser.ts";

test("parse_tool_calls_from_text parses canonical tool_calls JSON", () => {
  const raw = JSON.stringify({
    tool_calls: [
      {
        id: "call_1",
        name: "list_dir",
        arguments: { path: ".", limit: 10 },
      },
    ],
  });
  const calls = parse_tool_calls_from_text(raw);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "list_dir");
  assert.equal(String(calls[0].arguments.path), ".");
  assert.equal(Number(calls[0].arguments.limit), 10);
});

test("parse_tool_calls_from_text parses OpenAI function-style payload", () => {
  const raw = JSON.stringify({
    tool_calls: [
      {
        id: "call_2",
        type: "function",
        function: {
          name: "request_file",
          arguments: "{\"prompt\":\"파일 업로드\",\"accept\":[\"pdf\"]}",
        },
      },
    ],
  });
  const calls = parse_tool_calls_from_text(raw);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "request_file");
  assert.equal(String(calls[0].arguments.prompt), "파일 업로드");
});

test("parse_tool_calls_from_unknown parses nested event objects", () => {
  const raw = {
    type: "item.completed",
    item: {
      type: "agent_message",
      payload: {
        tool_calls: [
          {
            id: "call_3",
            name: "cron",
            arguments: { action: "list" },
          },
        ],
      },
    },
  };
  const calls = parse_tool_calls_from_unknown(raw);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "cron");
});

test("parse_tool_calls_from_text ignores non-json text", () => {
  const calls = parse_tool_calls_from_text("결과 요약: tool_calls [1 items]");
  assert.equal(calls.length, 0);
});

