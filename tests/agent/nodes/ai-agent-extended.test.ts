/**
 * ai_agent_handler 커버리지 — execute/runner_execute/test().
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ai_agent_handler } from "@src/agent/nodes/ai-agent.js";

afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

const WORKSPACE = join(tmpdir(), "ai-agent-test-ws");

function make_ctx(memory: Record<string, string> = {}) {
  return { memory, workspace: WORKSPACE, abort_signal: undefined };
}

function make_runner(services: Record<string, unknown> = {}) {
  return {
    state: { workflow_id: "wf_001" },
    services,
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
    emit: vi.fn(),
    options: {},
  };
}

// ══════════════════════════════════════════
// 메타데이터
// ══════════════════════════════════════════

describe("ai_agent_handler — 메타데이터", () => {
  it("node_type = ai_agent", () => expect(ai_agent_handler.node_type).toBe("ai_agent"));
  it("output_schema 4개 필드", () => expect(ai_agent_handler.output_schema?.length).toBeGreaterThanOrEqual(4));
  it("create_default: backend + user_prompt 포함", () => {
    const d = ai_agent_handler.create_default!();
    expect(d.backend).toBeDefined();
    expect(d.user_prompt).toBeDefined();
  });
});

// ══════════════════════════════════════════
// execute
// ══════════════════════════════════════════

describe("ai_agent_handler — execute (기본 반환)", () => {
  it("execute → _meta resolved=true", async () => {
    const r = await ai_agent_handler.execute(
      { backend: "openrouter", system_prompt: "You are helpful.", user_prompt: "Hello", tool_nodes: [], max_turns: 5 },
      make_ctx(),
    );
    expect(r.output._meta?.resolved).toBe(true);
    expect(r.output._meta?.backend).toBe("openrouter");
    expect(r.output.result).toBe("");
  });

  it("메모리 템플릿 보간 → user_prompt에 반영", async () => {
    const r = await ai_agent_handler.execute(
      { backend: "claude", system_prompt: "sys", user_prompt: "Say {{memory.greeting}}", tool_nodes: [] },
      make_ctx({ greeting: "hello_world" }),
    );
    expect(r.output._meta?.user_prompt).toContain("hello_world");
  });

  it("tool_nodes 없음 → 빈 배열로 기본값", async () => {
    const r = await ai_agent_handler.execute(
      { backend: "openrouter", system_prompt: "", user_prompt: "" },
      make_ctx(),
    );
    expect(Array.isArray(r.output._meta?.tool_nodes)).toBe(true);
  });

  it("max_turns 없음 → 10 기본값", async () => {
    const r = await ai_agent_handler.execute(
      { backend: "openrouter", system_prompt: "", user_prompt: "" },
      make_ctx(),
    );
    expect(r.output._meta?.max_turns).toBe(10);
  });
});

// ══════════════════════════════════════════
// runner_execute
// ══════════════════════════════════════════

describe("ai_agent_handler — runner_execute", () => {
  it("spawn/wait 없음 → execute()와 동일 결과", async () => {
    const node = { backend: "claude", system_prompt: "sys", user_prompt: "q", tool_nodes: [] };
    const ctx = make_ctx();
    const runner = make_runner({});
    const r = await ai_agent_handler.runner_execute!(node, ctx, runner as any);
    expect(r.output._meta?.resolved).toBe(true);
  });

  it("spawn/wait 있음 → spawn 호출 후 wait 결과 반환", async () => {
    const mock_spawn = vi.fn().mockResolvedValue({ agent_id: "agent_123" });
    const mock_wait = vi.fn().mockResolvedValue({ result: "done", status: "completed" });
    const runner = make_runner({ spawn_agent: mock_spawn, wait_agent: mock_wait });

    const r = await ai_agent_handler.runner_execute!(
      { backend: "claude", system_prompt: "sys", user_prompt: "task", tool_nodes: [], max_turns: 3, node_id: "n1" },
      make_ctx(),
      runner as any,
    );
    expect(mock_spawn).toHaveBeenCalledOnce();
    expect(mock_wait).toHaveBeenCalledWith("agent_123", 90_000);
    expect(r.output.result).toBe("done");
    expect(r.output.agent_id).toBe("agent_123");
  });

  it("output_json_schema 있고 JSON 결과 → structured 파싱", async () => {
    const mock_spawn = vi.fn().mockResolvedValue({ agent_id: "a1" });
    const mock_wait = vi.fn().mockResolvedValue({ result: '{"score":95}', status: "completed" });
    const runner = make_runner({ spawn_agent: mock_spawn, wait_agent: mock_wait });

    const r = await ai_agent_handler.runner_execute!(
      { backend: "claude", system_prompt: "sys", user_prompt: "eval", output_json_schema: { type: "object" }, node_id: "n2" },
      make_ctx(),
      runner as any,
    );
    expect(r.output.structured).toEqual({ score: 95 });
  });

  it("output_json_schema 있고 비JSON 결과 → structured=null", async () => {
    const mock_spawn = vi.fn().mockResolvedValue({ agent_id: "a2" });
    const mock_wait = vi.fn().mockResolvedValue({ result: "plain text", status: "completed" });
    const runner = make_runner({ spawn_agent: mock_spawn, wait_agent: mock_wait });

    const r = await ai_agent_handler.runner_execute!(
      { backend: "claude", system_prompt: "sys", user_prompt: "q", output_json_schema: { type: "object" }, node_id: "n3" },
      make_ctx(),
      runner as any,
    );
    expect(r.output.structured).toBeNull();
  });

  it("completion.error 있음 → result에 error 반환", async () => {
    const mock_spawn = vi.fn().mockResolvedValue({ agent_id: "a3" });
    const mock_wait = vi.fn().mockResolvedValue({ error: "agent_failed", status: "error" });
    const runner = make_runner({ spawn_agent: mock_spawn, wait_agent: mock_wait });

    const r = await ai_agent_handler.runner_execute!(
      { backend: "claude", system_prompt: "sys", user_prompt: "q", node_id: "n4" },
      make_ctx(),
      runner as any,
    );
    expect(r.output.result).toBe("agent_failed");
  });

  it("spawn 예외 → error 필드 반환 + logger.warn 호출", async () => {
    const mock_spawn = vi.fn().mockRejectedValue(new Error("spawn failed"));
    const runner = make_runner({ spawn_agent: mock_spawn, wait_agent: vi.fn() });

    const r = await ai_agent_handler.runner_execute!(
      { backend: "claude", system_prompt: "sys", user_prompt: "q", node_id: "n5" },
      make_ctx(),
      runner as any,
    );
    expect(r.output.result).toBe("");
    expect(String(r.output.error)).toContain("spawn failed");
    expect(runner.logger.warn).toHaveBeenCalledWith("ai_agent_node_error", expect.anything());
  });

  it("emit node_started 이벤트 호출", async () => {
    const mock_spawn = vi.fn().mockResolvedValue({ agent_id: "ae1" });
    const mock_wait = vi.fn().mockResolvedValue({ result: "ok", status: "completed" });
    const runner = make_runner({ spawn_agent: mock_spawn, wait_agent: mock_wait });

    await ai_agent_handler.runner_execute!(
      { backend: "claude", system_prompt: "", user_prompt: "q", node_id: "en1" },
      make_ctx(),
      runner as any,
    );
    expect(runner.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "node_started" }));
  });

  it("tool_nodes 있음 → allowed_tools에 전달", async () => {
    const mock_spawn = vi.fn().mockResolvedValue({ agent_id: "at1" });
    const mock_wait = vi.fn().mockResolvedValue({ result: "", status: "completed" });
    const runner = make_runner({ spawn_agent: mock_spawn, wait_agent: mock_wait });

    await ai_agent_handler.runner_execute!(
      { backend: "claude", system_prompt: "sys", user_prompt: "q", tool_nodes: ["web_search", "calc"], node_id: "n6" },
      make_ctx(),
      runner as any,
    );
    const spawn_args = mock_spawn.mock.calls[0][0] as { allowed_tools?: string[] };
    expect(spawn_args.allowed_tools).toEqual(["web_search", "calc"]);
  });
});

// ══════════════════════════════════════════
// test()
// ══════════════════════════════════════════

describe("ai_agent_handler — test()", () => {
  it("backend 없음 → warning", () => {
    const r = ai_agent_handler.test!({ backend: "" }, make_ctx());
    expect(r.warnings.some((w) => w.includes("backend"))).toBe(true);
  });

  it("user_prompt 없음 → warning", () => {
    const r = ai_agent_handler.test!({ backend: "claude", user_prompt: "", system_prompt: "sys" }, make_ctx());
    expect(r.warnings.some((w) => w.includes("user_prompt"))).toBe(true);
  });

  it("system_prompt 없음 → warning", () => {
    const r = ai_agent_handler.test!({ backend: "claude", user_prompt: "q", system_prompt: "" }, make_ctx());
    expect(r.warnings.some((w) => w.includes("system_prompt"))).toBe(true);
  });

  it("max_turns > 50 → warning", () => {
    const r = ai_agent_handler.test!({ backend: "claude", user_prompt: "q", system_prompt: "sys", max_turns: 100 }, make_ctx());
    expect(r.warnings.some((w) => w.includes("max_turns"))).toBe(true);
  });

  it("tool_nodes 빈 배열 → no tool_nodes warning", () => {
    const r = ai_agent_handler.test!({ backend: "claude", user_prompt: "q", system_prompt: "sys", tool_nodes: [] }, make_ctx());
    expect(r.warnings.some((w) => w.includes("tool_nodes"))).toBe(true);
  });

  it("모든 필드 정상 → warnings 없음", () => {
    const r = ai_agent_handler.test!(
      { backend: "claude", user_prompt: "q", system_prompt: "sys", tool_nodes: ["web"], max_turns: 10 },
      make_ctx(),
    );
    expect(r.warnings).toHaveLength(0);
  });

  it("preview에 backend/model/tool_count/max_turns/has_schema 포함", () => {
    const r = ai_agent_handler.test!(
      { backend: "claude", model: "claude-3-opus", user_prompt: "q", system_prompt: "sys", tool_nodes: ["a", "b"], output_json_schema: {} },
      make_ctx(),
    );
    expect(r.preview?.backend).toBe("claude");
    expect(r.preview?.model).toBe("claude-3-opus");
    expect(r.preview?.tool_count).toBe(2);
    expect(r.preview?.has_schema).toBe(true);
  });
});
