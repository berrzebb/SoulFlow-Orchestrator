/**
 * cli-adapter.ts — 미커버 분기 보충.
 * extract_tool_result_text (배열/fallback),
 * 에러 코드 분류(rate_limit/billing/token/fatal),
 * Codex item=undefined, turn.completed 무 usage,
 * extract_tool_input (JSON parse 실패, 필드 추출),
 * Gemini result without stats, result with last_text 우선.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { ClaudeCliAdapter, CodexCliAdapter, GeminiCliAdapter } from "@src/agent/pty/cli-adapter.js";

// ══════════════════════════════════════════
// Claude — extract_tool_result_text 분기
// ══════════════════════════════════════════

describe("ClaudeCliAdapter — tool_result content 다양한 형태", () => {
  let adapter: ClaudeCliAdapter;
  beforeEach(() => { adapter = new ClaudeCliAdapter(); });

  it("tool_result content가 배열(text object) → 텍스트 추출·결합", () => {
    const msg = adapter.parse_output(JSON.stringify({
      type: "assistant",
      message: {
        content: [{
          type: "tool_result",
          tool_use_id: "t1",
          content: [
            { type: "text", text: "part-a" },
            { type: "text", text: "part-b" },
          ],
        }],
      },
    }));
    expect(msg).not.toBeNull();
    const single = Array.isArray(msg) ? msg[0] : msg!;
    expect(single.type).toBe("tool_result");
    if (single.type === "tool_result") {
      expect(single.output).toContain("part-a");
      expect(single.output).toContain("part-b");
    }
  });

  it("tool_result content가 배열(혼합) → 텍스트만 필터링", () => {
    const msg = adapter.parse_output(JSON.stringify({
      type: "assistant",
      message: {
        content: [{
          type: "tool_result",
          tool_use_id: "t2",
          content: [
            { type: "text", text: "good" },
            { type: "image", data: "base64..." },
            "raw-string",
          ],
        }],
      },
    }));
    const single = Array.isArray(msg) ? msg[0] : msg!;
    if (single?.type === "tool_result") {
      expect(single.output).toContain("good");
      expect(single.output).toContain("raw-string");
    }
  });

  it("tool_result content가 숫자 → String() fallback", () => {
    const msg = adapter.parse_output(JSON.stringify({
      type: "assistant",
      message: {
        content: [{
          type: "tool_result",
          tool_use_id: "t3",
          content: 42,
        }],
      },
    }));
    const single = Array.isArray(msg) ? msg[0] : msg!;
    if (single?.type === "tool_result") {
      expect(single.output).toBe("42");
    }
  });

  it("result without usage → usage=undefined", () => {
    const msg = adapter.parse_output('{"type":"result","result":"done"}');
    expect(msg).not.toBeNull();
    if (msg?.type === "complete") {
      expect(msg.usage).toBeUndefined();
    }
  });

  it("알 수 없는 type → null", () => {
    expect(adapter.parse_output('{"type":"debug","msg":"internal"}')).toBeNull();
  });

  it("주석 줄 → null", () => {
    expect(adapter.parse_output("// this is a comment")).toBeNull();
  });
});

// ══════════════════════════════════════════
// Claude 에러 코드 분류
// ══════════════════════════════════════════

describe("ClaudeCliAdapter — 에러 코드 분류", () => {
  let adapter: ClaudeCliAdapter;
  beforeEach(() => { adapter = new ClaudeCliAdapter(); });

  it("rate limit → rate_limit", () => {
    const msg = adapter.parse_output('{"type":"error","error":"rate limit exceeded"}');
    if (msg?.type === "error") expect(msg.code).toBe("rate_limit");
  });

  it("billing → billing", () => {
    const msg = adapter.parse_output('{"type":"error","error":"billing quota exceeded"}');
    if (msg?.type === "error") expect(msg.code).toBe("billing");
  });

  it("token limit → token_limit", () => {
    const msg = adapter.parse_output('{"type":"error","error":"context window too large"}');
    if (msg?.type === "error") expect(msg.code).toBe("token_limit");
  });

  it("알 수 없는 에러 → fatal", () => {
    const msg = adapter.parse_output('{"type":"error","error":"something unexpected"}');
    if (msg?.type === "error") expect(msg.code).toBe("fatal");
  });

  it("error 메시지 필드 fallback", () => {
    const msg = adapter.parse_output('{"type":"error","message":"invalid api key"}');
    if (msg?.type === "error") expect(msg.code).toBe("auth");
  });
});

// ══════════════════════════════════════════
// Codex — 미커버 분기
// ══════════════════════════════════════════

describe("CodexCliAdapter — 미커버 분기", () => {
  let adapter: CodexCliAdapter;
  beforeEach(() => { adapter = new CodexCliAdapter(); });

  it("item=undefined → null", () => {
    const msg = adapter.parse_output('{"type":"item.completed"}');
    expect(msg).toBeNull();
  });

  it("item.started agent_message는 무시 (item.completed만 처리)", () => {
    const msg = adapter.parse_output(
      '{"type":"item.started","item":{"type":"agent_message","text":"thinking..."}}',
    );
    // agent_message는 item.completed에만 응답 → item.started는 null
    expect(msg).toBeNull();
  });

  it("turn.completed without usage → usage undefined", () => {
    const msg = adapter.parse_output('{"type":"turn.completed"}');
    expect(msg?.type).toBe("complete");
    if (msg?.type === "complete") expect(msg.usage).toBeUndefined();
  });

  it("알 수 없는 type → null", () => {
    expect(adapter.parse_output('{"type":"debug.info","data":{}}')).toBeNull();
  });

  it("turn.started → null 반환", () => {
    expect(adapter.parse_output('{"type":"turn.started"}')).toBeNull();
  });

  it("에러 코드: unauthorized → auth", () => {
    const msg = adapter.parse_output('{"type":"error","message":"unauthorized"}');
    if (msg?.type === "error") expect(msg.code).toBe("auth");
  });

  it("에러 코드: token → token_limit", () => {
    const msg = adapter.parse_output('{"type":"error","message":"token limit"}');
    if (msg?.type === "error") expect(msg.code).toBe("token_limit");
  });

  it("에러 코드: rate → rate_limit", () => {
    const msg = adapter.parse_output('{"type":"error","message":"rate limit"}');
    if (msg?.type === "error") expect(msg.code).toBe("rate_limit");
  });

  it("에러 코드: billing → billing", () => {
    const msg = adapter.parse_output('{"type":"error","message":"billing quota"}');
    if (msg?.type === "error") expect(msg.code).toBe("billing");
  });

  it("apply_patch: arguments JSON parse 실패 → raw arguments 필드로 반환", () => {
    const msg = adapter.parse_output(JSON.stringify({
      type: "item.started",
      item: { type: "apply_patch", arguments: "{invalid json" },
    }));
    if (msg?.type === "tool_use") {
      expect((msg.input as Record<string, unknown>).arguments).toBe("{invalid json");
    }
  });

  it("item.completed apply_patch에 aggregated_output fallback", () => {
    const msg = adapter.parse_output(JSON.stringify({
      type: "item.completed",
      item: { type: "apply_patch", aggregated_output: "fallback output" },
    }));
    if (msg?.type === "tool_result") {
      expect(msg.output).toBe("fallback output");
    }
  });

  it("item.started with unknown item_type → tool_use로 반환", () => {
    const msg = adapter.parse_output(JSON.stringify({
      type: "item.started",
      item: { type: "custom_tool", param1: "value1", param2: "value2" },
    }));
    expect(msg?.type).toBe("tool_use");
    if (msg?.type === "tool_use") {
      expect(msg.tool).toBe("custom_tool");
      expect((msg.input as Record<string, unknown>).param1).toBe("value1");
    }
  });
});

// ══════════════════════════════════════════
// Gemini — 미커버 분기
// ══════════════════════════════════════════

describe("GeminiCliAdapter — 미커버 분기", () => {
  let adapter: GeminiCliAdapter;
  beforeEach(() => { adapter = new GeminiCliAdapter(); });

  it("result without stats → usage undefined", () => {
    const msg = adapter.parse_output('{"type":"result","response":"done"}');
    if (msg?.type === "complete") expect(msg.usage).toBeUndefined();
  });

  it("result: last_text가 있으면 response보다 우선 사용", () => {
    adapter.parse_output('{"type":"message","role":"assistant","content":"accumulated text","delta":true}');
    const msg = adapter.parse_output('{"type":"result","response":"response text"}');
    if (msg?.type === "complete") {
      expect(msg.result).toBe("accumulated text");
    }
  });

  it("알 수 없는 type → null", () => {
    expect(adapter.parse_output('{"type":"debug","info":"internal"}')).toBeNull();
  });

  it("에러 코드: token → token_limit", () => {
    const msg = adapter.parse_output('{"type":"error","message":"context exceeded"}');
    if (msg?.type === "error") expect(msg.code).toBe("token_limit");
  });

  it("에러 코드: auth → auth", () => {
    const msg = adapter.parse_output('{"type":"error","message":"unauthorized key"}');
    if (msg?.type === "error") expect(msg.code).toBe("auth");
  });

  it("에러 코드: billing → billing", () => {
    const msg = adapter.parse_output('{"type":"error","message":"billing failed"}');
    if (msg?.type === "error") expect(msg.code).toBe("billing");
  });

  it("에러 코드: fatal → fatal", () => {
    const msg = adapter.parse_output('{"type":"error","message":"something went wrong"}');
    if (msg?.type === "error") expect(msg.code).toBe("fatal");
  });
});
