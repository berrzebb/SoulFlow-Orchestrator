import { describe, it, expect } from "vitest";
import type { ParsedSlashCommand } from "@src/channels/slash-command.ts";
import {
  extract_decision_set_pair,
  extract_memory_search_query,
  normalize_common_command_text,
  parse_decision_quick_action,
  parse_memory_quick_action,
} from "@src/channels/command-intent.ts";

describe("channel command intent", () => {
  it("normalize_common_command_text strips leading mentions and aliases", () => {
    const normalized = normalize_common_command_text("@assistant   메모리   상태  확인");
    expect(normalized).toBe("메모리 상태 확인");
  });

  it("memory quick action parses slash forms", () => {
    expect(parse_memory_quick_action("메모리 상태", null)).toBe("status");
    const slash: ParsedSlashCommand = {
      raw: "/memory search 에러 로그",
      name: "memory",
      args: ["search", "에러", "로그"],
      args_lower: ["search", "에러", "로그"],
    };
    expect(parse_memory_quick_action("/memory search 에러 로그", slash)).toBe("search");
    expect(extract_memory_search_query("/memory search 에러 로그", slash)).toBe("에러 로그");

    const alias_status: ParsedSlashCommand = {
      raw: "/memory-status",
      name: "memory-status",
      args: [],
      args_lower: [],
    };
    expect(parse_memory_quick_action("/memory-status", alias_status)).toBe("status");

    const alias_search: ParsedSlashCommand = {
      raw: "/memory-search panic",
      name: "memory-search",
      args: ["panic"],
      args_lower: ["panic"],
    };
    expect(parse_memory_quick_action("/memory-search panic", alias_search)).toBe("search");
    expect(extract_memory_search_query("/memory-search panic", alias_search)).toBe("panic");
  });

  it("decision quick action and set pair parse slash forms", () => {
    const natural = extract_decision_set_pair("정책 수정 language=한국어 우선", null);
    expect(natural).toEqual({ key: "language", value: "한국어 우선" });

    const slash: ParsedSlashCommand = {
      raw: "/decision set locale ko-KR",
      name: "decision",
      args: ["set", "locale", "ko-KR"],
      args_lower: ["set", "locale", "ko-kr"],
    };
    const from_slash = extract_decision_set_pair("/decision set locale ko-KR", slash);
    expect(from_slash).toEqual({ key: "locale", value: "ko-KR" });

    const alias_set: ParsedSlashCommand = {
      raw: "/decision-set language 한국어 우선",
      name: "decision-set",
      args: ["language", "한국어", "우선"],
      args_lower: ["language", "한국어", "우선"],
    };
    expect(parse_decision_quick_action("/decision-set language 한국어 우선", alias_set)).toBe("set");
    expect(
      extract_decision_set_pair("/decision-set language 한국어 우선", alias_set),
    ).toEqual({ key: "language", value: "한국어 우선" });
  });
});
