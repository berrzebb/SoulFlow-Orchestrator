/**
 * AgentInspectorAdapter — team_id 필터링 테스트.
 * Step 2: list 메서드에 team_id 파라미터가 전달되면 해당 팀 데이터만 반환.
 */
import { describe, it, expect, vi } from "vitest";
import { AgentInspectorAdapter } from "@src/agent/inspector.service.js";
import type { AgentLoopState, TaskState } from "@src/contracts.js";

function make_task(id: string, team_id: string): TaskState {
  return {
    taskId: id,
    team_id,
    title: `Task ${id}`,
    objective: "",
    channel: "ch",
    chatId: "c1",
    currentTurn: 0,
    maxTurns: 10,
    status: "running",
    memory: {},
  };
}

function make_loop(id: string, team_id: string): AgentLoopState {
  return {
    loopId: id,
    agentId: "a1",
    team_id,
    objective: "",
    currentTurn: 0,
    maxTurns: 10,
    checkShouldContinue: true,
    status: "running",
  };
}

function make_subagent(id: string, team_id: string) {
  return { id, role: "worker", status: "running" as const, team_id };
}

function make_approval(request_id: string, team_id: string) {
  return {
    request_id,
    tool_name: "tool1",
    params: {},
    created_at: new Date().toISOString(),
    status: "pending",
    context: { team_id },
  };
}

function make_domain(opts: {
  tasks?: TaskState[];
  loops?: AgentLoopState[];
  subagents?: ReturnType<typeof make_subagent>[];
  approvals?: ReturnType<typeof make_approval>[];
} = {}) {
  return {
    loop: {
      list_tasks: vi.fn().mockReturnValue(opts.tasks ?? []),
      list_loops: vi.fn().mockReturnValue(opts.loops ?? []),
      stop_loop: vi.fn().mockReturnValue(null),
    },
    task_store: {
      list: vi.fn().mockReturnValue(opts.tasks ?? []),
    },
    subagents: {
      list: vi.fn().mockReturnValue(opts.subagents ?? []),
      cancel: vi.fn().mockReturnValue(undefined),
      send_input: vi.fn().mockReturnValue(undefined),
    },
    tools: {
      list_approval_requests: vi.fn().mockReturnValue(opts.approvals ?? []),
      get_approval_request: vi.fn().mockReturnValue(null),
      resolve_approval_request: vi.fn().mockReturnValue({ ok: true, decision: "approved", status: "approved", confidence: 1 }),
      execute_approved_request: vi.fn().mockReturnValue({ ok: true }),
    },
  };
}

describe("AgentInspectorAdapter team_id filtering", () => {
  const team_a = "team-alpha";
  const team_b = "team-beta";

  describe("list_runtime_tasks", () => {
    it("team_id 지정 시 해당 팀 태스크만 반환", () => {
      const d = make_domain({ tasks: [make_task("t1", team_a), make_task("t2", team_b)] });
      const a = new AgentInspectorAdapter(d as any);
      const r = a.list_runtime_tasks(team_a);
      expect(r).toHaveLength(1);
      expect(r[0].taskId).toBe("t1");
    });

    it("team_id 미지정 시 전체 반환", () => {
      const d = make_domain({ tasks: [make_task("t1", team_a), make_task("t2", team_b)] });
      const a = new AgentInspectorAdapter(d as any);
      const r = a.list_runtime_tasks();
      expect(r).toHaveLength(2);
    });
  });

  describe("list_stored_tasks", () => {
    it("team_id 지정 시 해당 팀 저장된 태스크만 반환", async () => {
      const d = make_domain({ tasks: [make_task("t1", team_a), make_task("t2", team_b), make_task("t3", team_a)] });
      const a = new AgentInspectorAdapter(d as any);
      const r = await a.list_stored_tasks(team_a);
      expect(r).toHaveLength(2);
      expect(r.every((t) => t.team_id === team_a)).toBe(true);
    });
  });

  describe("list_subagents", () => {
    it("team_id 지정 시 해당 팀 서브에이전트만 반환", () => {
      const d = make_domain({ subagents: [make_subagent("s1", team_a), make_subagent("s2", team_b)] });
      const a = new AgentInspectorAdapter(d as any);
      const r = a.list_subagents(team_a);
      expect(r).toHaveLength(1);
      expect(r[0].id).toBe("s1");
    });
  });

  describe("list_active_loops", () => {
    it("team_id 지정 시 해당 팀 루프만 반환", () => {
      const d = make_domain({ loops: [make_loop("l1", team_a), make_loop("l2", team_b)] });
      const a = new AgentInspectorAdapter(d as any);
      const r = a.list_active_loops(team_a);
      expect(r).toHaveLength(1);
      expect(r[0].loopId).toBe("l1");
    });

    it("team_id 미지정 시 모든 running 루프 반환", () => {
      const d = make_domain({ loops: [make_loop("l1", team_a), make_loop("l2", team_b)] });
      const a = new AgentInspectorAdapter(d as any);
      const r = a.list_active_loops();
      expect(r).toHaveLength(2);
    });
  });

  describe("list_approval_requests", () => {
    it("team_id 지정 시 해당 팀 승인 요청만 반환", () => {
      const d = make_domain({ approvals: [make_approval("r1", team_a), make_approval("r2", team_b)] });
      const a = new AgentInspectorAdapter(d as any);
      const r = a.list_approval_requests(undefined, team_a);
      expect(r).toHaveLength(1);
      expect(r[0].request_id).toBe("r1");
    });
  });
});
