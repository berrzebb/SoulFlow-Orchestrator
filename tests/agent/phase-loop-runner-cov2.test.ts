/**
 * phase-loop-runner — filesystem isolation + apply_field_mappings 커버리지.
 * - worktree isolation: create_worktree + merge_worktrees + cleanup_worktrees
 * - directory isolation: create_isolated_directory
 * - worktree create 실패 (handle=null) → 경고 후 계속
 * - merge_results conflict → 에러 이벤트
 * - apply_field_mappings: to_field="" → 직접 할당 (L1271)
 * - set_nested_field 중간 키 생성 (L1293-1297)
 * - critic: failed_agents 있는 경우 → failed_notice (L749-751)
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { register_all_nodes } from "@src/agent/nodes/index.js";
import { run_phase_loop } from "@src/agent/phase-loop-runner.js";
import type { PhaseLoopRunOptions } from "@src/agent/phase-loop.types.js";

// worktree 모듈 전체 mock
vi.mock("@src/agent/worktree.js", () => ({
  create_worktree: vi.fn(),
  create_isolated_directory: vi.fn(),
  merge_worktrees: vi.fn(),
  cleanup_worktrees: vi.fn(),
}));

import {
  create_worktree,
  create_isolated_directory,
  merge_worktrees,
  cleanup_worktrees,
} from "@src/agent/worktree.js";

beforeAll(() => {
  register_all_nodes();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ──────────────────────────────────────────────────
// 헬퍼
// ──────────────────────────────────────────────────

function make_store() {
  return {
    upsert: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
    insert_message: vi.fn().mockResolvedValue(undefined),
  };
}

function make_subagents(
  spawn_result = { subagent_id: "sa1" },
  wait_result: { status: string; content?: string; error?: string } = { status: "completed", content: "agent output" },
) {
  return {
    spawn: vi.fn().mockResolvedValue(spawn_result),
    wait_for_completion: vi.fn().mockResolvedValue(wait_result),
    stop: vi.fn(),
    list: vi.fn().mockReturnValue([]),
  };
}

const noop_logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any;

function make_worktree_opts(overrides: Partial<PhaseLoopRunOptions> = {}): PhaseLoopRunOptions {
  return {
    workflow_id: "wf-iso",
    title: "Isolation WF",
    objective: "test isolation",
    channel: "slack",
    chat_id: "C1",
    workspace: "/tmp/phase-iso",
    phases: [{
      phase_id: "p1",
      title: "Phase 1",
      agents: [{
        agent_id: "a1",
        role: "analyst",
        label: "Analyst",
        backend: "openrouter",
        system_prompt: "analyze",
        filesystem_isolation: "worktree",
      }],
    }],
    ...overrides,
  };
}

// ──────────────────────────────────────────────────
// worktree isolation — 정상 경로
// ──────────────────────────────────────────────────

describe("run_phase_loop — worktree isolation 정상 경로 (L588-708)", () => {
  it("filesystem_isolation=worktree → create_worktree + merge + cleanup 호출됨", async () => {
    const handle = { path: "/tmp/wt-a1", branch: "wt-a1-branch", agent_id: "a1" };
    vi.mocked(create_worktree).mockResolvedValue(handle);
    vi.mocked(merge_worktrees).mockResolvedValue([{ agent_id: "a1", merged: true, conflict: false, files_changed: 2, error: undefined }]);
    vi.mocked(cleanup_worktrees).mockResolvedValue(undefined);

    const store = make_store();
    const subagents = make_subagents();

    const result = await run_phase_loop(make_worktree_opts(), { subagents: subagents as any, store: store as any, logger: noop_logger });

    expect(result.status).toBe("completed");
    expect(create_worktree).toHaveBeenCalledWith(expect.objectContaining({ workspace: "/tmp/phase-iso", agent_id: "a1" }));
    expect(merge_worktrees).toHaveBeenCalledWith("/tmp/phase-iso", [handle]);
    expect(cleanup_worktrees).toHaveBeenCalledWith("/tmp/phase-iso", [handle]);
  });

  it("merge_result.conflict=true → warn + agent_failed 이벤트 (L696-703)", async () => {
    const handle = { path: "/tmp/wt-a1", branch: "wt-a1-branch", agent_id: "a1" };
    vi.mocked(create_worktree).mockResolvedValue(handle);
    vi.mocked(merge_worktrees).mockResolvedValue([{ agent_id: "a1", merged: false, conflict: true, files_changed: 0, error: "merge conflict on file.ts" }]);
    vi.mocked(cleanup_worktrees).mockResolvedValue(undefined);

    const store = make_store();
    const subagents = make_subagents();
    const events: string[] = [];

    const result = await run_phase_loop(make_worktree_opts(), {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
      on_event: (e) => events.push(e.type),
    });

    expect(result.status).toBe("completed");
    expect(noop_logger.warn).toHaveBeenCalledWith(
      "worktree_merge_conflict",
      expect.objectContaining({ agent_id: "a1" }),
    );
    expect(events).toContain("agent_failed");
  });

  it("create_worktree → null 반환 → warn 후 isolation_path 없이 계속", async () => {
    vi.mocked(create_worktree).mockResolvedValue(null as any);
    vi.mocked(merge_worktrees).mockResolvedValue([]);
    vi.mocked(cleanup_worktrees).mockResolvedValue(undefined);

    const store = make_store();
    const subagents = make_subagents();

    const result = await run_phase_loop(make_worktree_opts(), { subagents: subagents as any, store: store as any, logger: noop_logger });

    expect(result.status).toBe("completed");
    expect(noop_logger.warn).toHaveBeenCalledWith("worktree_create_failed", expect.objectContaining({ agent_id: "a1" }));
    // worktree_handles가 비어서 merge/cleanup은 호출 안 됨
    expect(merge_worktrees).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────
// directory isolation
// ──────────────────────────────────────────────────

describe("run_phase_loop — directory isolation (L601-608)", () => {
  it("filesystem_isolation=directory → create_isolated_directory 호출됨", async () => {
    vi.mocked(create_isolated_directory).mockResolvedValue("/tmp/dir-a1");

    const store = make_store();
    const subagents = make_subagents();

    const result = await run_phase_loop(
      make_worktree_opts({
        phases: [{
          phase_id: "p1",
          title: "Phase 1",
          agents: [{
            agent_id: "a1",
            role: "analyst",
            label: "Analyst",
            backend: "openrouter",
            system_prompt: "analyze",
            filesystem_isolation: "directory",
          }],
        }],
      }),
      { subagents: subagents as any, store: store as any, logger: noop_logger },
    );

    expect(result.status).toBe("completed");
    expect(create_isolated_directory).toHaveBeenCalledWith(expect.objectContaining({ workspace: "/tmp/phase-iso", agent_id: "a1" }));
    // spawn 태스크에 workspace 경로 포함됨
    const spawn_call = (subagents.spawn as any).mock.calls[0][0];
    expect(spawn_call.task).toContain("/tmp/dir-a1");
  });
});

// ──────────────────────────────────────────────────
// critic: failed_agents → failed_notice (L749-751)
// ──────────────────────────────────────────────────

describe("run_phase_loop — critic에서 failed_agents notice (L749-751)", () => {
  it("에이전트 실패 + critic → failed_notice가 critic_prompt에 포함됨", async () => {
    vi.mocked(create_worktree).mockResolvedValue(null as any);
    vi.mocked(merge_worktrees).mockResolvedValue([]);
    vi.mocked(cleanup_worktrees).mockResolvedValue(undefined);

    const store = make_store();
    const critic_response = JSON.stringify({ approved: true, summary: "ok despite failure", agent_reviews: [] });
    let critic_task = "";
    const subagents = {
      spawn: vi.fn()
        .mockImplementationOnce(async (args: any) => { return { subagent_id: "sa1" }; })
        .mockImplementationOnce(async (args: any) => { critic_task = args.task; return { subagent_id: "critic1" }; }),
      wait_for_completion: vi.fn()
        .mockResolvedValueOnce({ status: "failed", error: "agent error" })
        .mockResolvedValueOnce({ status: "completed", content: critic_response }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    await run_phase_loop(
      make_worktree_opts({
        phases: [{
          phase_id: "p1",
          title: "Phase 1",
          agents: [{ agent_id: "a1", role: "analyst", label: "Analyst", backend: "openrouter", system_prompt: "analyze" }],
          critic: { system_prompt: "review", backend: "openrouter" },
        }],
      }),
      { subagents: subagents as any, store: store as any, logger: noop_logger },
    );

    // failed_notice는 critic 프롬프트에 포함됨
    expect(critic_task).toContain("Failed Agents");
    expect(critic_task).toContain("agent error");
  });
});

// ──────────────────────────────────────────────────
// apply_field_mappings — to_field="" → 직접 할당 (L1271)
// ──────────────────────────────────────────────────

describe("run_phase_loop — apply_field_mappings: to_field 없음 → 직접 할당 (L1271)", () => {
  it("to_field='' → memory[to_node]에 값 직접 할당", async () => {
    vi.mocked(create_worktree).mockResolvedValue(null as any);
    vi.mocked(merge_worktrees).mockResolvedValue([]);
    vi.mocked(cleanup_worktrees).mockResolvedValue(undefined);

    const store = make_store();
    // 첫 에이전트는 JSON 결과 반환, 두 번째 에이전트의 spawn 인수를 캡처
    let second_spawn_args: any = null;
    const subagents = {
      spawn: vi.fn()
        .mockImplementationOnce(async () => ({ subagent_id: "sa1" }))
        .mockImplementationOnce(async (args: any) => { second_spawn_args = args; return { subagent_id: "sa2" }; }),
      wait_for_completion: vi.fn()
        .mockResolvedValueOnce({ status: "completed", content: JSON.stringify({ summary: "extracted value" }) })
        .mockResolvedValueOnce({ status: "completed", content: "done" }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    await run_phase_loop(
      {
        workflow_id: "wf-map",
        title: "Map WF",
        objective: "test",
        channel: "slack",
        chat_id: "C1",
        workspace: "/tmp/map-test",
        phases: [
          {
            phase_id: "p1",
            title: "Phase 1",
            agents: [{ agent_id: "producer", role: "analyst", label: "Producer", backend: "openrouter", system_prompt: "produce" }],
          },
          {
            phase_id: "p2",
            title: "Phase 2",
            agents: [{ agent_id: "consumer", role: "analyst", label: "Consumer", backend: "openrouter", system_prompt: "consume" }],
          },
        ],
        field_mappings: [
          {
            from_node: "p1",
            from_field: "summary",
            to_node: "consumer",
            to_field: "",  // to_field 없음 → 직접 할당 (L1271)
          },
        ],
      },
      { subagents: subagents as any, store: store as any, logger: noop_logger },
    );

    // consumer 메모리에 직접 값이 할당되었는지 확인
    // spawn의 task 안에 "extracted value"가 포함되어야 함
    expect(second_spawn_args?.task).toContain("extracted value");
  });
});

// ──────────────────────────────────────────────────
// set_nested_field 중간 키 생성 (L1293-1297)
// ──────────────────────────────────────────────────

describe("run_phase_loop — set_nested_field 중간 키 생성 (L1293-1297)", () => {
  it("to_field='nested.deep.key' → 중간 객체 생성 후 값 설정", async () => {
    vi.mocked(create_worktree).mockResolvedValue(null as any);
    vi.mocked(merge_worktrees).mockResolvedValue([]);
    vi.mocked(cleanup_worktrees).mockResolvedValue(undefined);

    const store = make_store();
    let second_spawn_args: any = null;
    const subagents = {
      spawn: vi.fn()
        .mockImplementationOnce(async () => ({ subagent_id: "sa1" }))
        .mockImplementationOnce(async (args: any) => { second_spawn_args = args; return { subagent_id: "sa2" }; }),
      wait_for_completion: vi.fn()
        .mockResolvedValueOnce({ status: "completed", content: JSON.stringify({ data: "deep value" }) })
        .mockResolvedValueOnce({ status: "completed", content: "done" }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    await run_phase_loop(
      {
        workflow_id: "wf-nested",
        title: "Nested WF",
        objective: "test",
        channel: "slack",
        chat_id: "C1",
        workspace: "/tmp/nested-test",
        phases: [
          {
            phase_id: "p1",
            title: "Phase 1",
            agents: [{ agent_id: "producer", role: "analyst", label: "Producer", backend: "openrouter", system_prompt: "produce" }],
          },
          {
            phase_id: "p2",
            title: "Phase 2",
            agents: [{ agent_id: "consumer", role: "analyst", label: "Consumer", backend: "openrouter", system_prompt: "consume" }],
          },
        ],
        field_mappings: [
          {
            from_node: "p1",
            from_field: "data",
            to_node: "consumer",
            to_field: "context.result.value",  // 중첩 경로 — 중간 키 없음 → 생성 필요
          },
        ],
      },
      { subagents: subagents as any, store: store as any, logger: noop_logger },
    );

    // consumer의 task에 "deep value"가 전달되어야 함
    expect(second_spawn_args?.task).toContain("deep value");
  });
});
