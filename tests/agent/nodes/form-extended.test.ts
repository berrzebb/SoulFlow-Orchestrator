/**
 * form_handler 확장 커버리지 — runner_execute + test() 경고 케이스.
 */
import { describe, it, expect, vi } from "vitest";
import { form_handler } from "@src/agent/nodes/form.js";
import type { OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/orche-node-executor.js";
import type { RunnerContext } from "@src/agent/node-registry.js";

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
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as RunnerContext["logger"],
    emit: vi.fn(),
    all_nodes: [],
    skipped_nodes: new Set(),
    execute_node: vi.fn(),
    ...overrides,
  } as unknown as RunnerContext;
}

function make_form_node(overrides?: Partial<OrcheNodeDefinition>): OrcheNodeDefinition {
  return {
    node_id: "f1",
    node_type: "form",
    title: "테스트 폼",
    description: "설명",
    target: "origin",
    fields: [{ name: "email", type: "string", label: "이메일" }],
    timeout_ms: 5000,
    ...overrides,
  } as OrcheNodeDefinition;
}

describe("form_handler — runner_execute: ask_channel 없음", () => {
  it("ask_channel 미제공 → timed_out=true + warn 호출", async () => {
    const runner = make_runner({ options: {} as RunnerContext["options"] });
    const result = await form_handler.runner_execute!(make_form_node(), make_ctx(), runner);
    expect(result.output.timed_out).toBe(true);
    expect(result.output.fields).toEqual({});
    expect(runner.logger.warn).toHaveBeenCalled();
  });
});

describe("form_handler — runner_execute: ask_channel 성공", () => {
  it("폼 제출 → fields/submitted_by 반환", async () => {
    const ask_channel = vi.fn().mockResolvedValue({
      fields: { email: "test@example.com" },
      responded_by: { user_id: "U001" },
      responded_at: "2024-01-01T00:00:00Z",
      timed_out: false,
    });
    const runner = make_runner({
      options: { ask_channel } as unknown as RunnerContext["options"],
    });
    const result = await form_handler.runner_execute!(make_form_node(), make_ctx(), runner);
    expect((result.output.fields as Record<string, unknown>).email).toBe("test@example.com");
    expect(result.output.timed_out).toBe(false);
    expect(ask_channel).toHaveBeenCalled();
    expect(runner.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "node_waiting" }));
  });

  it("타임아웃 → timed_out=true", async () => {
    const ask_channel = vi.fn().mockResolvedValue({
      fields: {},
      responded_by: null,
      responded_at: new Date().toISOString(),
      timed_out: true,
    });
    const runner = make_runner({
      options: { ask_channel } as unknown as RunnerContext["options"],
    });
    const result = await form_handler.runner_execute!(make_form_node(), make_ctx(), runner);
    expect(result.output.timed_out).toBe(true);
  });

  it("fields=null → 빈 객체로 대체", async () => {
    const ask_channel = vi.fn().mockResolvedValue({
      fields: null,
      responded_by: null,
      responded_at: new Date().toISOString(),
      timed_out: false,
    });
    const runner = make_runner({
      options: { ask_channel } as unknown as RunnerContext["options"],
    });
    const result = await form_handler.runner_execute!(make_form_node(), make_ctx(), runner);
    expect(result.output.fields).toEqual({});
  });

  it("title 템플릿 resolve (memory.* 경로)", async () => {
    const ask_channel = vi.fn().mockResolvedValue({
      fields: {},
      responded_by: null,
      responded_at: new Date().toISOString(),
      timed_out: false,
    });
    const runner = make_runner({
      state: make_state({ name: "Alice" }),
      options: { ask_channel } as unknown as RunnerContext["options"],
    });
    const node = make_form_node({ title: "안녕 {{memory.name}}" } as OrcheNodeDefinition);
    await form_handler.runner_execute!(node, make_ctx(), runner);
    const req = ask_channel.mock.calls[0][0] as { content: string };
    expect(req.content).toContain("Alice");
  });
});

describe("form_handler — test()", () => {
  it("fields 없음 → 경고", () => {
    const r = form_handler.test!(make_form_node({ fields: [] } as OrcheNodeDefinition), make_ctx());
    expect(r.warnings?.some((w) => w.includes("field"))).toBe(true);
  });

  it("field name 없음 → 경고", () => {
    const r = form_handler.test!(
      make_form_node({ fields: [{ name: "" }] } as OrcheNodeDefinition),
      make_ctx(),
    );
    expect(r.warnings?.some((w) => w.includes("field name"))).toBe(true);
  });

  it("target=specified + channel 없음 → 경고", () => {
    const r = form_handler.test!(
      make_form_node({ target: "specified", channel: undefined } as OrcheNodeDefinition),
      make_ctx(),
    );
    expect(r.warnings?.some((w) => w.includes("channel"))).toBe(true);
  });

  it("정상 설정 → 경고 없음", () => {
    const r = form_handler.test!(make_form_node(), make_ctx());
    expect(r.warnings ?? []).toHaveLength(0);
  });

  it("preview: target/title/field_count 포함", () => {
    const r = form_handler.test!(make_form_node(), make_ctx());
    expect(r.preview).toHaveProperty("target");
    expect(r.preview).toHaveProperty("title");
    expect(r.preview).toHaveProperty("field_count", 1);
  });
});
