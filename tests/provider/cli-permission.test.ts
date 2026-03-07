import { describe, it, expect } from "vitest";
import {
  split_args,
  strip_surrounding_quotes,
  split_command_with_embedded_args,
  strip_approval_flags,
  is_codex_command,
  is_claude_command,
  is_gemini_command,
} from "@src/providers/cli-permission.js";

describe("split_args", () => {
  it("공백으로 분할", () => {
    expect(split_args("a b c")).toEqual(["a", "b", "c"]);
  });

  it("연속 공백 처리", () => {
    expect(split_args("a   b")).toEqual(["a", "b"]);
  });

  it("빈 문자열 → 빈 배열", () => {
    expect(split_args("")).toEqual([]);
  });

  it("앞뒤 공백 무시", () => {
    expect(split_args("  hello  ")).toEqual(["hello"]);
  });
});

describe("strip_surrounding_quotes", () => {
  it("큰따옴표 제거", () => {
    expect(strip_surrounding_quotes('"hello"')).toBe("hello");
  });

  it("작은따옴표 제거", () => {
    expect(strip_surrounding_quotes("'hello'")).toBe("hello");
  });

  it("따옴표 없으면 그대로", () => {
    expect(strip_surrounding_quotes("hello")).toBe("hello");
  });

  it("불완전 따옴표 유지", () => {
    expect(strip_surrounding_quotes('"hello')).toBe('"hello');
  });

  it("빈 문자열", () => {
    expect(strip_surrounding_quotes("")).toBe("");
  });
});

describe("split_command_with_embedded_args", () => {
  it("기본 분할", () => {
    const result = split_command_with_embedded_args("codex --flag value");
    expect(result.command).toBe("codex");
    expect(result.args).toEqual(["--flag", "value"]);
  });

  it("따옴표 감싼 커맨드", () => {
    const result = split_command_with_embedded_args('"C:\\Program Files\\codex.exe" arg1');
    expect(result.command).toBe("C:\\Program Files\\codex.exe");
    expect(result.args).toEqual(["arg1"]);
  });

  it("빈 입력", () => {
    const result = split_command_with_embedded_args("");
    expect(result.command).toBe("");
    expect(result.args).toEqual([]);
  });

  it("커맨드만 (인자 없음)", () => {
    const result = split_command_with_embedded_args("codex");
    expect(result.command).toBe("codex");
    expect(result.args).toEqual([]);
  });
});

describe("strip_approval_flags", () => {
  it("--ask-for-approval= 형태 제거", () => {
    const result = strip_approval_flags(["--ask-for-approval=auto", "arg1"]);
    expect(result).toEqual(["arg1"]);
  });

  it("-a 플래그 + 값 제거", () => {
    const result = strip_approval_flags(["-a", "auto", "arg1"]);
    expect(result).toEqual(["arg1"]);
  });

  it("--ask-for-approval 플래그 + 값 제거", () => {
    const result = strip_approval_flags(["--ask-for-approval", "never", "arg1"]);
    expect(result).toEqual(["arg1"]);
  });

  it("-a 뒤에 다른 플래그 → 값 소비 안 함", () => {
    const result = strip_approval_flags(["-a", "--verbose", "arg1"]);
    expect(result).toEqual(["--verbose", "arg1"]);
  });

  it("관련 없는 플래그 유지", () => {
    const result = strip_approval_flags(["--verbose", "--output", "json"]);
    expect(result).toEqual(["--verbose", "--output", "json"]);
  });

  it("빈 배열", () => {
    expect(strip_approval_flags([])).toEqual([]);
  });
});

describe("is_codex_command", () => {
  it("codex → true", () => {
    expect(is_codex_command("codex")).toBe(true);
  });

  it("codex.exe → true", () => {
    expect(is_codex_command("codex.exe")).toBe(true);
  });

  it("절대 경로", () => {
    expect(is_codex_command("/usr/bin/codex")).toBe(true);
    expect(is_codex_command("C:\\tools\\codex.exe")).toBe(true);
  });

  it("따옴표 감싼 경로", () => {
    expect(is_codex_command('"C:\\Program Files\\codex.exe"')).toBe(true);
  });

  it("claude → false", () => {
    expect(is_codex_command("claude")).toBe(false);
  });
});

describe("is_claude_command", () => {
  it("claude → true", () => {
    expect(is_claude_command("claude")).toBe(true);
  });

  it("claude.cmd → true", () => {
    expect(is_claude_command("claude.cmd")).toBe(true);
  });

  it("codex → false", () => {
    expect(is_claude_command("codex")).toBe(false);
  });
});

describe("is_gemini_command", () => {
  it("gemini → true", () => {
    expect(is_gemini_command("gemini")).toBe(true);
  });

  it("gemini.exe → true", () => {
    expect(is_gemini_command("gemini.exe")).toBe(true);
  });

  it("claude → false", () => {
    expect(is_gemini_command("claude")).toBe(false);
  });
});
