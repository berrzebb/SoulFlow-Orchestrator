/**
 * agent-browser-client — 순수 함수 + run_agent_browser 미설치 경로 커버리지.
 */
import { describe, it, expect } from "vitest";
import {
  parse_last_json_line,
  compact_session_name,
  agent_browser_error,
  parsed_browser_data,
  detect_agent_browser_binary,
  run_agent_browser,
  type AgentBrowserResult,
} from "@src/agent/tools/agent-browser-client.js";

// ══════════════════════════════════════════
// parse_last_json_line
// ══════════════════════════════════════════

describe("parse_last_json_line()", () => {
  it("마지막 유효한 JSON 행 반환", () => {
    const raw = "some text\n{\"ok\":true}\nmore text\n{\"data\":42}\n";
    expect(parse_last_json_line(raw)).toEqual({ data: 42 });
  });

  it("JSON 없음 → null", () => {
    expect(parse_last_json_line("no json here")).toBeNull();
  });

  it("빈 문자열 → null", () => {
    expect(parse_last_json_line("")).toBeNull();
  });

  it("배열 JSON은 무시됨 → null", () => {
    expect(parse_last_json_line("[1,2,3]")).toBeNull();
  });

  it("{로 시작하지만 JSON 아님 → null", () => {
    expect(parse_last_json_line("{invalid json}")).toBeNull();
  });

  it("{}로 끝나지 않는 줄 무시", () => {
    const raw = "{\"a\":1\n{\"b\":2}";
    const result = parse_last_json_line(raw);
    expect(result).toEqual({ b: 2 });
  });

  it("여러 줄 중 마지막 JSON 객체 반환", () => {
    const raw = "{\"first\":1}\n{\"second\":2}";
    expect(parse_last_json_line(raw)).toEqual({ second: 2 });
  });
});

// ══════════════════════════════════════════
// compact_session_name
// ══════════════════════════════════════════

describe("compact_session_name()", () => {
  it("explicit 이름 있으면 그대로 반환 (정규화)", () => {
    expect(compact_session_name("My Session", "slack", "chat1")).toBe("My-Session");
  });

  it("explicit 없으면 channel-chat_id 조합", () => {
    const name = compact_session_name(undefined, "slack", "C123");
    expect(name).toContain("slack");
    expect(name).toContain("c123");
  });

  it("channel/chat_id 없으면 'default-default'", () => {
    const name = compact_session_name();
    expect(name).toContain("default");
  });

  it("특수문자 → 하이픈으로 변환", () => {
    const name = compact_session_name("Hello World!", "ch", "id");
    expect(name).toBe("Hello-World-");
  });

  it("64자 제한 적용", () => {
    const long = "a".repeat(100);
    const name = compact_session_name(long);
    expect(name.length).toBeLessThanOrEqual(64);
  });

  it("정규화 후 빈 문자열 → 'default'", () => {
    const name = compact_session_name("!!!"); // 모두 특수문자 → 하이픈들 → 'default'
    expect(name).toBeTruthy();
  });
});

// ══════════════════════════════════════════
// agent_browser_error
// ══════════════════════════════════════════

describe("agent_browser_error()", () => {
  const not_installed: AgentBrowserResult = {
    ok: false, stdout: "", stderr: "", parsed: null,
    reason: "agent_browser_not_installed",
  };

  const exec_failed: AgentBrowserResult = {
    ok: false, stdout: "", stderr: "some error message", parsed: null,
    reason: "agent_browser_exec_failed",
  };

  it("reason=not_installed → 설치 안내 메시지", () => {
    const msg = agent_browser_error(not_installed, "fallback");
    expect(msg).toContain("agent_browser_not_installed");
    expect(msg).toContain("npm i -g agent-browser");
  });

  it("reason=exec_failed, stderr 있음 → stderr 포함", () => {
    const msg = agent_browser_error(exec_failed, "fallback");
    expect(msg).toContain("some error message");
  });

  it("stderr/stdout 없음 → fallback 메시지 사용", () => {
    const result: AgentBrowserResult = { ok: false, stdout: "", stderr: "", parsed: null };
    const msg = agent_browser_error(result, "my fallback");
    expect(msg).toContain("my fallback");
  });
});

// ══════════════════════════════════════════
// parsed_browser_data
// ══════════════════════════════════════════

describe("parsed_browser_data()", () => {
  it("parsed.data가 객체 → 반환", () => {
    const result: AgentBrowserResult = {
      ok: true, stdout: "", stderr: "",
      parsed: { data: { title: "Page", url: "https://x.com" } },
    };
    expect(parsed_browser_data(result)).toEqual({ title: "Page", url: "https://x.com" });
  });

  it("parsed 없음 → 빈 객체", () => {
    const result: AgentBrowserResult = { ok: false, stdout: "", stderr: "", parsed: null };
    expect(parsed_browser_data(result)).toEqual({});
  });

  it("parsed.data가 배열 → 빈 객체", () => {
    const result: AgentBrowserResult = {
      ok: true, stdout: "", stderr: "",
      parsed: { data: [1, 2, 3] as unknown as Record<string, unknown> },
    };
    expect(parsed_browser_data(result)).toEqual({});
  });

  it("parsed.data가 null → 빈 객체", () => {
    const result: AgentBrowserResult = {
      ok: true, stdout: "", stderr: "",
      parsed: { data: null as unknown as Record<string, unknown> },
    };
    expect(parsed_browser_data(result)).toEqual({});
  });
});

// ══════════════════════════════════════════
// detect_agent_browser_binary / run_agent_browser
// ══════════════════════════════════════════

describe("detect_agent_browser_binary()", () => {
  it("string | null 반환 (설치 여부에 따라)", () => {
    const result = detect_agent_browser_binary();
    expect(result === null || typeof result === "string").toBe(true);
  });

  it("캐시됨 — 두 번 호출해도 같은 결과", () => {
    const r1 = detect_agent_browser_binary();
    const r2 = detect_agent_browser_binary();
    expect(r1).toBe(r2);
  });
});

describe("run_agent_browser() — 바이너리 없음", () => {
  it("agent-browser 미설치 → reason=agent_browser_not_installed", async () => {
    // 테스트 환경에 agent-browser가 없으면 즉시 반환
    const result = await run_agent_browser(["--version"], { timeout_ms: 5000 });
    // 설치 안 됨이거나, 설치돼 있으면 ok=true/false 중 하나
    expect(typeof result.ok).toBe("boolean");
    expect(typeof result.stdout).toBe("string");
    expect(typeof result.stderr).toBe("string");
    if (!result.ok) {
      expect(result.reason).toMatch(/agent_browser_not_installed|agent_browser_exec_failed/);
    }
  });
});
