import { describe, it, expect } from "vitest";
import {
  strip_leading_mentions_and_aliases,
  normalize_common_command_text,
  parse_memory_quick_action,
  parse_decision_quick_action,
  parse_decision_set_pair,
  parse_status_quick_action,
  extract_memory_search_query,
} from "@src/channels/command-intent.js";
import type { ParsedSlashCommand } from "@src/channels/slash-command.js";

function cmd(name: string, ...args: string[]): ParsedSlashCommand {
  return {
    name,
    raw: `/${name} ${args.join(" ")}`,
    args,
    args_lower: args.map((a) => a.toLowerCase()),
    rest: args.join(" "),
  } as ParsedSlashCommand;
}

describe("strip_leading_mentions_and_aliases", () => {
  it("strips Discord mention", () => {
    expect(strip_leading_mentions_and_aliases("<@12345> hello")).toBe("hello");
  });

  it("strips @mention", () => {
    expect(strip_leading_mentions_and_aliases("@bot hello")).toBe("hello");
  });

  it("strips alias names", () => {
    expect(strip_leading_mentions_and_aliases("assistant: hello")).toBe("hello");
    expect(strip_leading_mentions_and_aliases("에이전트 hello")).toBe("hello");
  });

  it("strips multiple layers", () => {
    expect(strip_leading_mentions_and_aliases("<@123> @bot hello")).toBe("hello");
  });

  it("returns empty for empty input", () => {
    expect(strip_leading_mentions_and_aliases("")).toBe("");
  });
});

describe("normalize_common_command_text", () => {
  it("strips mentions then normalizes whitespace (preserves case)", () => {
    const result = normalize_common_command_text("<@bot>  HELLO  world ");
    expect(result).toBe("HELLO world");
  });
});

describe("parse_memory_quick_action", () => {
  it("returns status for /memory command", () => {
    expect(parse_memory_quick_action("/memory", cmd("memory"))).toBe("status");
  });

  it("returns list for /memory list", () => {
    expect(parse_memory_quick_action("/memory list", cmd("memory", "list"))).toBe("list");
  });

  it("returns today for /memory-today", () => {
    expect(parse_memory_quick_action("/memory-today", cmd("memory-today"))).toBe("today");
  });

  it("returns longterm for /memory longterm", () => {
    expect(parse_memory_quick_action("/memory longterm", cmd("memory", "longterm"))).toBe("longterm");
  });

  it("returns search for /memory search", () => {
    expect(parse_memory_quick_action("/memory search", cmd("memory", "search"))).toBe("search");
  });

  it("returns status for Korean '메모리'", () => {
    expect(parse_memory_quick_action("메모리", null)).toBe("status");
  });

  it("returns search for Korean '메모리 검색 키워드'", () => {
    expect(parse_memory_quick_action("메모리 검색 test", null)).toBe("search");
  });

  it("returns null for unrelated text", () => {
    expect(parse_memory_quick_action("hello world", null)).toBeNull();
  });

  it("returns null for slash commands", () => {
    expect(parse_memory_quick_action("/other", cmd("other"))).toBeNull();
  });
});

describe("parse_decision_quick_action", () => {
  it("returns status for /decision", () => {
    expect(parse_decision_quick_action("/decision", cmd("decision"))).toBe("status");
  });

  it("returns list for /decision list", () => {
    expect(parse_decision_quick_action("/decision list", cmd("decision", "list"))).toBe("list");
  });

  it("returns set for /decision set", () => {
    expect(parse_decision_quick_action("/decision set", cmd("decision", "set"))).toBe("set");
  });

  it("returns status for Korean '정책'", () => {
    expect(parse_decision_quick_action("정책", null)).toBe("status");
  });

  it("returns null for unrelated text", () => {
    expect(parse_decision_quick_action("hello", null)).toBeNull();
  });
});

describe("parse_status_quick_action", () => {
  it("returns overview for /status", () => {
    expect(parse_status_quick_action("/status", cmd("status"))).toBe("overview");
  });

  it("returns tools for /tools", () => {
    expect(parse_status_quick_action("/tools", cmd("tools"))).toBe("tools");
  });

  it("returns skills for /skills", () => {
    expect(parse_status_quick_action("/skills", cmd("skills"))).toBe("skills");
  });

  it("returns tools for Korean '도구'", () => {
    expect(parse_status_quick_action("도구", null)).toBe("tools");
  });
});

describe("parse_decision_set_pair", () => {
  it("parses key=value", () => {
    expect(parse_decision_set_pair("name=Alice")).toEqual({ key: "name", value: "Alice" });
  });

  it("parses key:value", () => {
    expect(parse_decision_set_pair("role: admin")).toEqual({ key: "role", value: "admin" });
  });

  it("parses space-separated key value", () => {
    expect(parse_decision_set_pair("name Alice")).toEqual({ key: "name", value: "Alice" });
  });

  it("parses multi-word value", () => {
    expect(parse_decision_set_pair("greeting hello world")).toEqual({ key: "greeting", value: "hello world" });
  });

  it("returns null for empty input", () => {
    expect(parse_decision_set_pair("")).toBeNull();
  });

  it("returns null for single word", () => {
    expect(parse_decision_set_pair("alone")).toBeNull();
  });
});

describe("extract_memory_search_query", () => {
  it("extracts query from /memory-search keyword", () => {
    const result = extract_memory_search_query("/memory-search foo bar", cmd("memory-search", "foo", "bar"));
    expect(result).toBe("foo bar");
  });

  it("extracts query from /memory search keyword", () => {
    const result = extract_memory_search_query("/memory search foo", cmd("memory", "search", "foo"));
    expect(result).toBe("foo");
  });

  it("extracts query from natural language", () => {
    const result = extract_memory_search_query("메모리 검색 테스트", null);
    expect(result).toBe("테스트");
  });

  it("returns empty for non-matching text", () => {
    expect(extract_memory_search_query("hello", null)).toBe("");
  });
});
