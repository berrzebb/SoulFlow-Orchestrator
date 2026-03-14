/**
 * E1: ToolOutputReducer 테스트.
 *
 * - detect_output_kind: 7가지 kind 정확 감지 + fallback
 * - reduce: kind별 3-projection (prompt/display/storage) 검증
 * - is_error 패스스루
 * - 경계값: 빈 입력, max_chars 이하, max_chars 초과
 * - JSON 파싱 실패 → plain fallback
 * - meta.truncated 정확성
 */

import { describe, it, expect } from "vitest";
import {
  create_tool_output_reducer,
  detect_output_kind,
  truncate_half,
} from "@src/orchestration/tool-output-reducer.js";

// ── detect_output_kind ────────────────────────────────────────────

describe("detect_output_kind", () => {
  it("JSON 객체 → 'json'", () => {
    expect(detect_output_kind("tool", '{"key": "value", "count": 42}')).toBe("json");
  });

  it("JSON 배열 → 'json'", () => {
    expect(detect_output_kind("tool", '["a","b","c"]')).toBe("json");
  });

  it("잘못된 JSON → 'json' 아님 (다른 kind 또는 plain)", () => {
    // 파싱 불가 → json 아님
    const kind = detect_output_kind("tool", '{"broken": ');
    expect(kind).not.toBe("json");
  });

  it("diff 마커 → 'diff'", () => {
    const diff = "diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,3 @@";
    expect(detect_output_kind("tool", diff)).toBe("diff");
  });

  it("도구명 vitest → 'test'", () => {
    expect(detect_output_kind("vitest", "some output")).toBe("test");
  });

  it("PASS/FAIL 패턴 → 'test'", () => {
    expect(detect_output_kind("tool", "✓ 10 tests passing\n✗ 2 tests failing")).toBe("test");
  });

  it("[INFO] 마커 → 'log'", () => {
    expect(detect_output_kind("tool", "[INFO] server started\n[WARN] low memory\n[ERROR] disk full")).toBe("log");
  });

  it("타임스탬프 패턴 → 'log'", () => {
    expect(detect_output_kind("tool", "2024-01-01 12:00:00 startup complete")).toBe("log");
  });

  it("pipe-delimited 테이블 (2행 이상) → 'table'", () => {
    const table = "| Name | Value |\n|------|-------|\n| foo  | 1     |\n| bar  | 2     |";
    expect(detect_output_kind("tool", table)).toBe("table");
  });

  it("pipe 행 1개만 → 'table' 아님", () => {
    expect(detect_output_kind("tool", "| only one row |")).not.toBe("table");
  });

  it("도구명 bash → 'shell'", () => {
    expect(detect_output_kind("bash", "some output")).toBe("shell");
  });

  it("'Error:' 시작 → 'shell'", () => {
    expect(detect_output_kind("tool", "Error: command not found")).toBe("shell");
  });

  it("일반 텍스트 → 'plain'", () => {
    expect(detect_output_kind("tool", "hello world")).toBe("plain");
  });

  it("빈 문자열 → 'plain'", () => {
    expect(detect_output_kind("tool", "")).toBe("plain");
  });
});

// ── create_tool_output_reducer ────────────────────────────────────

describe("ToolOutputReducer — is_error 패스스루", () => {
  const reducer = create_tool_output_reducer(100);

  it("is_error=true → 3 projections 모두 raw와 동일", () => {
    const longErr = "E".repeat(500);
    const r = reducer.reduce({ tool_name: "t", params: {}, result_text: longErr, is_error: true });
    expect(r.prompt_text).toBe(longErr);
    expect(r.display_text).toBe(longErr);
    expect(r.storage_text).toBe(longErr);
    expect(r.meta.truncated).toBe(false);
  });
});

describe("ToolOutputReducer — 경계값", () => {
  const reducer = create_tool_output_reducer(200);

  it("빈 문자열 → 빈 projections", () => {
    const r = reducer.reduce({ tool_name: "t", params: {}, result_text: "", is_error: false });
    expect(r.prompt_text).toBe("");
    expect(r.meta.truncated).toBe(false);
  });

  it("max 이하 → truncated=false, prompt_text === raw", () => {
    const short = "hello world";
    const r = reducer.reduce({ tool_name: "t", params: {}, result_text: short, is_error: false });
    expect(r.prompt_text).toBe(short);
    expect(r.meta.truncated).toBe(false);
  });

  it("max 초과 → truncated=true, prompt_text 길이 < raw 길이", () => {
    const long = "x".repeat(300);
    const r = reducer.reduce({ tool_name: "t", params: {}, result_text: long, is_error: false });
    expect(r.meta.truncated).toBe(true);
    expect(r.prompt_text.length).toBeLessThan(long.length);
  });

  it("prompt_text ≤ display_text ≤ raw 길이 (크기 순서 보장)", () => {
    const long = "line content\n".repeat(50);
    const r = reducer.reduce({ tool_name: "t", params: {}, result_text: long, is_error: false });
    expect(r.prompt_text.length).toBeLessThanOrEqual(r.display_text.length);
    expect(r.display_text.length).toBeLessThanOrEqual(long.length);
  });
});

describe("ToolOutputReducer — meta 필드", () => {
  const reducer = create_tool_output_reducer(200);

  it("meta.raw_chars = raw_text.length", () => {
    const text = "hello\nworld";
    const r = reducer.reduce({ tool_name: "t", params: {}, result_text: text, is_error: false });
    expect(r.meta.raw_chars).toBe(text.length);
  });

  it("meta.raw_lines = 줄 수", () => {
    const text = "a\nb\nc";
    const r = reducer.reduce({ tool_name: "t", params: {}, result_text: text, is_error: false });
    expect(r.meta.raw_lines).toBe(3);
  });
});

// ── Kind별 reduction ──────────────────────────────────────────────

describe("ToolOutputReducer — json kind", () => {
  const reducer = create_tool_output_reducer(200);

  it("JSON 객체 → kind='json', prompt에 key summary 포함", () => {
    const r = reducer.reduce({
      tool_name: "tool",
      params: {},
      result_text: '{"name":"Alice","age":30,"city":"Seoul"}',
      is_error: false,
    });
    expect(r.kind).toBe("json");
    expect(r.prompt_text).toContain("{3 keys}");
    expect(r.prompt_text).toContain('"name"');
  });

  it("파싱 불가 JSON → kind='plain'으로 fallback", () => {
    const r = reducer.reduce({
      tool_name: "tool",
      params: {},
      result_text: '{"broken":',
      is_error: false,
    });
    expect(r.kind).toBe("plain");
  });
});

describe("ToolOutputReducer — diff kind", () => {
  const reducer = create_tool_output_reducer(200);

  it("diff → prompt에 +/- 통계 포함", () => {
    const diff = [
      "diff --git a/src/foo.ts b/src/foo.ts",
      "--- a/src/foo.ts",
      "+++ b/src/foo.ts",
      "@@ -1,5 +1,7 @@",
      "-old line 1",
      "-old line 2",
      "+new line 1",
      "+new line 2",
      "+new line 3",
    ].join("\n");
    const r = reducer.reduce({ tool_name: "tool", params: {}, result_text: diff, is_error: false });
    expect(r.kind).toBe("diff");
    expect(r.prompt_text).toMatch(/\+\d+\s+-\d+/); // +N -M 형식
  });
});

describe("ToolOutputReducer — test kind", () => {
  const reducer = create_tool_output_reducer(300);

  it("test runner 출력 → kind='test', 실패 라인 포함", () => {
    const output = [
      "✓ test A passed",
      "✗ test B failed: expected 1 to be 2",
      "3 tests passing, 1 failing",
    ].join("\n");
    const r = reducer.reduce({ tool_name: "vitest", params: {}, result_text: output, is_error: false });
    expect(r.kind).toBe("test");
    expect(r.prompt_text).toContain("1 failing");
  });
});

describe("ToolOutputReducer — log kind", () => {
  const reducer = create_tool_output_reducer(200);

  it("로그 출력 → kind='log', ERROR 라인 포함", () => {
    const log = [
      "[INFO] Service started",
      "[DEBUG] Connecting to DB",
      "[ERROR] Connection refused",
      "[INFO] Retrying...",
    ].join("\n");
    const r = reducer.reduce({ tool_name: "tool", params: {}, result_text: log, is_error: false });
    expect(r.kind).toBe("log");
    expect(r.prompt_text).toMatch(/ERROR/i);
  });
});

describe("ToolOutputReducer — table kind", () => {
  const reducer = create_tool_output_reducer(200);

  it("테이블 출력 → kind='table', 행 수 포함", () => {
    const table = [
      "| Name  | Score |",
      "|-------|-------|",
      "| Alice | 95    |",
      "| Bob   | 87    |",
      "| Carol | 92    |",
    ].join("\n");
    const r = reducer.reduce({ tool_name: "tool", params: {}, result_text: table, is_error: false });
    expect(r.kind).toBe("table");
    expect(r.prompt_text).toContain("rows");
  });
});

describe("ToolOutputReducer — shell kind", () => {
  const reducer = create_tool_output_reducer(200);

  it("shell 에러 출력 → kind='shell', 에러 라인 포함", () => {
    const output = [
      "$ npm install",
      "npm warn deprecated package@1.0.0",
      "Error: EACCES permission denied",
      "npm ERR! code EACCES",
    ].join("\n");
    const r = reducer.reduce({ tool_name: "bash", params: {}, result_text: output, is_error: false });
    expect(r.kind).toBe("shell");
    expect(r.prompt_text).toContain("EACCES");
  });
});

// ── truncate_half ─────────────────────────────────────────────────

describe("truncate_half", () => {
  it("max 이하 → 원본 반환", () => {
    expect(truncate_half("hello", 100)).toBe("hello");
  });

  it("max 초과 → [truncated N chars] 표시 포함", () => {
    const long = "a".repeat(200);
    const result = truncate_half(long, 100);
    expect(result).toContain("[truncated");
    expect(result.length).toBeLessThan(long.length);
  });

  it("max < 100 → 최소 100으로 보정", () => {
    const text = "x".repeat(150);
    const result = truncate_half(text, 50);
    // 실제 limit이 100으로 보정됨 → 150 > 100이므로 truncate 발생
    expect(result.length).toBeLessThan(text.length);
  });
});
