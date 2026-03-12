import { describe, it, expect } from "vitest";
import {
  strip_leading_mentions_and_aliases,
  normalize_common_command_text,
  parse_memory_quick_action,
  parse_decision_quick_action,
  parse_decision_set_pair,
  parse_status_quick_action,
  extract_memory_search_query,
  extract_decision_set_pair,
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

// ══════════════════════════════════════════
// parse_memory_quick_action — 명령어 이름 기반
// ══════════════════════════════════════════

describe("parse_memory_quick_action — 명령어 이름 기반 분기", () => {
  it("memory-status → 'status'", () => {
    expect(parse_memory_quick_action("", cmd("memory-status"))).toBe("status");
  });

  it("memory_status → 'status'", () => {
    expect(parse_memory_quick_action("", cmd("memory_status"))).toBe("status");
  });

  it("memory-list → 'list'", () => {
    expect(parse_memory_quick_action("", cmd("memory-list"))).toBe("list");
  });

  it("memory_list → 'list'", () => {
    expect(parse_memory_quick_action("", cmd("memory_list"))).toBe("list");
  });

  it("memory-longterm → 'longterm'", () => {
    expect(parse_memory_quick_action("", cmd("memory-longterm"))).toBe("longterm");
  });

  it("memory-search → 'search'", () => {
    expect(parse_memory_quick_action("", cmd("memory-search"))).toBe("search");
  });

  it("메모리검색 (한글 명령) → 'search'", () => {
    expect(parse_memory_quick_action("", cmd("메모리검색"))).toBe("search");
  });

  it("메모리장기 → 'longterm'", () => {
    expect(parse_memory_quick_action("", cmd("메모리장기"))).toBe("longterm");
  });
});

// ══════════════════════════════════════════
// parse_memory_quick_action — memory root + arg
// ══════════════════════════════════════════

describe("parse_memory_quick_action — root 명령 + arg 분기", () => {
  it("/memory status → 'status'", () => {
    expect(parse_memory_quick_action("", cmd("memory", "status"))).toBe("status");
  });

  it("/memory today → 'today'", () => {
    expect(parse_memory_quick_action("", cmd("memory", "today"))).toBe("today");
  });

  it("/memory 오늘 → 'today'", () => {
    expect(parse_memory_quick_action("", cmd("memory", "오늘"))).toBe("today");
  });

  it("/memory lt → 'longterm'", () => {
    expect(parse_memory_quick_action("", cmd("memory", "lt"))).toBe("longterm");
  });

  it("/memory find → 'search'", () => {
    expect(parse_memory_quick_action("", cmd("memory", "find"))).toBe("search");
  });

  it("/memory (인자 없음) → 'status'", () => {
    expect(parse_memory_quick_action("", cmd("memory"))).toBe("status");
  });
});

// ══════════════════════════════════════════
// parse_memory_quick_action — 자연어 텍스트
// ══════════════════════════════════════════

describe("parse_memory_quick_action — 자연어 텍스트", () => {
  it("'메모리 목록' → 'list'", () => {
    expect(parse_memory_quick_action("메모리 목록", null)).toBe("list");
  });

  it("'memory list' → 'list'", () => {
    expect(parse_memory_quick_action("memory list", null)).toBe("list");
  });

  it("'오늘 메모리' → 'today'", () => {
    expect(parse_memory_quick_action("오늘 메모리", null)).toBe("today");
  });

  it("'memory today' → 'today'", () => {
    expect(parse_memory_quick_action("memory today", null)).toBe("today");
  });

  it("'장기 메모리' → 'longterm'", () => {
    expect(parse_memory_quick_action("장기 메모리", null)).toBe("longterm");
  });

  it("'memory longterm' → 'longterm'", () => {
    expect(parse_memory_quick_action("memory longterm", null)).toBe("longterm");
  });

  it("'/other' 슬래시 시작 → null", () => {
    expect(parse_memory_quick_action("/other", cmd("other"))).toBeNull();
  });
});

// ══════════════════════════════════════════
// parse_decision_quick_action — 명령어 이름 기반
// ══════════════════════════════════════════

describe("parse_decision_quick_action — 명령어 이름 기반", () => {
  it("decision-status → 'status'", () => {
    expect(parse_decision_quick_action("", cmd("decision-status"))).toBe("status");
  });

  it("decision_status → 'status'", () => {
    expect(parse_decision_quick_action("", cmd("decision_status"))).toBe("status");
  });

  it("정책상태 → 'status'", () => {
    expect(parse_decision_quick_action("", cmd("정책상태"))).toBe("status");
  });

  it("decision-list → 'list'", () => {
    expect(parse_decision_quick_action("", cmd("decision-list"))).toBe("list");
  });

  it("decision_list → 'list'", () => {
    expect(parse_decision_quick_action("", cmd("decision_list"))).toBe("list");
  });

  it("정책목록 → 'list'", () => {
    expect(parse_decision_quick_action("", cmd("정책목록"))).toBe("list");
  });

  it("decision-set → 'set'", () => {
    expect(parse_decision_quick_action("", cmd("decision-set"))).toBe("set");
  });

  it("정책수정 → 'set'", () => {
    expect(parse_decision_quick_action("", cmd("정책수정"))).toBe("set");
  });
});

// ══════════════════════════════════════════
// parse_decision_quick_action — root + arg 분기
// ══════════════════════════════════════════

describe("parse_decision_quick_action — root + arg 분기", () => {
  it("/decision status → 'status'", () => {
    expect(parse_decision_quick_action("", cmd("decision", "status"))).toBe("status");
  });

  it("/decision show → 'list'", () => {
    expect(parse_decision_quick_action("", cmd("decision", "show"))).toBe("list");
  });

  it("/decision update → 'set'", () => {
    expect(parse_decision_quick_action("", cmd("decision", "update"))).toBe("set");
  });
});

// ══════════════════════════════════════════
// parse_decision_quick_action — 자연어 텍스트
// ══════════════════════════════════════════

describe("parse_decision_quick_action — 자연어 텍스트", () => {
  it("'현재 지침?' → 'status'", () => {
    expect(parse_decision_quick_action("현재 지침?", null)).toBe("status");
  });

  it("'결정 사항 목록' → 'list'", () => {
    expect(parse_decision_quick_action("결정 사항 목록", null)).toBe("list");
  });

  it("'decision status' → 'list'", () => {
    expect(parse_decision_quick_action("decision status", null)).toBe("list");
  });

  it("'policy list' → 'list'", () => {
    expect(parse_decision_quick_action("policy list", null)).toBe("list");
  });

  it("'지침 수정' → 'set'", () => {
    expect(parse_decision_quick_action("지침 수정", null)).toBe("set");
  });

  it("'policy set key val' → 'set'", () => {
    expect(parse_decision_quick_action("policy set key val", null)).toBe("set");
  });

  it("'/other' 슬래시 시작 → null", () => {
    expect(parse_decision_quick_action("/other", cmd("other"))).toBeNull();
  });
});

// ══════════════════════════════════════════
// extract_decision_set_pair — slash 명령어 기반
// ══════════════════════════════════════════

describe("extract_decision_set_pair — slash 명령 기반", () => {
  it("/decision-set key=value → {key, value}", () => {
    const r = extract_decision_set_pair("", cmd("decision-set", "key=value"));
    expect(r).toEqual({ key: "key", value: "value" });
  });

  it("/decision set key value → {key, value}", () => {
    const r = extract_decision_set_pair("", cmd("decision", "set", "my_key", "my_value"));
    expect(r).toEqual({ key: "my_key", value: "my_value" });
  });

  it("/정책수정 키:값 → {key, value}", () => {
    const r = extract_decision_set_pair("", cmd("정책수정", "키:값"));
    expect(r).toEqual({ key: "키", value: "값" });
  });
});

// ══════════════════════════════════════════
// extract_decision_set_pair — 자연어 텍스트
// ══════════════════════════════════════════

describe("extract_decision_set_pair — 자연어 텍스트", () => {
  it("'지침 수정: key=value' → {key, value}", () => {
    const r = extract_decision_set_pair("지침 수정: key=value", null);
    expect(r?.key).toBe("key");
    expect(r?.value).toBe("value");
  });

  it("'정책 업데이트 key val' → {key, value}", () => {
    const r = extract_decision_set_pair("정책 업데이트 key val", null);
    expect(r).not.toBeNull();
  });

  it("'decision set key=value' → {key, value}", () => {
    const r = extract_decision_set_pair("decision set key=value", null);
    expect(r?.key).toBe("key");
  });

  it("일치 없음 → null", () => {
    const r = extract_decision_set_pair("hello world", null);
    expect(r).toBeNull();
  });
});

// ══════════════════════════════════════════
// parse_status_quick_action — 텍스트 기반 skills
// ══════════════════════════════════════════

describe("parse_status_quick_action — 텍스트 기반 skills", () => {
  it("'스킬' → 'skills'", () => {
    expect(parse_status_quick_action("스킬", null)).toBe("skills");
  });

  it("'skill' → 'skills'", () => {
    expect(parse_status_quick_action("skill", null)).toBe("skills");
  });

  it("'기능' → 'skills'", () => {
    expect(parse_status_quick_action("기능", null)).toBe("skills");
  });

  it("'능력' → 'skills'", () => {
    expect(parse_status_quick_action("능력", null)).toBe("skills");
  });

  it("빈 텍스트, null 명령 → null", () => {
    expect(parse_status_quick_action("", null)).toBeNull();
  });

  it("도구/스킬 무관 텍스트, null 명령 → null", () => {
    expect(parse_status_quick_action("hello world", null)).toBeNull();
  });
});

// ══════════════════════════════════════════
// strip_leading_mentions_and_aliases — 추가 케이스
// ══════════════════════════════════════════

describe("strip_leading_mentions_and_aliases — 추가 케이스", () => {
  it("sebastian alias 제거", () => {
    expect(strip_leading_mentions_and_aliases("sebastian 안녕")).toBe("안녕");
  });

  it("bot alias 제거", () => {
    expect(strip_leading_mentions_and_aliases("bot: 안녕")).toBe("안녕");
  });

  it("<@!12345> (! 포함) Discord mention 제거", () => {
    expect(strip_leading_mentions_and_aliases("<@!12345> 안녕")).toBe("안녕");
  });

  it("오케스트레이터 제거", () => {
    expect(strip_leading_mentions_and_aliases("오케스트레이터 안녕")).toBe("안녕");
  });
});

// ══════════════════════════════════════════
// parse_decision_set_pair — value 공백 → null
// ══════════════════════════════════════════

describe("parse_decision_set_pair — value 공백 → null", () => {
  it("'key: ' (콜론 뒤 공백) → null", () => {
    expect(parse_decision_set_pair("key: ")).toBeNull();
  });

  it("'mykey= ' (등호 뒤 공백) → null", () => {
    expect(parse_decision_set_pair("mykey= ")).toBeNull();
  });
});
