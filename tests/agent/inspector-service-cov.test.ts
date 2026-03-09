/**
 * AgentInspectorAdapter — mock domain으로 모든 메서드 커버.
 */
import { describe, it, expect, vi } from "vitest";
import { AgentInspectorAdapter, create_agent_inspector } from "@src/agent/inspector.service.js";

function make_domain() {
  return {
    loop: {
      list_tasks: vi.fn().mockReturnValue([{ task_id: "t1" }]),
      list_loops: vi.fn().mockReturnValue([{ loop_id: "l1", status: "running" }, { loop_id: "l2", status: "done" }]),
      stop_loop: vi.fn().mockReturnValue({ ok: true }),
    },
    task_store: {
      list: vi.fn().mockReturnValue([]),
    },
    subagents: {
      list: vi.fn().mockReturnValue([]),
      cancel: vi.fn().mockReturnValue(undefined),
      send_input: vi.fn().mockReturnValue(undefined),
    },
    tools: {
      list_approval_requests: vi.fn().mockReturnValue([
        { request_id: "r1", status: "pending", decision: null, confidence: 0 },
      ]),
      get_approval_request: vi.fn().mockReturnValue(null),
      resolve_approval_request: vi.fn().mockReturnValue({ ok: 1, decision: "approved", status: "resolved", confidence: 0.9 }),
      execute_approved_request: vi.fn().mockReturnValue({ ok: true }),
    },
  };
}

describe("AgentInspectorAdapter", () => {
  it("list_runtime_tasks → domain.loop.list_tasks() 위임", () => {
    const d = make_domain();
    const a = new AgentInspectorAdapter(d as any);
    const r = a.list_runtime_tasks();
    expect(d.loop.list_tasks).toHaveBeenCalled();
    expect(r).toHaveLength(1);
  });

  it("list_stored_tasks → domain.task_store.list() 위임", () => {
    const d = make_domain();
    const a = new AgentInspectorAdapter(d as any);
    a.list_stored_tasks();
    expect(d.task_store.list).toHaveBeenCalled();
  });

  it("list_subagents → domain.subagents.list() 위임", () => {
    const d = make_domain();
    const a = new AgentInspectorAdapter(d as any);
    a.list_subagents();
    expect(d.subagents.list).toHaveBeenCalled();
  });

  it("cancel_subagent → domain.subagents.cancel() 위임", () => {
    const d = make_domain();
    const a = new AgentInspectorAdapter(d as any);
    a.cancel_subagent("s1");
    expect(d.subagents.cancel).toHaveBeenCalledWith("s1");
  });

  it("send_input_to_subagent → domain.subagents.send_input() 위임", () => {
    const d = make_domain();
    const a = new AgentInspectorAdapter(d as any);
    a.send_input_to_subagent("s1", "hello");
    expect(d.subagents.send_input).toHaveBeenCalledWith("s1", "hello");
  });

  it("list_active_loops → running 상태만 필터링", () => {
    const d = make_domain();
    const a = new AgentInspectorAdapter(d as any);
    const r = a.list_active_loops();
    expect(r).toHaveLength(1);
    expect(r[0].status).toBe("running");
  });

  it("stop_loop → domain.loop.stop_loop() 위임", () => {
    const d = make_domain();
    const a = new AgentInspectorAdapter(d as any);
    a.stop_loop("l1", "manual");
    expect(d.loop.stop_loop).toHaveBeenCalledWith("l1", "manual");
  });

  it("list_approval_requests → parse_approval_row 적용", () => {
    const d = make_domain();
    const a = new AgentInspectorAdapter(d as any);
    const r = a.list_approval_requests("pending" as any);
    expect(d.tools.list_approval_requests).toHaveBeenCalledWith("pending");
    expect(Array.isArray(r)).toBe(true);
  });

  it("get_approval_request → row가 null → null 반환", () => {
    const d = make_domain();
    const a = new AgentInspectorAdapter(d as any);
    const r = a.get_approval_request("nonexistent");
    expect(r).toBeNull();
  });

  it("resolve_approval_request → 결과 정규화", () => {
    const d = make_domain();
    const a = new AgentInspectorAdapter(d as any);
    const r = a.resolve_approval_request("r1", "approved");
    expect(r.ok).toBe(true);
    expect(r.confidence).toBeCloseTo(0.9);
  });

  it("execute_approved_request → domain.tools.execute_approved_request() 위임", () => {
    const d = make_domain();
    const a = new AgentInspectorAdapter(d as any);
    a.execute_approved_request("r1");
    expect(d.tools.execute_approved_request).toHaveBeenCalledWith("r1");
  });
});

describe("create_agent_inspector", () => {
  it("AgentInspectorAdapter 인스턴스 반환", () => {
    const d = make_domain();
    const inspector = create_agent_inspector(d as any);
    expect(inspector).toBeDefined();
    expect(typeof inspector.list_runtime_tasks).toBe("function");
  });
});
