import { describe, it, expect } from "vitest";
import { parse_tool_calls_from_text, parse_tool_calls_from_unknown } from "@src/agent/tool-call-parser.ts";

describe("tool call parser", () => {
  it("parses canonical tool_calls JSON", () => {
    const raw = JSON.stringify({
      tool_calls: [
        { id: "call_1", name: "list_dir", arguments: { path: ".", limit: 10 } },
      ],
    });
    const calls = parse_tool_calls_from_text(raw);
    expect(calls.length).toBe(1);
    expect(calls[0].name).toBe("list_dir");
    expect(String(calls[0].arguments.path)).toBe(".");
    expect(Number(calls[0].arguments.limit)).toBe(10);
  });

  it("parses OpenAI function-style payload", () => {
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
    expect(calls.length).toBe(1);
    expect(calls[0].name).toBe("request_file");
    expect(String(calls[0].arguments.prompt)).toBe("파일 업로드");
  });

  it("parses nested event objects", () => {
    const raw = {
      type: "item.completed",
      item: {
        type: "agent_message",
        payload: {
          tool_calls: [
            { id: "call_3", name: "cron", arguments: { action: "list" } },
          ],
        },
      },
    };
    const calls = parse_tool_calls_from_unknown(raw);
    expect(calls.length).toBe(1);
    expect(calls[0].name).toBe("cron");
  });

  it("ignores non-json text", () => {
    const calls = parse_tool_calls_from_text("결과 요약: tool_calls [1 items]");
    expect(calls.length).toBe(0);
  });

  it("extracts embedded tool_calls JSON from mixed text", () => {
    const raw = [
      "확인 중입니다.",
      '{"tool_calls":[{"id":"call_3","name":"message","arguments":{"phase":"done","content":"ok"}}]}',
      "}",
      "진행합니다.",
    ].join("\n");
    const calls = parse_tool_calls_from_text(raw);
    expect(calls.length).toBe(1);
    expect(calls[0].name).toBe("message");
    expect(String(calls[0].arguments.phase)).toBe("done");
  });
});
