import { describe, it, expect } from "vitest";
import {
  today_key,
  prune_ttl_map,
  escape_regexp,
  escape_html,
  ensure_json_object,
  safe_stringify,
  error_message,
  normalize_text,
  short_id,
  parse_bool_like,
} from "@src/utils/common.js";

describe("today_key", () => {
  it("YYYY-MM-DD 형식 반환", () => {
    const result = today_key(new Date(2025, 0, 5));
    expect(result).toBe("2025-01-05");
  });

  it("월/일 한 자리 → 0 패딩", () => {
    const result = today_key(new Date(2025, 2, 3));
    expect(result).toBe("2025-03-03");
  });

  it("12월 → 12", () => {
    const result = today_key(new Date(2025, 11, 25));
    expect(result).toBe("2025-12-25");
  });
});

describe("prune_ttl_map", () => {
  it("TTL 만료된 항목 제거", () => {
    const map = new Map<string, { ts: number }>([
      ["old", { ts: Date.now() - 60_000 }],
      ["new", { ts: Date.now() }],
    ]);
    prune_ttl_map(map, (v) => v.ts, 30_000, 100);
    expect(map.has("old")).toBe(false);
    expect(map.has("new")).toBe(true);
  });

  it("max_size 초과 시 오래된 항목 제거 (삽입 순서)", () => {
    const now = Date.now();
    const map = new Map<string, { ts: number }>([
      ["a", { ts: now }],
      ["b", { ts: now }],
      ["c", { ts: now }],
    ]);
    prune_ttl_map(map, (v) => v.ts, 999_999, 2);
    expect(map.size).toBe(2);
    expect(map.has("a")).toBe(false);
  });

  it("빈 맵 → 무동작", () => {
    const map = new Map<string, { ts: number }>();
    prune_ttl_map(map, (v) => v.ts, 1000, 10);
    expect(map.size).toBe(0);
  });
});

describe("escape_regexp", () => {
  it("특수문자 이스케이프", () => {
    expect(escape_regexp("a.b*c")).toBe("a\\.b\\*c");
  });

  it("모든 메타문자 이스케이프", () => {
    expect(escape_regexp("$^+?{}()|[]\\")).toBe("\\$\\^\\+\\?\\{\\}\\(\\)\\|\\[\\]\\\\");
  });

  it("일반 문자 유지", () => {
    expect(escape_regexp("hello")).toBe("hello");
  });

  it("빈 문자열", () => {
    expect(escape_regexp("")).toBe("");
  });
});

describe("escape_html", () => {
  it("& < > \" 이스케이프", () => {
    expect(escape_html('a & b < c > d "e"')).toBe("a &amp; b &lt; c &gt; d &quot;e&quot;");
  });

  it("일반 텍스트 유지", () => {
    expect(escape_html("hello world")).toBe("hello world");
  });

  it("빈/null 입력", () => {
    expect(escape_html("")).toBe("");
  });
});

describe("ensure_json_object", () => {
  it("객체 → 그대로 반환", () => {
    const obj = { a: 1 };
    expect(ensure_json_object(obj)).toBe(obj);
  });

  it("배열 → null", () => {
    expect(ensure_json_object([1, 2])).toBeNull();
  });

  it("null → null", () => {
    expect(ensure_json_object(null)).toBeNull();
  });

  it("프리미티브 → null", () => {
    expect(ensure_json_object("string")).toBeNull();
    expect(ensure_json_object(42)).toBeNull();
    expect(ensure_json_object(true)).toBeNull();
  });
});

describe("safe_stringify", () => {
  it("문자열 → 그대로", () => {
    expect(safe_stringify("hello")).toBe("hello");
  });

  it("null/undefined → 빈 문자열", () => {
    expect(safe_stringify(null)).toBe("");
    expect(safe_stringify(undefined)).toBe("");
  });

  it("객체 → JSON 포맷", () => {
    expect(safe_stringify({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it("순환 참조 → String() 폴백", () => {
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    const result = safe_stringify(obj);
    expect(typeof result).toBe("string");
  });
});

describe("error_message", () => {
  it("Error → message 추출", () => {
    expect(error_message(new Error("fail"))).toBe("fail");
  });

  it("문자열 → 그대로", () => {
    expect(error_message("oops")).toBe("oops");
  });

  it("숫자 → 문자열 변환", () => {
    expect(error_message(42)).toBe("42");
  });
});

describe("normalize_text", () => {
  it("연속 공백 → 단일 공백", () => {
    expect(normalize_text("hello   world")).toBe("hello world");
  });

  it("앞뒤 공백 제거", () => {
    expect(normalize_text("  hello  ")).toBe("hello");
  });

  it("lowercase 옵션", () => {
    expect(normalize_text("Hello World", true)).toBe("hello world");
  });

  it("탭/개행 정규화", () => {
    expect(normalize_text("a\n\tb")).toBe("a b");
  });

  it("빈/null 입력", () => {
    expect(normalize_text("")).toBe("");
    expect(normalize_text(null)).toBe("");
  });
});

describe("short_id", () => {
  it("기본 길이 12", () => {
    expect(short_id()).toHaveLength(12);
  });

  it("길이 8 지정", () => {
    expect(short_id(8)).toHaveLength(8);
  });

  it("UUID 문자만 포함", () => {
    expect(short_id()).toMatch(/^[a-f0-9-]+$/);
  });
});

describe("parse_bool_like", () => {
  it("true 변형", () => {
    expect(parse_bool_like("1", false)).toBe(true);
    expect(parse_bool_like("true", false)).toBe(true);
    expect(parse_bool_like("yes", false)).toBe(true);
    expect(parse_bool_like("on", false)).toBe(true);
  });

  it("false 변형", () => {
    expect(parse_bool_like("0", true)).toBe(false);
    expect(parse_bool_like("false", true)).toBe(false);
    expect(parse_bool_like("no", true)).toBe(false);
    expect(parse_bool_like("off", true)).toBe(false);
  });

  it("대소문자 무시", () => {
    expect(parse_bool_like("TRUE", false)).toBe(true);
    expect(parse_bool_like("False", true)).toBe(false);
  });

  it("빈/미인식 → fallback", () => {
    expect(parse_bool_like("", true)).toBe(true);
    expect(parse_bool_like(undefined, false)).toBe(false);
    expect(parse_bool_like("maybe", true)).toBe(true);
  });
});
