/**
 * memory_rw_handler + notify_handler 커버리지.
 */
import { describe, it, expect, vi } from "vitest";
import { memory_rw_handler } from "@src/agent/nodes/memory-rw.js";
import { notify_handler } from "@src/agent/nodes/notify.js";
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
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as RunnerContext["logger"],
    emit: vi.fn(),
    all_nodes: [],
    skipped_nodes: new Set(),
    execute_node: vi.fn(),
    ...overrides,
  } as unknown as RunnerContext;
}

// ══════════════════════════════════════════
// memory_rw_handler
// ══════════════════════════════════════════

function make_memory_node(overrides?: Partial<OrcheNodeDefinition>): OrcheNodeDefinition {
  return {
    node_id: "m1",
    node_type: "memory_rw",
    action: "get",
    key: "my_key",
    value: "",
    ...overrides,
  } as OrcheNodeDefinition;
}

describe("memory_rw_handler — 메타데이터", () => {
  it("node_type = memory_rw", () => expect(memory_rw_handler.node_type).toBe("memory_rw"));
  it("output_schema에 value/success 포함", () => {
    const names = memory_rw_handler.output_schema!.map((s) => s.name);
    expect(names).toContain("value");
    expect(names).toContain("success");
  });
  it("create_default: action/key/value 포함", () => {
    const def = memory_rw_handler.create_default!();
    expect(def).toHaveProperty("action");
    expect(def).toHaveProperty("key");
  });
});

describe("memory_rw_handler — execute: get", () => {
  it("존재하는 키 → value 반환 + success=true", async () => {
    const result = await memory_rw_handler.execute(
      make_memory_node({ action: "get", key: "name" } as OrcheNodeDefinition),
      make_ctx({ name: "Alice" }),
    );
    expect(result.output.value).toBe("Alice");
    expect(result.output.success).toBe(true);
  });

  it("없는 키 → 빈 문자열 + success=false", async () => {
    const result = await memory_rw_handler.execute(
      make_memory_node({ action: "get", key: "missing" } as OrcheNodeDefinition),
      make_ctx({}),
    );
    expect(result.output.value).toBe("");
    expect(result.output.success).toBe(false);
  });

  it("템플릿 키 resolve (memory.* 경로)", async () => {
    const result = await memory_rw_handler.execute(
      make_memory_node({ action: "get", key: "{{memory.key_name}}" } as OrcheNodeDefinition),
      make_ctx({ key_name: "data", data: "found" }),
    );
    expect(result.output.value).toBe("found");
    expect(result.output.success).toBe(true);
  });
});

describe("memory_rw_handler — execute: set", () => {
  it("값 저장 → memory에 반영 + success=true", async () => {
    const memory: Record<string, unknown> = {};
    const result = await memory_rw_handler.execute(
      make_memory_node({ action: "set", key: "greeting", value: "hello" } as OrcheNodeDefinition),
      make_ctx(memory),
    );
    expect(result.output.value).toBe("hello");
    expect(result.output.success).toBe(true);
    expect(memory.greeting).toBe("hello");
  });

  it("템플릿 value resolve", async () => {
    const memory: Record<string, unknown> = { suffix: "world" };
    const result = await memory_rw_handler.execute(
      make_memory_node({ action: "set", key: "msg", value: "hello {{memory.suffix}}" } as OrcheNodeDefinition),
      make_ctx(memory),
    );
    expect(result.output.value).toBe("hello world");
    expect(memory.msg).toBe("hello world");
  });
});

describe("memory_rw_handler — execute: delete", () => {
  it("존재하는 키 삭제 → success=true", async () => {
    const memory: Record<string, unknown> = { to_del: "bye" };
    const result = await memory_rw_handler.execute(
      make_memory_node({ action: "delete", key: "to_del" } as OrcheNodeDefinition),
      make_ctx(memory),
    );
    expect(result.output.success).toBe(true);
    expect("to_del" in memory).toBe(false);
  });

  it("없는 키 삭제 → success=false", async () => {
    const result = await memory_rw_handler.execute(
      make_memory_node({ action: "delete", key: "nonexistent" } as OrcheNodeDefinition),
      make_ctx({}),
    );
    expect(result.output.success).toBe(false);
  });
});

describe("memory_rw_handler — execute: list", () => {
  it("메모리 키 목록 반환", async () => {
    const result = await memory_rw_handler.execute(
      make_memory_node({ action: "list" } as OrcheNodeDefinition),
      make_ctx({ a: 1, b: 2 }),
    );
    const keys = JSON.parse(result.output.value as string) as string[];
    expect(keys).toContain("a");
    expect(keys).toContain("b");
    expect(result.output.success).toBe(true);
  });

  it("빈 메모리 → 빈 배열", async () => {
    const result = await memory_rw_handler.execute(
      make_memory_node({ action: "list" } as OrcheNodeDefinition),
      make_ctx({}),
    );
    expect(JSON.parse(result.output.value as string)).toHaveLength(0);
  });
});

describe("memory_rw_handler — execute: 알 수 없는 action", () => {
  it("unknown action → success=false", async () => {
    const result = await memory_rw_handler.execute(
      make_memory_node({ action: "unknown" } as OrcheNodeDefinition),
      make_ctx({}),
    );
    expect(result.output.success).toBe(false);
  });
});

describe("memory_rw_handler — test()", () => {
  it("preview: action/key 포함", () => {
    const r = memory_rw_handler.test!(make_memory_node({ action: "set", key: "x" } as OrcheNodeDefinition), make_ctx());
    expect(r.preview).toHaveProperty("action", "set");
    expect(r.preview).toHaveProperty("key", "x");
  });

  it("warnings 빈 배열", () => {
    const r = memory_rw_handler.test!(make_memory_node(), make_ctx());
    expect(r.warnings).toHaveLength(0);
  });
});

// ══════════════════════════════════════════
// notify_handler
// ══════════════════════════════════════════

function make_notify_node(overrides?: Partial<OrcheNodeDefinition>): OrcheNodeDefinition {
  return {
    node_id: "n1",
    node_type: "notify",
    content: "안녕하세요 {{memory.name}}님!",
    target: "origin",
    ...overrides,
  } as OrcheNodeDefinition;
}

describe("notify_handler — 메타데이터", () => {
  it("node_type = notify", () => expect(notify_handler.node_type).toBe("notify"));
  it("output_schema에 ok/message_id 포함", () => {
    const names = notify_handler.output_schema!.map((s) => s.name);
    expect(names).toContain("ok");
    expect(names).toContain("message_id");
  });
  it("create_default: content/target 포함", () => {
    const def = notify_handler.create_default!();
    expect(def).toHaveProperty("content");
    expect(def).toHaveProperty("target");
  });
});

describe("notify_handler — execute()", () => {
  it("기본 execute → ok=true", async () => {
    const result = await notify_handler.execute(make_notify_node(), make_ctx());
    expect(result.output.ok).toBe(true);
    expect(result.output.message_id).toBe("");
  });
});

describe("notify_handler — runner_execute: send_message 없음", () => {
  it("send_message 미제공 → ok=false", async () => {
    const runner = make_runner({ options: {} as RunnerContext["options"] });
    const result = await notify_handler.runner_execute!(make_notify_node(), make_ctx(), runner);
    expect(result.output.ok).toBe(false);
  });
});

describe("notify_handler — runner_execute: send_message 성공", () => {
  it("메시지 전송 성공 → ok=true, message_id 반환", async () => {
    const send_message = vi.fn().mockResolvedValue({ ok: true, message_id: "msg-123" });
    const runner = make_runner({
      state: make_state({ name: "Bob" }),
      options: { send_message } as unknown as RunnerContext["options"],
    });
    const result = await notify_handler.runner_execute!(make_notify_node(), make_ctx(), runner);
    expect(result.output.ok).toBe(true);
    expect(result.output.message_id).toBe("msg-123");
    expect(send_message).toHaveBeenCalled();
  });

  it("내용 템플릿 resolve → memory 값 치환", async () => {
    const send_message = vi.fn().mockResolvedValue({ ok: true, message_id: "m1" });
    const runner = make_runner({
      state: make_state({ name: "Alice" }),
      options: { send_message } as unknown as RunnerContext["options"],
    });
    await notify_handler.runner_execute!(make_notify_node(), make_ctx(), runner);
    const req = send_message.mock.calls[0][0] as { content: string };
    expect(req.content).toContain("Alice");
  });

  it("send_message 실패 → ok=false", async () => {
    const send_message = vi.fn().mockResolvedValue({ ok: false, message_id: undefined });
    const runner = make_runner({
      options: { send_message } as unknown as RunnerContext["options"],
    });
    const result = await notify_handler.runner_execute!(make_notify_node(), make_ctx(), runner);
    expect(result.output.ok).toBe(false);
    expect(result.output.message_id).toBe("");
  });
});

describe("notify_handler — test()", () => {
  it("content 없음 → 경고", () => {
    const r = notify_handler.test!(make_notify_node({ content: "" } as OrcheNodeDefinition), make_ctx());
    expect(r.warnings?.some((w) => w.includes("content"))).toBe(true);
  });

  it("content 있음 → 경고 없음", () => {
    const r = notify_handler.test!(make_notify_node({ content: "hello" } as OrcheNodeDefinition), make_ctx());
    expect(r.warnings ?? []).toHaveLength(0);
  });

  it("preview: target/channel/content 포함", () => {
    const r = notify_handler.test!(make_notify_node({ content: "test" } as OrcheNodeDefinition), make_ctx());
    expect(r.preview).toHaveProperty("target");
    expect(r.preview).toHaveProperty("content");
  });
});
