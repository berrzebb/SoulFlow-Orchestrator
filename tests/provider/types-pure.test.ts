import { describe, it, expect } from "vitest";
import {
  sandbox_from_preset,
  parse_json_or_raw,
  parse_openai_response,
  sanitize_messages_for_api,
  LlmResponse,
} from "@src/providers/types.js";

describe("sandbox_from_preset", () => {
  it("strict → read-only, no network, always-ask", () => {
    const p = sandbox_from_preset("strict");
    expect(p.fs_access).toBe("read-only");
    expect(p.network_access).toBe(false);
    expect(p.approval).toBe("always-ask");
  });

  it("workspace-write → workspace-write, network, trusted-only", () => {
    const p = sandbox_from_preset("workspace-write");
    expect(p.fs_access).toBe("workspace-write");
    expect(p.network_access).toBe(true);
    expect(p.approval).toBe("trusted-only");
  });

  it("full-auto → full-access, network, auto-approve", () => {
    const p = sandbox_from_preset("full-auto");
    expect(p.fs_access).toBe("full-access");
    expect(p.network_access).toBe(true);
    expect(p.approval).toBe("auto-approve");
  });
});

describe("parse_json_or_raw", () => {
  it("returns object as-is", () => {
    const obj = { key: "value" };
    expect(parse_json_or_raw(obj)).toEqual(obj);
  });

  it("parses valid JSON string", () => {
    expect(parse_json_or_raw('{"a":1}')).toEqual({ a: 1 });
  });

  it("wraps invalid JSON string in { raw }", () => {
    expect(parse_json_or_raw("not json")).toEqual({ raw: "not json" });
  });

  it("returns {} for non-string/non-object", () => {
    expect(parse_json_or_raw(42)).toEqual({});
    expect(parse_json_or_raw(null)).toEqual({});
    expect(parse_json_or_raw(undefined)).toEqual({});
  });

  it("wraps JSON primitive in { raw }", () => {
    expect(parse_json_or_raw('"hello"')).toEqual({ raw: '"hello"' });
  });

  it("parses JSON array as object (falsy check)", () => {
    // JSON.parse("[1,2]") returns array, which is object → passes typeof check
    // but the function checks typeof parsed === "object" which is true for arrays
    const result = parse_json_or_raw("[1,2]");
    expect(result).toEqual([1, 2]);
  });
});

describe("parse_openai_response", () => {
  it("extracts content from standard OpenAI response", () => {
    const raw = {
      choices: [{ message: { content: "Hello world" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
    const result = parse_openai_response(raw);
    expect(result.content).toBe("Hello world");
    expect(result.finish_reason).toBe("stop");
    expect(result.tool_calls).toEqual([]);
    expect(result.usage.prompt_tokens).toBe(10);
    expect(result.usage.completion_tokens).toBe(5);
    expect(result.usage.total_tokens).toBe(15);
  });

  it("extracts tool_calls from response", () => {
    const raw = {
      choices: [{
        message: {
          content: null,
          tool_calls: [
            { id: "call_1", function: { name: "search", arguments: '{"q":"test"}' } },
          ],
        },
        finish_reason: "tool_calls",
      }],
    };
    const result = parse_openai_response(raw);
    expect(result.content).toBeNull();
    expect(result.tool_calls).toHaveLength(1);
    expect(result.tool_calls[0].id).toBe("call_1");
    expect(result.tool_calls[0].name).toBe("search");
    expect(result.tool_calls[0].arguments).toEqual({ q: "test" });
  });

  it("skips tool_calls missing id or name", () => {
    const raw = {
      choices: [{
        message: {
          tool_calls: [
            { id: "", function: { name: "search" } },
            { id: "call_2", function: { name: "" } },
            { id: "call_3", function: { name: "valid" } },
          ],
        },
      }],
    };
    const result = parse_openai_response(raw);
    expect(result.tool_calls).toHaveLength(1);
    expect(result.tool_calls[0].name).toBe("valid");
  });

  it("handles empty/missing choices gracefully", () => {
    expect(parse_openai_response({}).content).toBeNull();
    expect(parse_openai_response({ choices: [] }).content).toBeNull();
    expect(parse_openai_response({ choices: [] }).finish_reason).toBe("stop");
  });

  it("defaults usage to zeros", () => {
    const result = parse_openai_response({});
    expect(result.usage.prompt_tokens).toBe(0);
    expect(result.usage.completion_tokens).toBe(0);
    expect(result.usage.total_tokens).toBe(0);
  });
});

describe("sanitize_messages_for_api", () => {
  it("converts ChatMessage[] to plain objects", () => {
    const messages = [
      { role: "system" as const, content: "You are helpful" },
      { role: "user" as const, content: "Hi" },
    ];
    const result = sanitize_messages_for_api(messages);
    expect(result).toEqual([
      { role: "system", content: "You are helpful" },
      { role: "user", content: "Hi" },
    ]);
  });

  it("defaults content to empty string when undefined", () => {
    const result = sanitize_messages_for_api([{ role: "user" as const }]);
    expect(result[0].content).toBe("");
  });

  it("includes tool_calls when present", () => {
    const result = sanitize_messages_for_api([
      { role: "assistant" as const, content: "", tool_calls: [{ id: "1", function: { name: "test" } }] },
    ]);
    expect(result[0].tool_calls).toEqual([{ id: "1", function: { name: "test" } }]);
  });

  it("omits tool_calls when empty array", () => {
    const result = sanitize_messages_for_api([
      { role: "assistant" as const, content: "", tool_calls: [] },
    ]);
    expect(result[0].tool_calls).toBeUndefined();
  });

  it("includes tool_call_id and name when present", () => {
    const result = sanitize_messages_for_api([
      { role: "tool" as const, content: "result", tool_call_id: "call_1", name: "search" },
    ]);
    expect(result[0].tool_call_id).toBe("call_1");
    expect(result[0].name).toBe("search");
  });
});

describe("LlmResponse", () => {
  it("defaults to empty values", () => {
    const r = new LlmResponse({});
    expect(r.content).toBeNull();
    expect(r.tool_calls).toEqual([]);
    expect(r.finish_reason).toBe("stop");
    expect(r.usage).toEqual({});
    expect(r.reasoning_content).toBeNull();
    expect(r.metadata).toEqual({});
    expect(r.has_tool_calls).toBe(false);
  });

  it("has_tool_calls returns true when tool_calls present", () => {
    const r = new LlmResponse({
      tool_calls: [{ id: "1", name: "test", arguments: {} }],
    });
    expect(r.has_tool_calls).toBe(true);
  });
});
