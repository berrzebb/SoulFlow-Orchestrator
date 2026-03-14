/**
 * SO-3: OutputParserRegistry.
 *
 * 출력 파서 레지스트리 — 등록, 조회, 파싱, 빌트인 파서 검증.
 */
import { describe, it, expect } from "vitest";
import {
  register_output_parser,
  get_output_parser,
  parse_output,
  list_output_parsers,
  type OutputParser,
  type OutputFormat,
} from "@src/orchestration/output-parser-registry.js";

// ── Built-in Parsers ────────────────────────────────────────────

describe("built-in json parser", () => {
  it("valid JSON string → parsed object", () => {
    const result = parse_output("json", '{"key":"value"}');
    expect(result).toEqual({ key: "value" });
  });

  it("valid JSON array → parsed array", () => {
    const result = parse_output("json", '[1,2,3]');
    expect(result).toEqual([1, 2, 3]);
  });

  it("invalid JSON → null", () => {
    const result = parse_output("json", "not json");
    expect(result).toBeNull();
  });

  it("empty string → null", () => {
    const result = parse_output("json", "");
    expect(result).toBeNull();
  });

  it("JSON with surrounding whitespace → parsed", () => {
    const result = parse_output("json", '  \n {"a": 1} \n ');
    expect(result).toEqual({ a: 1 });
  });
});

describe("built-in tool_calls parser", () => {
  it("tool call JSON → ToolCallRequest[]", () => {
    const input = JSON.stringify({
      tool_calls: [{ id: "call_1", name: "web_search", arguments: { query: "test" } }],
    });
    const result = parse_output("tool_calls", input) as Array<{ name: string }>;
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("web_search");
  });

  it("no tool calls in text → empty array", () => {
    const result = parse_output("tool_calls", "just plain text");
    expect(result).toEqual([]);
  });
});

describe("built-in text parser", () => {
  it("returns trimmed string as-is", () => {
    const result = parse_output("text", "  hello world  ");
    expect(result).toBe("hello world");
  });

  it("empty string → empty string", () => {
    const result = parse_output("text", "");
    expect(result).toBe("");
  });
});

// ── Registry Operations ─────────────────────────────────────────

describe("registry operations", () => {
  it("get_output_parser — built-in json exists", () => {
    const parser = get_output_parser("json");
    expect(parser).toBeDefined();
    expect(parser!.format).toBe("json");
  });

  it("get_output_parser — unknown format → undefined", () => {
    expect(get_output_parser("nonexistent_format")).toBeUndefined();
  });

  it("list_output_parsers — includes all built-ins", () => {
    const formats = list_output_parsers();
    expect(formats).toContain("json");
    expect(formats).toContain("tool_calls");
    expect(formats).toContain("text");
  });

  it("parse_output — unknown format → null", () => {
    expect(parse_output("nonexistent_format", "data")).toBeNull();
  });

  it("register_output_parser — custom parser", () => {
    const csv_parser: OutputParser<string[][]> = {
      format: "csv" as OutputFormat,
      parse(raw: string) {
        if (!raw.trim()) return null;
        return raw.trim().split("\n").map((line) => line.split(","));
      },
    };
    register_output_parser(csv_parser);
    const result = parse_output("csv", "a,b\nc,d") as string[][];
    expect(result).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("register_output_parser — duplicate format throws", () => {
    const dup: OutputParser = {
      format: "json",
      parse: () => null,
    };
    expect(() => register_output_parser(dup)).toThrow("duplicate");
  });
});
