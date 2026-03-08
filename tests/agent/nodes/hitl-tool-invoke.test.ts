/**
 * hitl_handler + tool_invoke_handler 커버리지.
 * execute / runner_execute / test 메서드 전체.
 */
import { describe, it, expect, vi } from "vitest";
import { hitl_handler } from "@src/agent/nodes/hitl.js";
import { tool_invoke_handler } from "@src/agent/nodes/tool-invoke.js";
import type { OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/orche-node-executor.js";
import type { RunnerContext } from "@src/agent/node-registry.js";

// ── 공통 헬퍼 ──

function make_ctx(memory: Record<string, unknown> = {}): OrcheNodeExecutorContext {
  return { memory, workspace: "/tmp", abort_signal: undefined };
}

function make_state(memory: Record<string, unknown> = {}) {
  return {
    workflow_id: "wf-1",
    title: "test",
    objective: "obj",
    channel: "slack",
    chat_id: "C001",
    status: "running" as const,
    current_phase: 0,
    phases: [],
    memory,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function make_runner(overrides: Partial<RunnerContext> = {}): RunnerContext {
  return {
    state: make_state(),
    options: {} as RunnerContext["options"],
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as RunnerContext["logger"],
    emit: vi.fn(),
    all_nodes: [],
    skipped_nodes: new Set(),
    execute_node: vi.fn(),
    ...overrides,
  } as unknown as RunnerContext;
}

// ══════════════════════════════════════════
// hitl_handler
// ══════════════════════════════════════════

function make_hitl_node(overrides?: Partial<OrcheNodeDefinition>): OrcheNodeDefinition {
  return {
    node_id: "h1",
    node_type: "hitl",
    prompt: "사용자에게 질문: {{question}}",
    target: "origin",
    timeout_ms: 5000,
    ...overrides,
  } as OrcheNodeDefinition;
}

describe("hitl_handler — 메타데이터", () => {
  it("node_type = hitl", () => expect(hitl_handler.node_type).toBe("hitl"));
  it("icon 존재", () => expect(hitl_handler.icon).toBeTruthy());
  it("output_schema에 response 포함", () => {
    expect(hitl_handler.output_schema!.some((s) => s.name === "response")).toBe(true);
  });
  it("create_default: 기본값 반환", () => {
    const def = hitl_handler.create_default!();
    expect(def).toHaveProperty("prompt");
    expect(def).toHaveProperty("timeout_ms");
  });
});

describe("hitl_handler — execute()", () => {
  it("기본 execute → 빈 response, timed_out=false", async () => {
    const result = await hitl_handler.execute(make_hitl_node(), make_ctx());
    expect(result.output.response).toBe("");
    expect(result.output.timed_out).toBe(false);
    expect(result.output.responded_at).toBeTruthy();
  });
});

describe("hitl_handler — runner_execute: ask_channel 없음", () => {
  it("ask_channel 미제공 → fallback_value 반환 + warn 호출", async () => {
    const runner = make_runner({ options: {} as RunnerContext["options"] });
    const node = make_hitl_node({ fallback_value: "기본 응답" } as OrcheNodeDefinition);
    const result = await hitl_handler.runner_execute!(node, make_ctx(), runner);
    expect(result.output.response).toBe("기본 응답");
    expect(result.output.timed_out).toBe(true);
    expect(runner.logger.warn).toHaveBeenCalled();
  });

  it("ask_channel 없고 fallback_value 없음 → 빈 문자열", async () => {
    const runner = make_runner({ options: {} as RunnerContext["options"] });
    const node = make_hitl_node();
    const result = await hitl_handler.runner_execute!(node, make_ctx(), runner);
    expect(result.output.response).toBe("");
    expect(result.output.timed_out).toBe(true);
  });
});

describe("hitl_handler — runner_execute: ask_channel 성공", () => {
  it("정상 응답 → response/responded_by/responded_at 반환", async () => {
    const ask_channel = vi.fn().mockResolvedValue({
      response: "사용자 응답",
      responded_by: { user_id: "U001" },
      responded_at: "2024-01-01T00:00:00Z",
      timed_out: false,
    });
    const runner = make_runner({
      options: { ask_channel } as unknown as RunnerContext["options"],
    });
    const node = make_hitl_node({ target: "origin" } as OrcheNodeDefinition);
    const result = await hitl_handler.runner_execute!(node, make_ctx(), runner);
    expect(result.output.response).toBe("사용자 응답");
    expect(result.output.timed_out).toBe(false);
    expect(ask_channel).toHaveBeenCalled();
    expect(runner.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "node_waiting" }));
  });

  it("timeout + fallback_value → fallback 사용", async () => {
    const ask_channel = vi.fn().mockResolvedValue({
      response: "",
      responded_by: null,
      responded_at: new Date().toISOString(),
      timed_out: true,
    });
    const runner = make_runner({
      options: { ask_channel } as unknown as RunnerContext["options"],
    });
    const node = make_hitl_node({ fallback_value: "타임아웃 응답" } as OrcheNodeDefinition);
    const result = await hitl_handler.runner_execute!(node, make_ctx(), runner);
    expect(result.output.response).toBe("타임아웃 응답");
    expect(result.output.timed_out).toBe(true);
  });

  it("timeout + fallback 없음 → 빈 response", async () => {
    const ask_channel = vi.fn().mockResolvedValue({
      response: "",
      responded_by: null,
      responded_at: new Date().toISOString(),
      timed_out: true,
    });
    const runner = make_runner({
      options: { ask_channel } as unknown as RunnerContext["options"],
    });
    const node = make_hitl_node();
    const result = await hitl_handler.runner_execute!(node, make_ctx(), runner);
    expect(result.output.timed_out).toBe(true);
    expect(result.output.response).toBe("");
  });
});

describe("hitl_handler — test()", () => {
  it("prompt 없음 → 경고", () => {
    const r = hitl_handler.test!(make_hitl_node({ prompt: "" } as OrcheNodeDefinition), make_ctx());
    expect(r.warnings?.some((w) => w.includes("prompt"))).toBe(true);
  });

  it("target=specified + channel 없음 → 경고", () => {
    const r = hitl_handler.test!(
      make_hitl_node({ target: "specified", channel: undefined } as OrcheNodeDefinition),
      make_ctx(),
    );
    expect(r.warnings?.some((w) => w.includes("channel"))).toBe(true);
  });

  it("정상 설정 → 경고 없음", () => {
    const r = hitl_handler.test!(make_hitl_node({ prompt: "질문입니다" } as OrcheNodeDefinition), make_ctx());
    expect(r.warnings ?? []).toHaveLength(0);
  });

  it("preview: target/channel/timeout_ms 포함", () => {
    const r = hitl_handler.test!(make_hitl_node(), make_ctx());
    expect(r.preview).toHaveProperty("target");
    expect(r.preview).toHaveProperty("timeout_ms");
  });

  it("템플릿 변수 resolve → preview.prompt 에 반영", () => {
    const r = hitl_handler.test!(
      make_hitl_node({ prompt: "hello {{name}}" } as OrcheNodeDefinition),
      make_ctx({ name: "world" }),
    );
    expect(r.preview?.prompt).toContain("hello");
  });
});

// ══════════════════════════════════════════
// tool_invoke_handler
// ══════════════════════════════════════════

function make_tool_node(overrides?: Partial<OrcheNodeDefinition>): OrcheNodeDefinition {
  return {
    node_id: "t1",
    node_type: "tool_invoke",
    tool_id: "my_tool",
    params: { key: "value" },
    timeout_ms: 5000,
    ...overrides,
  } as OrcheNodeDefinition;
}

describe("tool_invoke_handler — 메타데이터", () => {
  it("node_type = tool_invoke", () => expect(tool_invoke_handler.node_type).toBe("tool_invoke"));
  it("output_schema에 result/ok 포함", () => {
    const names = tool_invoke_handler.output_schema!.map((s) => s.name);
    expect(names).toContain("result");
    expect(names).toContain("ok");
  });
  it("create_default: tool_id/params/timeout_ms 포함", () => {
    const def = tool_invoke_handler.create_default!();
    expect(def).toHaveProperty("tool_id");
    expect(def).toHaveProperty("params");
  });
});

describe("tool_invoke_handler — execute()", () => {
  it("tool_id 있음 → ok=true, 해당 tool_id 반환", async () => {
    const result = await tool_invoke_handler.execute(make_tool_node(), make_ctx());
    expect(result.output.ok).toBe(true);
    expect(result.output.tool_id).toBe("my_tool");
  });

  it("tool_id 없음 → ok=false, error 반환", async () => {
    const result = await tool_invoke_handler.execute(make_tool_node({ tool_id: "" } as OrcheNodeDefinition), make_ctx());
    expect(result.output.ok).toBe(false);
    expect(String(result.output.error)).toContain("tool_id is empty");
  });

  it("템플릿 tool_id resolve (memory.* 경로)", async () => {
    // tpl_ctx = { memory: ctx.memory } → {{memory.tool_name}}
    const result = await tool_invoke_handler.execute(
      make_tool_node({ tool_id: "{{memory.tool_name}}" } as OrcheNodeDefinition),
      make_ctx({ tool_name: "resolved_tool" }),
    );
    expect(result.output.tool_id).toBe("resolved_tool");
    expect(result.output.ok).toBe(true);
  });
});

describe("tool_invoke_handler — runner_execute: invoke_tool 없음", () => {
  it("invoke_tool 미제공 → ok=false + warn 호출", async () => {
    const runner = make_runner({ options: {} as RunnerContext["options"] });
    const result = await tool_invoke_handler.runner_execute!(make_tool_node(), make_ctx(), runner);
    expect(result.output.ok).toBe(false);
    expect(String(result.output.error)).toContain("invoke_tool");
    expect(runner.logger.warn).toHaveBeenCalled();
  });

  it("tool_id 없음 → ok=false (invoke_tool 호출 없음)", async () => {
    const invoke_tool = vi.fn();
    const runner = make_runner({
      options: { invoke_tool } as unknown as RunnerContext["options"],
    });
    const result = await tool_invoke_handler.runner_execute!(
      make_tool_node({ tool_id: "" } as OrcheNodeDefinition),
      make_ctx(),
      runner,
    );
    expect(result.output.ok).toBe(false);
    expect(invoke_tool).not.toHaveBeenCalled();
  });
});

describe("tool_invoke_handler — runner_execute: invoke_tool 성공", () => {
  it("도구 실행 성공 → ok=true, result 반환", async () => {
    const invoke_tool = vi.fn().mockResolvedValue({ status: "done" });
    const runner = make_runner({
      options: { invoke_tool } as unknown as RunnerContext["options"],
    });
    const result = await tool_invoke_handler.runner_execute!(make_tool_node(), make_ctx(), runner);
    expect(result.output.ok).toBe(true);
    expect(result.output.tool_id).toBe("my_tool");
    expect((result.output.result as Record<string, unknown>).status).toBe("done");
    expect(typeof result.output.duration).toBe("number");
  });

  it("params 템플릿 resolve (memory.* 경로)", async () => {
    const invoke_tool = vi.fn().mockResolvedValue({});
    const runner = make_runner({
      state: make_state({ greeting: "hello" }),
      options: { invoke_tool } as unknown as RunnerContext["options"],
    });
    // tpl_ctx = { memory: runner.state.memory } → {{memory.greeting}}
    const node = make_tool_node({ params: { msg: "{{memory.greeting}}" } } as OrcheNodeDefinition);
    await tool_invoke_handler.runner_execute!(node, make_ctx(), runner);
    const called_params = invoke_tool.mock.calls[0][1];
    expect(called_params.msg).toBe("hello");
  });

  it("invoke_tool 예외 → ok=false, error 메시지", async () => {
    const invoke_tool = vi.fn().mockRejectedValue(new Error("tool failed"));
    const runner = make_runner({
      options: { invoke_tool } as unknown as RunnerContext["options"],
    });
    const result = await tool_invoke_handler.runner_execute!(make_tool_node(), make_ctx(), runner);
    expect(result.output.ok).toBe(false);
    expect(String(result.output.error)).toContain("tool failed");
  });
});

describe("tool_invoke_handler — test()", () => {
  it("tool_id 없음 → 경고", () => {
    const r = tool_invoke_handler.test!(make_tool_node({ tool_id: "" } as OrcheNodeDefinition), make_ctx());
    expect(r.warnings?.some((w) => w.includes("tool_id"))).toBe(true);
  });

  it("tool_id 있음 → 경고 없음", () => {
    const r = tool_invoke_handler.test!(make_tool_node(), make_ctx());
    expect(r.warnings ?? []).toHaveLength(0);
  });

  it("preview: tool_id/params/timeout_ms 포함", () => {
    const r = tool_invoke_handler.test!(make_tool_node(), make_ctx());
    expect(r.preview).toHaveProperty("tool_id", "my_tool");
    expect(r.preview).toHaveProperty("params");
    expect(r.preview).toHaveProperty("timeout_ms");
  });
});
