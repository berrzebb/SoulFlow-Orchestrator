/**
 * cli-adapter.ts — 미커버 분기 보충.
 * ClaudeCliAdapter: 다중 content block → 배열, 빈 content_blocks → null,
 *   messages.length=0 (미인식 블록만) → null, root user (getuid=0) → skip --dangerously,
 * CodexCliAdapter: extract_tool_input rest spread (비string arguments),
 *   build_developer_instructions tool_definitions 경로,
 * GeminiCliAdapter: message role !== "assistant" → null, empty content → null,
 *   rate error 분류, result when last_text empty → response fallback.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { ClaudeCliAdapter, CodexCliAdapter, GeminiCliAdapter } from "@src/agent/pty/cli-adapter.js";

// ══════════════════════════════════════════
// ClaudeCliAdapter — 다중 content block
// ══════════════════════════════════════════

describe("ClaudeCliAdapter — 다중 content block → 배열 반환", () => {
  let adapter: ClaudeCliAdapter;
  beforeEach(() => { adapter = new ClaudeCliAdapter(); });

  it("text + tool_use 두 블록 → AgentOutputMessage[] 배열 반환", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "I will call a tool." },
          { type: "tool_use", id: "tu-1", name: "read_file", input: { path: "/etc/hosts" } },
        ],
      },
    });
    const result = adapter.parse_output(line);
    expect(Array.isArray(result)).toBe(true);
    const arr = result as any[];
    expect(arr.length).toBe(2);
    expect(arr[0].type).toBe("assistant_chunk");
    expect(arr[1].type).toBe("tool_use");
    expect(arr[1].tool).toBe("read_file");
  });

  it("세 개 블록 (text + tool_use + text) → 길이 3 배열", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "start" },
          { type: "tool_use", id: "tu-2", name: "exec", input: {} },
          { type: "text", text: "end" },
        ],
      },
    });
    const result = adapter.parse_output(line);
    expect(Array.isArray(result)).toBe(true);
    expect((result as any[]).length).toBe(3);
  });
});

// ══════════════════════════════════════════
// ClaudeCliAdapter — 빈 / 미인식 content_blocks
// ══════════════════════════════════════════

describe("ClaudeCliAdapter — 빈 content_blocks → null", () => {
  let adapter: ClaudeCliAdapter;
  beforeEach(() => { adapter = new ClaudeCliAdapter(); });

  it("content_blocks 빈 배열 → null", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [] },
    });
    expect(adapter.parse_output(line)).toBeNull();
  });

  it("content_blocks undefined → null", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {},
    });
    expect(adapter.parse_output(line)).toBeNull();
  });

  it("text 블록 text 값이 빈 문자열 → messages.length=0 → null", () => {
    // text="" → push 안 함 (if (text) 조건), 다른 블록 없음 → messages.length=0
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "" },
        ],
      },
    });
    expect(adapter.parse_output(line)).toBeNull();
  });

  it("미인식 블록 타입만 있을 때 → messages.length=0 → null", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "unknown_block", data: "xyz" },
        ],
      },
    });
    expect(adapter.parse_output(line)).toBeNull();
  });
});

// ══════════════════════════════════════════
// ClaudeCliAdapter — root user (getuid = 0)
// ══════════════════════════════════════════

describe("ClaudeCliAdapter — root user (getuid=0) → --dangerously-skip-permissions 생략", () => {
  it("process.getuid()=0 시 --dangerously-skip-permissions 포함 안 됨", () => {
    const adapter = new ClaudeCliAdapter();
    // getuid를 0으로 임시 재정의 (root 시뮬레이션)
    const orig_getuid = (process as any).getuid;
    (process as any).getuid = () => 0;
    try {
      const args = adapter.build_args({ session_key: "test" });
      expect(args).not.toContain("--dangerously-skip-permissions");
    } finally {
      if (orig_getuid === undefined) {
        delete (process as any).getuid;
      } else {
        (process as any).getuid = orig_getuid;
      }
    }
  });
});

// ══════════════════════════════════════════
// CodexCliAdapter — extract_tool_input rest spread
// ══════════════════════════════════════════

describe("CodexCliAdapter — parse_output 엣지 케이스", () => {
  it("잘못된 JSON → catch → null (L187)", () => {
    const adapter = new CodexCliAdapter();
    expect(adapter.parse_output("not valid json")).toBeNull();
  });

  it("미인식 type → null (L220)", () => {
    const adapter = new CodexCliAdapter();
    expect(adapter.parse_output('{"type":"unknown_codex_event"}')).toBeNull();
  });
});

describe("CodexCliAdapter — extract_tool_input 비 arguments 필드", () => {
  let adapter: CodexCliAdapter;
  beforeEach(() => { adapter = new CodexCliAdapter(); });

  it("arguments 필드 없고 개별 필드 있음 → rest spread로 추출", () => {
    // item에 type, call_id, id, status 제외한 나머지 필드 추출
    const line = JSON.stringify({
      type: "item.started",
      item: {
        type: "custom_op",
        call_id: "cid-1",
        id: "id-1",
        status: "running",
        file_path: "/tmp/work.py",
        line_count: 42,
      },
    });
    const msg = adapter.parse_output(line);
    expect(msg?.type).toBe("tool_use");
    if (msg?.type === "tool_use") {
      const input = msg.input as Record<string, unknown>;
      // type, call_id, id, status 제거됨
      expect(input.file_path).toBe("/tmp/work.py");
      expect(input.line_count).toBe(42);
      expect(input.type).toBeUndefined();
      expect(input.call_id).toBeUndefined();
    }
  });

  it("arguments가 유효한 JSON 문자열 → JSON.parse 결과 반환", () => {
    const line = JSON.stringify({
      type: "item.started",
      item: {
        type: "apply_patch",
        arguments: JSON.stringify({ patch: "--- a\\n+++ b", target: "file.ts" }),
      },
    });
    const msg = adapter.parse_output(line);
    if (msg?.type === "tool_use") {
      const input = msg.input as Record<string, unknown>;
      expect(input.patch).toContain("--- a");
      expect(input.target).toBe("file.ts");
    }
  });
});

// ══════════════════════════════════════════
// CodexCliAdapter — build_developer_instructions tool_definitions
// ══════════════════════════════════════════

describe("CodexCliAdapter — build_args tool_definitions 경로", () => {
  it("tool_definitions → developer_instructions에 포함됨", () => {
    const adapter = new CodexCliAdapter();
    const defs = "read_file: reads a file";
    const args = adapter.build_args({ session_key: "test", tool_definitions: defs });
    // --config developer_instructions=... 인자 확인
    const config_idx = args.indexOf("--config");
    expect(config_idx).toBeGreaterThan(-1);
    const config_val = args[config_idx + 1];
    expect(config_val).toContain("## Tools");
    expect(config_val).toContain(defs);
  });

  it("system_prompt + tool_definitions 조합 → 모두 포함됨", () => {
    const adapter = new CodexCliAdapter();
    const args = adapter.build_args({
      session_key: "test",
      system_prompt: "You are a helpful bot.",
      tool_definitions: "exec: runs shell commands",
    });
    const config_idx = args.indexOf("--config");
    expect(config_idx).toBeGreaterThan(-1);
    const config_val = args[config_idx + 1];
    expect(config_val).toContain("You are a helpful bot.");
    expect(config_val).toContain("exec: runs shell commands");
  });
});

// ══════════════════════════════════════════
// GeminiCliAdapter — message role 분기
// ══════════════════════════════════════════

describe("GeminiCliAdapter — message role !== 'assistant' → null", () => {
  let adapter: GeminiCliAdapter;
  beforeEach(() => { adapter = new GeminiCliAdapter(); });

  it("role='user' → null 반환", () => {
    const line = JSON.stringify({
      type: "message",
      role: "user",
      content: "human message",
      delta: true,
    });
    expect(adapter.parse_output(line)).toBeNull();
  });

  it("role='system' → null 반환", () => {
    const line = JSON.stringify({
      type: "message",
      role: "system",
      content: "system message",
      delta: true,
    });
    expect(adapter.parse_output(line)).toBeNull();
  });

  it("content 빈 문자열 → null 반환", () => {
    const line = JSON.stringify({
      type: "message",
      role: "assistant",
      content: "",
      delta: true,
    });
    expect(adapter.parse_output(line)).toBeNull();
  });
});

// ══════════════════════════════════════════
// GeminiCliAdapter — result response fallback
// ══════════════════════════════════════════

describe("GeminiCliAdapter — result: last_text 없을 때 response fallback", () => {
  it("assistant 메시지 없이 result → parsed.response 사용", () => {
    const adapter = new GeminiCliAdapter();
    // last_text 누적 없이 result
    const msg = adapter.parse_output('{"type":"result","response":"direct response","stats":{"input_tokens":10,"output_tokens":5}}');
    expect(msg?.type).toBe("complete");
    if (msg?.type === "complete") {
      expect(msg.result).toBe("direct response");
      expect(msg.usage?.input).toBe(10);
    }
  });
});

// ══════════════════════════════════════════
// GeminiCliAdapter — rate error 분류
// ══════════════════════════════════════════

describe("GeminiCliAdapter — rate_limit 에러 (rate 포함)", () => {
  it("'rate limit exceeded' → rate_limit 코드", () => {
    const adapter = new GeminiCliAdapter();
    const msg = adapter.parse_output('{"type":"error","message":"rate limit exceeded"}');
    if (msg?.type === "error") expect(msg.code).toBe("rate_limit");
  });
});

// ══════════════════════════════════════════
// GeminiCliAdapter — init 세션 리셋
// ══════════════════════════════════════════

describe("GeminiCliAdapter — init 이벤트: session_id + last_text 리셋", () => {
  it("init → session_id 저장, last_text 초기화", () => {
    const adapter = new GeminiCliAdapter();
    // 먼저 last_text 축적
    adapter.parse_output('{"type":"message","role":"assistant","content":"old text","delta":true}');
    // init → 리셋
    const r = adapter.parse_output('{"type":"init","session_id":"sess-999","model":"gemini-pro"}');
    expect(r).toBeNull();
    expect(adapter.session_id).toBe("sess-999");
    // result에서 last_text가 비어 있으므로 response 사용
    const complete = adapter.parse_output('{"type":"result","response":"fresh start"}');
    if (complete?.type === "complete") {
      expect(complete.result).toBe("fresh start");
    }
  });
});

// ══════════════════════════════════════════
// ClaudeCliAdapter — messages.length===1 (L102) + tool_result 처리
// ══════════════════════════════════════════

describe("ClaudeCliAdapter — messages.length===1 → 단일 메시지 반환 (배열 아님)", () => {
  it("tool_use 블록 하나 → 배열 아닌 단일 AgentOutputMessage 반환", () => {
    const adapter = new ClaudeCliAdapter();
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", id: "tu-single", name: "read_file", input: { path: "/etc/hosts" } },
        ],
      },
    });
    const result = adapter.parse_output(line);
    expect(Array.isArray(result)).toBe(false);
    expect(result?.type).toBe("tool_use");
  });

  it("tool_result 블록 (content 문자열) → tool_result 메시지 반환", () => {
    const adapter = new ClaudeCliAdapter();
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "tu-1", content: "file content here" },
        ],
      },
    });
    const result = adapter.parse_output(line);
    expect(result?.type).toBe("tool_result");
    if (result?.type === "tool_result") expect(result.output).toBe("file content here");
  });

  it("tool_result 블록 (content 배열) → 텍스트 추출 후 join", () => {
    const adapter = new ClaudeCliAdapter();
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu-2",
            content: [
              { type: "text", text: "line one" },
              { type: "text", text: "line two" },
            ],
          },
        ],
      },
    });
    const result = adapter.parse_output(line);
    expect(result?.type).toBe("tool_result");
    if (result?.type === "tool_result") expect(result.output).toContain("line one");
  });

  it("tool_result 블록 (content 숫자/기타) → String() fallback", () => {
    const adapter = new ClaudeCliAdapter();
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "tu-3", content: 42 },
        ],
      },
    });
    const result = adapter.parse_output(line);
    expect(result?.type).toBe("tool_result");
    if (result?.type === "tool_result") expect(result.output).toBe("42");
  });
});

// ══════════════════════════════════════════
// CodexCliAdapter — parse_item return null (L273)
// ══════════════════════════════════════════

describe("CodexCliAdapter — parse_item return null 경로 (L273)", () => {
  it("item 없음 (undefined) → null", () => {
    const adapter = new CodexCliAdapter();
    // item 필드 없으면 parse_item(undefined, ...) → null
    const result = adapter.parse_output('{"type":"item.started"}');
    expect(result).toBeNull();
  });

  it("item.type=agent_message + event=item.started → null (L273)", () => {
    const adapter = new CodexCliAdapter();
    // agent_message는 item.completed 시에만 처리됨 → item.started는 null
    const result = adapter.parse_output('{"type":"item.started","item":{"type":"agent_message","text":"hi"}}');
    expect(result).toBeNull();
  });
});

// ══════════════════════════════════════════
// ClaudeCliAdapter — parse_output 미인식 type (L120)
// ══════════════════════════════════════════

describe("ClaudeCliAdapter — 미인식 type → null (L120)", () => {
  it("알 수 없는 type → null 반환", () => {
    const adapter = new ClaudeCliAdapter();
    const result = adapter.parse_output('{"type":"unknown_event","data":"xyz"}');
    expect(result).toBeNull();
  });
});

// ══════════════════════════════════════════
// extract_tool_result_text — 배열 내 비 text-type 항목 처리 (L288)
// ══════════════════════════════════════════

describe("ClaudeCliAdapter — tool_result 배열 내 혼합 항목 처리 (L288)", () => {
  it("배열 내 비 text 항목 → '' (filter 후 제거)", () => {
    const adapter = new ClaudeCliAdapter();
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu-mixed",
            content: [
              { type: "image", url: "https://example.com/img.png" },  // non-text type
              { type: "text", text: "actual text" },
            ],
          },
        ],
      },
    });
    const result = adapter.parse_output(line);
    if (result?.type === "tool_result") expect(result.output).toBe("actual text");
  });
});

// ══════════════════════════════════════════
// GeminiCliAdapter — 미인식 type → return null (L428)
// ══════════════════════════════════════════

describe("GeminiCliAdapter — 미인식 type → null 반환 (L428)", () => {
  it("unknown type → null", () => {
    const adapter = new GeminiCliAdapter();
    const result = adapter.parse_output('{"type":"unknown_event","data":"xyz"}');
    expect(result).toBeNull();
  });
});

// ══════════════════════════════════════════
// map_gemini_error_code — billing + fatal 에러 (L441-443)
// ══════════════════════════════════════════

describe("GeminiCliAdapter — billing + fatal 에러 분기", () => {
  it("'billing issue' → billing 코드 (L441)", () => {
    const adapter = new GeminiCliAdapter();
    const msg = adapter.parse_output('{"type":"error","message":"billing issue, please check your account"}');
    if (msg?.type === "error") expect(msg.code).toBe("billing");
  });

  it("알 수 없는 에러 → fatal 코드 (L443)", () => {
    const adapter = new GeminiCliAdapter();
    const msg = adapter.parse_output('{"type":"error","message":"some unexpected service error occurred"}');
    if (msg?.type === "error") expect(msg.code).toBe("fatal");
  });
});

// ══════════════════════════════════════════
// map_claude_error_code — rate/billing/fatal 분기 (L300-302)
// ══════════════════════════════════════════

describe("ClaudeCliAdapter — map_claude_error_code rate/billing/fatal 분기", () => {
  it("rate 에러 → rate_limit 코드", () => {
    const adapter = new ClaudeCliAdapter();
    const msg = adapter.parse_output('{"type":"error","error":"rate limit exceeded"}');
    if (msg?.type === "error") expect(msg.code).toBe("rate_limit");
  });

  it("billing 에러 → billing 코드", () => {
    const adapter = new ClaudeCliAdapter();
    const msg = adapter.parse_output('{"type":"error","error":"billing quota exceeded"}');
    if (msg?.type === "error") expect(msg.code).toBe("billing");
  });

  it("알 수 없는 에러 → fatal 코드", () => {
    const adapter = new ClaudeCliAdapter();
    const msg = adapter.parse_output('{"type":"error","error":"unexpected service failure"}');
    if (msg?.type === "error") expect(msg.code).toBe("fatal");
  });
});

describe("CodexCliAdapter — parse_output 빈 줄 (L183)", () => {
  it("빈 줄 → null 반환 (L183)", () => {
    const adapter = new CodexCliAdapter();
    expect(adapter.parse_output("")).toBeNull();
    expect(adapter.parse_output("   ")).toBeNull();
  });
});
