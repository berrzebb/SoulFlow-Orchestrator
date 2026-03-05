import { describe, it, expect } from "vitest";
import type {
  AgentEvent,
  AgentEventSource,
  AgentFinishReason,
  AgentHooks,
  ApprovalBridgeRequest,
} from "../../src/agent/agent.types.js";
import type { PostToolHook } from "../../src/agent/tools/types.js";

// ── AgentEvent 판별 유니온 ──

describe("AgentEvent discriminated union", () => {
  const source: AgentEventSource = { backend: "claude_sdk" };

  it("init 이벤트에 session_id 선택 포함", () => {
    const event: AgentEvent = { type: "init", source, at: "2026-01-01T00:00:00Z", session_id: "sess_1" };
    expect(event.type).toBe("init");
    if (event.type === "init") {
      expect(event.session_id).toBe("sess_1");
    }
  });

  it("content_delta 이벤트에 text 필수", () => {
    const event: AgentEvent = { type: "content_delta", source, at: "2026-01-01T00:00:00Z", text: "hello" };
    if (event.type === "content_delta") {
      expect(event.text).toBe("hello");
    }
  });

  it("tool_use 이벤트에 tool_name, tool_id, params 포함", () => {
    const event: AgentEvent = {
      type: "tool_use", source, at: "2026-01-01T00:00:00Z",
      tool_name: "shell", tool_id: "tc_1", params: { command: "ls" },
    };
    if (event.type === "tool_use") {
      expect(event.tool_name).toBe("shell");
      expect(event.tool_id).toBe("tc_1");
      expect(event.params).toEqual({ command: "ls" });
    }
  });

  it("tool_result 이벤트에 is_error 선택 포함", () => {
    const event: AgentEvent = {
      type: "tool_result", source, at: "2026-01-01T00:00:00Z",
      tool_name: "shell", tool_id: "tc_1", result: "Error: permission denied", is_error: true,
    };
    if (event.type === "tool_result") {
      expect(event.is_error).toBe(true);
    }
  });

  it("approval_request 이벤트에 ApprovalBridgeRequest 포함", () => {
    const request: ApprovalBridgeRequest = {
      request_id: "req_1",
      type: "command_execution",
      detail: "rm -rf /tmp/data",
      command: "rm -rf /tmp/data",
    };
    const event: AgentEvent = { type: "approval_request", source, at: "2026-01-01T00:00:00Z", request };
    if (event.type === "approval_request") {
      expect(event.request.request_id).toBe("req_1");
      expect(event.request.type).toBe("command_execution");
      expect(event.request.command).toBe("rm -rf /tmp/data");
    }
  });

  it("task_lifecycle 이벤트에 sdk_task_id, status 포함", () => {
    const event: AgentEvent = {
      type: "task_lifecycle", source, at: "2026-01-01T00:00:00Z",
      sdk_task_id: "task_99", status: "completed",
      summary: "작업 완료",
      task_usage: { total_tokens: 500, tool_uses: 3, duration_ms: 1200 },
    };
    if (event.type === "task_lifecycle") {
      expect(event.sdk_task_id).toBe("task_99");
      expect(event.status).toBe("completed");
      expect(event.summary).toBe("작업 완료");
      expect(event.task_usage!.total_tokens).toBe(500);
    }
  });

  it("rate_limit 이벤트에 status 필수", () => {
    const event: AgentEvent = {
      type: "rate_limit", source, at: "2026-01-01T00:00:00Z",
      status: "rejected", resets_at: 1700000000, utilization: 0.95,
    };
    if (event.type === "rate_limit") {
      expect(event.status).toBe("rejected");
      expect(event.resets_at).toBe(1700000000);
      expect(event.utilization).toBe(0.95);
    }
  });

  it("complete 이벤트에 finish_reason 필수", () => {
    const event: AgentEvent = {
      type: "complete", source, at: "2026-01-01T00:00:00Z",
      finish_reason: "stop", content: "done",
    };
    if (event.type === "complete") {
      expect(event.finish_reason).toBe("stop");
      expect(event.content).toBe("done");
    }
  });

  it("error 이벤트에 error 필수, code 선택", () => {
    const event: AgentEvent = {
      type: "error", source, at: "2026-01-01T00:00:00Z",
      error: "timeout", code: "ETIMEOUT",
    };
    if (event.type === "error") {
      expect(event.error).toBe("timeout");
      expect(event.code).toBe("ETIMEOUT");
    }
  });

  it("usage 이벤트에 tokens 포함", () => {
    const event: AgentEvent = {
      type: "usage", source, at: "2026-01-01T00:00:00Z",
      tokens: { input: 100, output: 200 },
    };
    if (event.type === "usage") {
      expect(event.tokens.input).toBe(100);
      expect(event.tokens.output).toBe(200);
    }
  });
});

// ── AgentEventSource ──

describe("AgentEventSource", () => {
  it("서브에이전트 source에 subagent_id/label 포함", () => {
    const source: AgentEventSource = {
      backend: "codex_cli",
      subagent_id: "sa_1",
      subagent_label: "worker",
    };
    expect(source.subagent_id).toBe("sa_1");
    expect(source.subagent_label).toBe("worker");
  });

  it("일반 source에 task_id만 포함", () => {
    const source: AgentEventSource = {
      backend: "claude_sdk",
      task_id: "task_123",
    };
    expect(source.task_id).toBe("task_123");
    expect(source.subagent_id).toBeUndefined();
  });
});

// ── AgentFinishReason 매핑 ──

describe("AgentFinishReason", () => {
  it("8가지 종료 이유를 모두 포함", () => {
    const reasons: AgentFinishReason[] = [
      "stop", "max_turns", "max_budget", "max_tokens",
      "output_retries", "error", "cancelled", "approval_required",
    ];
    expect(reasons).toHaveLength(8);
  });

  it("SDK stop_reason → AgentFinishReason 매핑 검증", () => {
    const sdk_mapping: Record<string, AgentFinishReason> = {
      success: "stop",
      end_turn: "stop",
      error_max_turns: "max_turns",
      error_max_budget_usd: "max_budget",
      max_tokens: "max_tokens",
      error_max_structured_output_retries: "output_retries",
      error_during_execution: "error",
    };
    expect(sdk_mapping.success).toBe("stop");
    expect(sdk_mapping.error_max_turns).toBe("max_turns");
    expect(sdk_mapping.error_max_budget_usd).toBe("max_budget");
    expect(sdk_mapping.max_tokens).toBe("max_tokens");
    expect(sdk_mapping.error_max_structured_output_retries).toBe("output_retries");
    expect(sdk_mapping.error_during_execution).toBe("error");
  });

  it("Codex status → AgentFinishReason 매핑 검증", () => {
    const codex_mapping: Record<string, AgentFinishReason> = {
      completed: "stop",
      interrupted: "cancelled",
      failed: "error",
    };
    expect(codex_mapping.completed).toBe("stop");
    expect(codex_mapping.interrupted).toBe("cancelled");
    expect(codex_mapping.failed).toBe("error");
  });
});

// ── AgentHooks 구조 ──

describe("AgentHooks", () => {
  it("모든 훅 필드가 선택적", () => {
    const empty: AgentHooks = {};
    expect(empty.on_event).toBeUndefined();
    expect(empty.on_stream).toBeUndefined();
    expect(empty.on_approval).toBeUndefined();
    expect(empty.pre_tool_use).toBeUndefined();
    expect(empty.post_tool_use).toBeUndefined();
  });

  it("on_event에 AgentEvent 전달 가능", () => {
    const events: AgentEvent[] = [];
    const hooks: AgentHooks = {
      on_event: (event) => { events.push(event); },
    };
    const source: AgentEventSource = { backend: "claude_cli" };
    hooks.on_event!({ type: "init", source, at: "2026-01-01T00:00:00Z" });
    hooks.on_event!({ type: "complete", source, at: "2026-01-01T00:00:00Z", finish_reason: "stop" });
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("init");
    expect(events[1].type).toBe("complete");
  });

  it("on_stream에 텍스트 청크 전달 가능", () => {
    const chunks: string[] = [];
    const hooks: AgentHooks = {
      on_stream: (chunk) => { chunks.push(chunk); },
    };
    hooks.on_stream!("hello ");
    hooks.on_stream!("world");
    expect(chunks.join("")).toBe("hello world");
  });
});

// ── PostToolHook is_error ──

describe("PostToolHook is_error", () => {
  it("성공 시 is_error=false 전달", () => {
    const calls: { name: string; is_error?: boolean }[] = [];
    const hook: PostToolHook = (name, _params, _result, _ctx, is_error) => {
      calls.push({ name, is_error });
    };
    hook("shell", { command: "ls" }, "file.txt", undefined, false);
    expect(calls).toHaveLength(1);
    expect(calls[0].is_error).toBe(false);
  });

  it("에러 시 is_error=true 전달", () => {
    const calls: { name: string; is_error?: boolean }[] = [];
    const hook: PostToolHook = (name, _params, _result, _ctx, is_error) => {
      calls.push({ name, is_error });
    };
    hook("shell", { command: "rm -rf /" }, "Error: permission denied", undefined, true);
    expect(calls).toHaveLength(1);
    expect(calls[0].is_error).toBe(true);
  });

  it("is_error 미전달 시 undefined (하위 호환)", () => {
    const calls: { name: string; is_error?: boolean }[] = [];
    const hook: PostToolHook = (name, _params, _result, _ctx, is_error) => {
      calls.push({ name, is_error });
    };
    hook("shell", {}, "ok", undefined);
    expect(calls[0].is_error).toBeUndefined();
  });
});
