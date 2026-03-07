import { describe, it, expect } from "vitest";
import {
  format_secret_notice,
  format_tool_label,
  format_tool_result_brief,
  format_tool_block,
  format_active_task_summary,
  build_active_task_context,
  build_classifier_capabilities,
  STATUS_EMOJI,
} from "@src/orchestration/prompts.js";

// ── format_secret_notice ──

describe("format_secret_notice", () => {
  it("missing keys + invalid ciphertexts 모두 포함", () => {
    const result = format_secret_notice({ missing_keys: ["API_KEY", "TOKEN"], invalid_ciphertexts: ["sv1.bad"] });
    expect(result).toContain("API_KEY, TOKEN");
    expect(result).toContain("sv1.bad");
    expect(result).toContain("secret_resolution_required");
  });

  it("missing keys만 있을 때", () => {
    const result = format_secret_notice({ missing_keys: ["KEY1"], invalid_ciphertexts: [] });
    expect(result).toContain("KEY1");
    expect(result).toContain("무효 암호문: (없음)");
  });

  it("빈 배열일 때 (없음) 표시", () => {
    const result = format_secret_notice({ missing_keys: [], invalid_ciphertexts: [] });
    expect(result).toContain("누락 키: (없음)");
    expect(result).toContain("무효 암호문: (없음)");
  });

  it("missing_keys 8개까지만 표시", () => {
    const keys = Array.from({ length: 12 }, (_, i) => `K${i}`);
    const result = format_secret_notice({ missing_keys: keys, invalid_ciphertexts: [] });
    expect(result).toContain("K7");
    expect(result).not.toContain("K8");
  });

  it("invalid_ciphertexts 4개까지만 표시", () => {
    const ciphers = Array.from({ length: 6 }, (_, i) => `c${i}`);
    const result = format_secret_notice({ missing_keys: [], invalid_ciphertexts: ciphers });
    expect(result).toContain("c3");
    expect(result).not.toContain("c4");
  });
});

// ── format_tool_label ──

describe("format_tool_label", () => {
  it("args 없으면 이름만 반환", () => {
    expect(format_tool_label("some_tool")).toBe("`some_tool`");
  });

  it("grep → pattern 포함", () => {
    const result = format_tool_label("grep", { pattern: "hello", path: "/src" });
    expect(result).toContain('"hello"');
    expect(result).toContain("/src");
  });

  it("Grep (대소문자 변형)", () => {
    const result = format_tool_label("Grep", { pattern: "test" });
    expect(result).toContain('"test"');
  });

  it("glob → pattern 포함", () => {
    const result = format_tool_label("glob", { pattern: "*.ts" });
    expect(result).toContain("*.ts");
  });

  it("read_file → file_path", () => {
    const result = format_tool_label("read_file", { file_path: "/a/b/c.ts" });
    expect(result).toContain("/a/b/c.ts");
  });

  it("shell → command", () => {
    const result = format_tool_label("bash", { command: "npm test" });
    expect(result).toContain("npm test");
  });

  it("web_search → query", () => {
    const result = format_tool_label("web_search", { query: "TypeScript 5" });
    expect(result).toContain('"TypeScript 5"');
  });

  it("send_file → file_path", () => {
    const result = format_tool_label("send_file", { file_path: "report.pdf" });
    expect(result).toContain("report.pdf");
  });

  it("message → content", () => {
    const result = format_tool_label("message", { content: "hello world" });
    expect(result).toContain("hello world");
  });

  it("알 수 없는 도구 → 이름만", () => {
    const result = format_tool_label("unknown_tool", { foo: "bar" });
    expect(result).toBe("`unknown_tool`");
  });

  it("긴 pattern 잘림", () => {
    const long = "a".repeat(50);
    const result = format_tool_label("grep", { pattern: long });
    expect(result.length).toBeLessThan(50);
    expect(result).toContain("…");
  });

  it("args 값이 string이 아닌 경우 빈 문자열", () => {
    const result = format_tool_label("grep", { pattern: 123 });
    expect(result).toContain('""');
  });
});

// ── format_tool_result_brief ──

describe("format_tool_result_brief", () => {
  it("빈 결과 → ✓", () => {
    expect(format_tool_result_brief("")).toBe("✓");
  });

  it("짧은 결과 → 줄바꿈을 공백으로 치환", () => {
    expect(format_tool_result_brief("line1\nline2")).toBe("line1 line2");
  });

  it("max 이하 → 그대로 반환", () => {
    const short = "hello world";
    expect(format_tool_result_brief(short, 100)).toBe(short);
  });

  it("max 초과 → 잘림 + 크기 표시", () => {
    const long = "line1\nline2\nline3\nline4\nline5\nline6\n" + "x".repeat(500);
    const result = format_tool_result_brief(long, 50);
    expect(result.length).toBeLessThan(long.length);
    expect(result).toMatch(/\d+.*자/);
  });

  it("커스텀 max 적용", () => {
    const text = "a".repeat(10);
    expect(format_tool_result_brief(text, 5).length).toBeLessThan(text.length + 20);
  });
});

// ── format_tool_block ──

describe("format_tool_block", () => {
  it("성공 시 → 화살표", () => {
    const result = format_tool_block("`grep`", "found 3 matches", false);
    expect(result).toContain("→");
    expect(result).toContain("`grep`");
    expect(result).toContain("found 3 matches");
  });

  it("에러 시 → ✗", () => {
    const result = format_tool_block("`exec`", "command failed", true);
    expect(result).toContain("✗");
  });
});

// ── format_active_task_summary ──

describe("format_active_task_summary", () => {
  const make_task = (overrides: Record<string, unknown> = {}) => ({
    taskId: "t-001",
    title: "테스트 작업",
    status: "running",
    currentTurn: 3,
    maxTurns: 10,
    currentStep: "",
    ...overrides,
  });

  it("작업 수 표시", () => {
    const tasks = [make_task(), make_task({ taskId: "t-002", title: "두번째" })] as any[];
    const result = format_active_task_summary(tasks);
    expect(result).toContain("2건");
    expect(result).toContain("t-001");
    expect(result).toContain("t-002");
  });

  it("상태 이모지 매핑", () => {
    const tasks = [make_task({ status: "waiting_approval" })] as any[];
    const result = format_active_task_summary(tasks);
    expect(result).toContain(STATUS_EMOJI.waiting_approval);
  });

  it("currentStep 표시", () => {
    const tasks = [make_task({ currentStep: "analyze" })] as any[];
    const result = format_active_task_summary(tasks);
    expect(result).toContain("step: analyze");
  });

  it("find_session 콜백 사용", () => {
    const tasks = [make_task()] as any[];
    const result = format_active_task_summary(tasks, () => ({
      session_id: "abcdef123456789000",
      backend: "claude_sdk",
    } as any));
    expect(result).toContain("abcdef123456");
    expect(result).toContain("claude_sdk");
  });

  it("find_session null → 세션 라벨 없음", () => {
    const tasks = [make_task()] as any[];
    const result = format_active_task_summary(tasks, () => null);
    expect(result).not.toContain("session:");
  });

  it("제목 없는 작업 → (제목 없음)", () => {
    const tasks = [make_task({ title: "" })] as any[];
    const result = format_active_task_summary(tasks);
    expect(result).toContain("(제목 없음)");
  });
});

// ── build_active_task_context ──

describe("build_active_task_context", () => {
  it("작업 목록을 컨텍스트 문자열로 변환", () => {
    const tasks = [{
      taskId: "t-100",
      status: "running",
      title: "분석 작업",
      currentTurn: 2,
      maxTurns: 5,
      currentStep: "fetch",
    }] as any[];
    const result = build_active_task_context(tasks);
    expect(result).toContain("Active Tasks");
    expect(result).toContain("t-100");
    expect(result).toContain("[running]");
    expect(result).toContain("turn=2/5");
    expect(result).toContain("step=fetch");
  });

  it("currentStep 없으면 step 미표시", () => {
    const tasks = [{
      taskId: "t-200",
      status: "completed",
      title: "완료",
      currentTurn: 5,
      maxTurns: 5,
      currentStep: "",
    }] as any[];
    const result = build_active_task_context(tasks);
    expect(result).not.toContain("step=");
  });
});

// ── build_classifier_capabilities ──

describe("build_classifier_capabilities", () => {
  it("도구 카테고리 + 스킬 출력", () => {
    const result = build_classifier_capabilities(
      ["web", "filesystem"],
      [{ name: "code-review", summary: "코드 리뷰 스킬", triggers: ["리뷰", "review"] }],
    );
    expect(result).toContain("AVAILABLE_CAPABILITIES");
    expect(result).toContain("web, filesystem");
    expect(result).toContain("code-review");
    expect(result).toContain("코드 리뷰 스킬");
    expect(result).toContain("리뷰, review");
  });

  it("도구만 있고 스킬 없을 때", () => {
    const result = build_classifier_capabilities(["web"], []);
    expect(result).toContain("Tools: web");
    expect(result).not.toContain("Skills:");
  });

  it("스킬만 있고 도구 없을 때", () => {
    const result = build_classifier_capabilities(
      [],
      [{ name: "deploy", summary: "배포", triggers: [] }],
    );
    expect(result).not.toContain("Tools:");
    expect(result).toContain("Skills:");
    expect(result).toContain("deploy");
  });

  it("둘 다 비어 있을 때", () => {
    const result = build_classifier_capabilities([], []);
    expect(result).toBe("[AVAILABLE_CAPABILITIES]");
  });

  it("스킬 triggers 4개까지만 표시", () => {
    const result = build_classifier_capabilities([], [{
      name: "multi",
      summary: "많은 트리거",
      triggers: ["a", "b", "c", "d", "e", "f"],
    }]);
    expect(result).toContain("a, b, c, d");
    expect(result).not.toContain("e");
  });
});
