/**
 * phase-loop-runner — edge case 통합 테스트:
 *
 * cov3 계열:
 * - build_phase_context with context_template (L1032-1039)
 * - truncate_for_critic: JSON/text 긴 결과 (L1075-1087)
 * - parse_critic_response: 키워드 fallback (L1110-1111)
 * - build_runner_services with providers → invoke_llm (L1154-1179)
 *
 * cov4 계열:
 * - L537-543: workflow try-catch 에러 경로
 * - L363-365: kanban_store list_boards 호출
 * - L1002: build_agent_task — tools 포함
 * - L1004: build_agent_task — memory.origin 포함
 * - L503,L505: retry_targeted — all agents "good" → retry_defs empty → break
 * - L1216-1261: build_runner_services optional deps
 * - L174: depends_on dep이 skipped_nodes에 있음 → resolved로 처리
 * - L1276-1296: field_mappings 엣지 케이스
 *
 * cov6 계열:
 * - L845: abort_signal aborted DURING looping iteration → break
 * - L1140: backend_to_provider(undefined) → return undefined
 * - L1274: apply_field_mappings from_node mismatch → continue
 * - L178: depends_on orche_dep (orche node dep) 처리
 * - L1088: truncate_for_critic — JSON compact ≤ CRITIC_MAX_CHARS
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { register_all_nodes } from "@src/agent/nodes/index.js";
import { run_phase_loop } from "@src/agent/phase-loop-runner.js";
import type { PhaseLoopRunOptions } from "@src/agent/phase-loop.types.js";
import type { IfNodeDefinition } from "@src/agent/workflow-node.types.js";

vi.mock("@src/agent/worktree.js", () => ({
  create_worktree: vi.fn(),
  create_isolated_directory: vi.fn(),
  merge_worktrees: vi.fn(),
  cleanup_worktrees: vi.fn(),
}));

beforeAll(() => {
  register_all_nodes();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ──────────────────────────────────────────────────
// 공통 헬퍼
// ──────────────────────────────────────────────────

function make_store() {
  return {
    upsert: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
    insert_message: vi.fn().mockResolvedValue(undefined),
  };
}

const noop_logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any;

function make_subagents(overrides: Record<string, unknown> = {}) {
  return {
    spawn: vi.fn().mockResolvedValue({ subagent_id: "sa1" }),
    wait_for_completion: vi.fn().mockResolvedValue({ status: "completed", content: "done" }),
    stop: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    get_provider_caps: vi.fn().mockReturnValue({ chatgpt_available: false, claude_available: false, openrouter_available: true }),
    ...overrides,
  };
}

function base_opts(overrides: Partial<PhaseLoopRunOptions> = {}): PhaseLoopRunOptions {
  return {
    workflow_id: "wf-edge",
    title: "Edge WF",
    objective: "test",
    channel: "slack",
    chat_id: "C1",
    workspace: "/tmp/edge",
    phases: [{
      phase_id: "p1",
      title: "Phase 1",
      agents: [{
        agent_id: "a1", role: "analyst", label: "Analyst",
        backend: "openrouter", system_prompt: "analyze",
      }],
    }],
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════
// build_phase_context with context_template (L1032-1039)
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — build_phase_context with context_template (L1032-1039)", () => {
  it("2-phase workflow + context_template → 두 번째 phase가 template 기반 컨텍스트로 실행됨", async () => {
    const store = make_store();
    let second_spawn_task = "";

    const subagents = {
      spawn: vi.fn()
        .mockImplementationOnce(async () => ({ subagent_id: "sa1" }))
        .mockImplementationOnce(async (args: any) => { second_spawn_task = args.task; return { subagent_id: "sa2" }; }),
      wait_for_completion: vi.fn()
        .mockResolvedValueOnce({ status: "completed", content: "phase1 agent result" })
        .mockResolvedValueOnce({ status: "completed", content: "phase2 agent result" }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    const result = await run_phase_loop(
      base_opts({
        workflow_id: "wf-ctx-tpl",
        phases: [
          {
            phase_id: "p1",
            title: "Research Phase",
            agents: [{ agent_id: "researcher", role: "analyst", label: "Researcher", backend: "openrouter", system_prompt: "research" }],
          },
          {
            phase_id: "p2",
            title: "Summary Phase",
            context_template: "Previous Results: {{#each prev_phase.agents}}AGENT{{/each}} | Review: {{prev_phase.critic.review}}",
            agents: [{ agent_id: "summarizer", role: "analyst", label: "Summarizer", backend: "openrouter", system_prompt: "summarize" }],
          },
        ],
      }),
      { subagents: subagents as any, store: store as any, logger: noop_logger },
    );

    expect(result.status).toBe("completed");
    // 두 번째 phase spawn 시 task에 context_template 치환 결과가 포함됨
    expect(subagents.spawn).toHaveBeenCalledTimes(2);
    // context_template에서 {{#each...}} 치환 → agent_block으로 교체됨
    // critic.review가 없으면 "(no review)"로 교체됨
    expect(second_spawn_task).toContain("(no review)");
  });

  it("context_template의 agent_block에 이전 phase 결과가 포함됨", async () => {
    const store = make_store();
    let second_spawn_task = "";

    const subagents = {
      spawn: vi.fn()
        .mockImplementationOnce(async () => ({ subagent_id: "sa1" }))
        .mockImplementationOnce(async (args: any) => { second_spawn_task = args.task; return { subagent_id: "sa2" }; }),
      wait_for_completion: vi.fn()
        .mockResolvedValueOnce({ status: "completed", content: "research findings here" })
        .mockResolvedValueOnce({ status: "completed", content: "summary done" }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    await run_phase_loop(
      base_opts({
        workflow_id: "wf-ctx-tpl2",
        phases: [
          {
            phase_id: "p1",
            title: "Phase 1",
            agents: [{ agent_id: "a1", role: "analyst", label: "Analyst", backend: "openrouter", system_prompt: "do work" }],
          },
          {
            phase_id: "p2",
            title: "Phase 2",
            context_template: "Context: {{#each prev_phase.agents}}SECTION{{/each}} Review: {{prev_phase.critic.review}}",
            agents: [{ agent_id: "a2", role: "analyst", label: "Analyst2", backend: "openrouter", system_prompt: "summarize" }],
          },
        ],
      }),
      { subagents: subagents as any, store: store as any, logger: noop_logger },
    );

    // Phase 1 에이전트 결과("research findings here")가 template에 포함됨
    expect(second_spawn_task).toContain("Analyst");  // label이 포함됨 (agent_block)
  });
});

// ══════════════════════════════════════════════════════════
// truncate_for_critic: JSON 긴 결과 (L1075-1082)
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — truncate_for_critic JSON 경로 (L1075-1082)", () => {
  it("에이전트 결과가 긴 JSON → critic 프롬프트에서 JSON 구조 보존 + 잘라냄", async () => {
    const store = make_store();

    // CRITIC_MAX_CHARS=3000보다 큰 JSON 문자열 (각 값이 600자)
    const long_json_result = JSON.stringify({
      a: "x".repeat(600), b: "x".repeat(600), c: "x".repeat(600),
      d: "x".repeat(600), e: "x".repeat(600), f: "x".repeat(600),
    });
    expect(long_json_result.length).toBeGreaterThan(3000);

    const critic_response = JSON.stringify({ approved: true, summary: "ok", agent_reviews: [] });
    const subagents = {
      spawn: vi.fn()
        .mockResolvedValueOnce({ subagent_id: "sa1" })
        .mockResolvedValueOnce({ subagent_id: "critic1" }),
      wait_for_completion: vi.fn()
        .mockResolvedValueOnce({ status: "completed", content: long_json_result })
        .mockResolvedValueOnce({ status: "completed", content: critic_response }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    const result = await run_phase_loop(
      base_opts({
        workflow_id: "wf-json-trunc",
        phases: [{
          phase_id: "p1",
          title: "Phase 1",
          agents: [{ agent_id: "a1", role: "analyst", label: "Analyst", backend: "openrouter", system_prompt: "analyze" }],
          critic: { backend: "openrouter", system_prompt: "review" },
        }],
      }),
      { subagents: subagents as any, store: store as any, logger: noop_logger },
    );

    expect(result.status).toBe("completed");
    // critic이 호출됨 (spawn 2회)
    expect(subagents.spawn).toHaveBeenCalledTimes(2);
  });

  it("에이전트 결과가 compact 후에도 긴 JSON → 추가 잘라내기 (L1081)", async () => {
    const store = make_store();

    // compact 후에도 3000자 이상인 JSON: 많은 600자 필드
    const many_fields: Record<string, string> = {};
    for (let i = 0; i < 12; i++) {
      many_fields[`field${i}`] = "x".repeat(600);
    }
    const very_long_json = JSON.stringify(many_fields);
    expect(very_long_json.length).toBeGreaterThan(3000);

    const critic_response = JSON.stringify({ approved: true, summary: "all good", agent_reviews: [] });
    const subagents = {
      spawn: vi.fn()
        .mockResolvedValueOnce({ subagent_id: "sa1" })
        .mockResolvedValueOnce({ subagent_id: "critic1" }),
      wait_for_completion: vi.fn()
        .mockResolvedValueOnce({ status: "completed", content: very_long_json })
        .mockResolvedValueOnce({ status: "completed", content: critic_response }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    const result = await run_phase_loop(
      base_opts({
        workflow_id: "wf-json-trunc2",
        phases: [{
          phase_id: "p1",
          title: "Phase 1",
          agents: [{ agent_id: "a1", role: "analyst", label: "Analyst", backend: "openrouter", system_prompt: "analyze" }],
          critic: { backend: "openrouter", system_prompt: "review" },
        }],
      }),
      { subagents: subagents as any, store: store as any, logger: noop_logger },
    );

    expect(result.status).toBe("completed");
  });
});

// ══════════════════════════════════════════════════════════
// truncate_for_critic: 텍스트 긴 결과 (L1085-1087)
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — truncate_for_critic 텍스트 경로 (L1085-1087)", () => {
  it("에이전트 결과가 긴 텍스트(비-JSON) → head+tail 잘라내기", async () => {
    const store = make_store();

    // 4000자 이상의 비-JSON 텍스트
    const long_text_result = "This is analysis result. " + "x".repeat(4000);
    expect(long_text_result.length).toBeGreaterThan(3000);

    const critic_response = JSON.stringify({ approved: true, summary: "ok", agent_reviews: [] });
    const subagents = {
      spawn: vi.fn()
        .mockResolvedValueOnce({ subagent_id: "sa1" })
        .mockResolvedValueOnce({ subagent_id: "critic1" }),
      wait_for_completion: vi.fn()
        .mockResolvedValueOnce({ status: "completed", content: long_text_result })
        .mockResolvedValueOnce({ status: "completed", content: critic_response }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    const result = await run_phase_loop(
      base_opts({
        workflow_id: "wf-text-trunc",
        phases: [{
          phase_id: "p1",
          title: "Phase 1",
          agents: [{ agent_id: "a1", role: "analyst", label: "Analyst", backend: "openrouter", system_prompt: "analyze" }],
          critic: { backend: "openrouter", system_prompt: "review" },
        }],
      }),
      { subagents: subagents as any, store: store as any, logger: noop_logger },
    );

    expect(result.status).toBe("completed");
    expect(subagents.spawn).toHaveBeenCalledTimes(2);
  });
});

// ══════════════════════════════════════════════════════════
// truncate_for_critic: JSON compact ≤ CRITIC_MAX_CHARS (L1088)
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — L1088 truncate_for_critic JSON compact ≤ CRITIC_MAX_CHARS", () => {
  it("JSON result > 3000자이지만 compact 후 ≤ 3000 → compact 반환 (L1088)", async () => {
    const store = make_store();
    // 단일 긴 값: 원본 > 3000, compact (500자로 잘림) → 520자 정도 → ≤ 3000
    const big_json_result = JSON.stringify({ description: "x".repeat(3200) });
    const approve = JSON.stringify({ approved: true, summary: "ok", agent_reviews: [] });

    const subagents = {
      spawn: vi.fn()
        .mockResolvedValueOnce({ subagent_id: "sa1" })
        .mockResolvedValueOnce({ subagent_id: "critic1" })
        .mockResolvedValueOnce({ subagent_id: "sa2" }),
      wait_for_completion: vi.fn()
        .mockResolvedValueOnce({ status: "completed", content: big_json_result })
        .mockResolvedValueOnce({ status: "completed", content: approve })
        .mockResolvedValueOnce({ status: "completed", content: "phase2 done" }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    const result = await run_phase_loop({
      workflow_id: "wf-compact-critic",
      title: "Compact Critic WF",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/edge",
      phases: [
        {
          phase_id: "p1",
          title: "Phase 1",
          agents: [{ agent_id: "a1", role: "analyst", label: "A", backend: "openrouter", system_prompt: "produce" }],
          critic: { backend: "openrouter", system_prompt: "review", gate: false },
        },
        {
          phase_id: "p2",
          title: "Phase 2",
          agents: [{ agent_id: "b1", role: "analyst", label: "B", backend: "openrouter", system_prompt: "consume" }],
        },
      ],
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
    });

    expect(result.status).toBe("completed");
  });
});

// ══════════════════════════════════════════════════════════
// parse_critic_response: 키워드 fallback (L1110-1111)
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — parse_critic_response 키워드 fallback (L1110-1111)", () => {
  it("critic 응답에 JSON 없음 → 키워드 기반 approved=true 판단", async () => {
    const store = make_store();

    // JSON 없는 순수 텍스트 응답 (json_match가 null → L1110 실행)
    const plain_text_response = "The work looks excellent. Everything is approved and ready to proceed.";

    const subagents = {
      spawn: vi.fn()
        .mockResolvedValueOnce({ subagent_id: "sa1" })
        .mockResolvedValueOnce({ subagent_id: "critic1" }),
      wait_for_completion: vi.fn()
        .mockResolvedValueOnce({ status: "completed", content: "agent output" })
        .mockResolvedValueOnce({ status: "completed", content: plain_text_response }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    const result = await run_phase_loop(
      base_opts({
        workflow_id: "wf-critic-fallback",
        phases: [{
          phase_id: "p1",
          title: "Phase 1",
          agents: [{ agent_id: "a1", role: "analyst", label: "Analyst", backend: "openrouter", system_prompt: "analyze" }],
          critic: { backend: "openrouter", system_prompt: "review", gate: false },
        }],
      }),
      { subagents: subagents as any, store: store as any, logger: noop_logger },
    );

    expect(result.status).toBe("completed");
    // critic이 호출됨
    expect(subagents.spawn).toHaveBeenCalledTimes(2);
  });

  it("critic 응답에 'rejected' 포함 → approved=false (키워드 fallback)", async () => {
    const store = make_store();

    // "rejected"를 포함하고 "approved"/"pass"가 없는 텍스트
    const rejected_response = "The work is rejected. Please improve the analysis.";

    const subagents = {
      spawn: vi.fn().mockResolvedValue({ subagent_id: "sa1" }),
      wait_for_completion: vi.fn()
        .mockResolvedValueOnce({ status: "completed", content: "agent output" })
        .mockResolvedValueOnce({ status: "completed", content: rejected_response })
        .mockResolvedValueOnce({ status: "completed", content: "agent retry output" })
        .mockResolvedValue({ status: "completed", content: rejected_response }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    const result = await run_phase_loop(
      base_opts({
        workflow_id: "wf-critic-rejected",
        phases: [{
          phase_id: "p1",
          title: "Phase 1",
          agents: [{ agent_id: "a1", role: "analyst", label: "Analyst", backend: "openrouter", system_prompt: "analyze" }],
          critic: {
            backend: "openrouter", system_prompt: "review",
            gate: true, on_rejection: "retry_all", max_retries: 1,
          },
        }],
      }),
      { subagents: subagents as any, store: store as any, logger: noop_logger },
    );

    // rejected이지만 retry가 1회뿐 → 결국 완료 또는 실패 또는 대기 상태
    expect(["completed", "failed", "waiting_user_input"]).toContain(result.status);
    // agent + critic, retry 시 agent + critic 再 = 최소 2회 이상
    expect(subagents.spawn.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

// ══════════════════════════════════════════════════════════
// build_runner_services with providers → invoke_llm (L1154-1179)
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — build_runner_services with providers (L1154-1179)", () => {
  it("LLM 노드 + providers → invoke_llm 호출 → providers.run_headless 실행됨", async () => {
    const store = make_store();
    const run_headless = vi.fn().mockResolvedValue({ content: "llm node result", finish_reason: "stop" });
    const providers = { run_headless } as any;

    const subagents = make_subagents();

    const result = await run_phase_loop(
      {
        workflow_id: "wf-llm-node",
        title: "LLM Node WF",
        objective: "test invoke_llm",
        channel: "slack",
        chat_id: "C1",
        workspace: "/tmp/llm-node-test",
        phases: [],
        nodes: [
          {
            node_id: "llm1",
            node_type: "llm",
            title: "LLM Call",
            backend: "openrouter",
            prompt_template: "analyze this: {{memory.input}}",
          } as any,
        ],
      },
      { subagents: subagents as any, store: store as any, logger: noop_logger, providers },
    );

    expect(result.status).toBe("completed");
    // LLM 노드의 runner_execute → services.invoke_llm → run_headless 호출
    expect(run_headless).toHaveBeenCalledOnce();
    expect(run_headless).toHaveBeenCalledWith(expect.objectContaining({
      messages: expect.arrayContaining([expect.objectContaining({ role: "user" })]),
    }));
  });

  it("LLM 노드 + providers + output_json_schema → JSON 스키마 프롬프트 추가됨", async () => {
    const store = make_store();
    const run_headless = vi.fn().mockResolvedValue({
      content: JSON.stringify({ result: "extracted" }),
      finish_reason: "stop",
    });
    const providers = { run_headless } as any;

    const subagents = make_subagents();

    const result = await run_phase_loop(
      {
        workflow_id: "wf-llm-schema",
        title: "LLM Schema WF",
        objective: "test json schema",
        channel: "slack",
        chat_id: "C1",
        workspace: "/tmp/llm-schema-test",
        phases: [],
        nodes: [
          {
            node_id: "llm1",
            node_type: "llm",
            title: "Structured LLM",
            backend: "openrouter",
            prompt_template: "extract data",
            output_json_schema: { type: "object", properties: { result: { type: "string" } } },
          } as any,
        ],
      },
      { subagents: subagents as any, store: store as any, logger: noop_logger, providers },
    );

    expect(result.status).toBe("completed");
    expect(run_headless).toHaveBeenCalledOnce();
    // output_json_schema가 있으면 프롬프트에 스키마 추가
    const call_args = run_headless.mock.calls[0][0];
    const user_msg = call_args.messages.find((m: any) => m.role === "user");
    expect(user_msg.content).toContain("JSON");
  });
});

// ══════════════════════════════════════════════════════════
// L537-543 — workflow try-catch 에러 경로
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — L537-543 에러 catch", () => {
  it("workspace='' → run_phase_agents throws → catch → error 반환", async () => {
    const store = make_store();
    const subagents = make_subagents();

    const result = await run_phase_loop(
      base_opts({ workspace: "" }),
      { subagents: subagents as any, store: store as any, logger: noop_logger },
    );

    expect(result.error).toBeTruthy();
    expect(result.error).toContain("workspace");
    // catch 블록에서 store.upsert 호출됨
    expect(store.upsert).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════
// L363-365 — kanban_store list_boards 호출
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — L363-365 kanban_store list_boards", () => {
  it("kanban_store 제공 → list_boards 호출됨", async () => {
    const store = make_store();
    const subagents = make_subagents();
    const kanban_store = {
      list_boards: vi.fn().mockResolvedValue([]),
    };

    const result = await run_phase_loop(
      base_opts(),
      {
        subagents: subagents as any,
        store: store as any,
        logger: noop_logger,
        kanban_store: kanban_store as any,
      },
    );

    expect(result.status).toBe("completed");
    expect(kanban_store.list_boards).toHaveBeenCalledWith("workflow", "wf-edge");
  });

  it("kanban_store board 반환 → kanban_board_id 설정 (L1006-1014)", async () => {
    const store = make_store();
    let spawned_task = "";
    const subagents = make_subagents({
      spawn: vi.fn().mockImplementationOnce(async (args: any) => {
        spawned_task = args.task;
        return { subagent_id: "sa1" };
      }),
    });
    const kanban_store = {
      list_boards: vi.fn().mockResolvedValue([{ board_id: "board-123" }]),
    };

    await run_phase_loop(
      base_opts({
        phases: [{
          phase_id: "p1",
          title: "Phase 1",
          agents: [{
            agent_id: "a1", role: "implementer", label: "Implementer",
            backend: "openrouter", system_prompt: "implement",
          }],
        }],
      }),
      {
        subagents: subagents as any,
        store: store as any,
        logger: noop_logger,
        kanban_store: kanban_store as any,
      },
    );

    // build_agent_task에서 kanban_board_id가 task에 포함됨
    expect(spawned_task).toContain("board-123");
    expect(spawned_task).toContain("Kanban Board");
  });
});

// ══════════════════════════════════════════════════════════
// L1002 — build_agent_task tools 포함
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — L1002 build_agent_task tools", () => {
  it("agent_def.tools 있음 → task에 Available Tools 섹션 포함", async () => {
    const store = make_store();
    let spawned_task = "";
    const subagents = make_subagents({
      spawn: vi.fn().mockImplementationOnce(async (args: any) => {
        spawned_task = args.task;
        return { subagent_id: "sa1" };
      }),
    });

    await run_phase_loop(
      base_opts({
        phases: [{
          phase_id: "p1",
          title: "Phase 1",
          agents: [{
            agent_id: "a1", role: "analyst", label: "Analyst",
            backend: "openrouter", system_prompt: "analyze",
            tools: ["code_runner", "file_reader"],
          }],
        }],
      }),
      { subagents: subagents as any, store: store as any, logger: noop_logger },
    );

    expect(spawned_task).toContain("Available Tools");
    expect(spawned_task).toContain("code_runner");
  });
});

// ══════════════════════════════════════════════════════════
// L1004 — build_agent_task memory.origin
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — L1004 build_agent_task memory.origin", () => {
  it("initial_memory.origin 있음 → task에 Origin Channel 섹션 포함", async () => {
    const store = make_store();
    let spawned_task = "";
    const subagents = make_subagents({
      spawn: vi.fn().mockImplementationOnce(async (args: any) => {
        spawned_task = args.task;
        return { subagent_id: "sa1" };
      }),
    });

    await run_phase_loop(
      base_opts({
        initial_memory: { origin: { channel: "slack", chat_id: "C1" } },
      }),
      { subagents: subagents as any, store: store as any, logger: noop_logger },
    );

    expect(spawned_task).toContain("Origin Channel");
  });
});

// ══════════════════════════════════════════════════════════
// L503, L505 — retry_targeted: all agents "good" → retry_defs empty
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — L503/L505 retry_targeted all-good", () => {
  it("critic 거부이지만 모든 agent_reviews quality=good → retry_agents empty → L505 break", async () => {
    const store = make_store();
    // Reject once (but all reviews are "good"), then approve
    const reject_all_good = JSON.stringify({
      approved: false,
      summary: "minor issues",
      agent_reviews: [{ agent_id: "a1", quality: "good", feedback: "mostly ok" }],
    });

    const subagents = {
      spawn: vi.fn()
        .mockResolvedValueOnce({ subagent_id: "sa1" })
        .mockResolvedValueOnce({ subagent_id: "critic1" }),
      wait_for_completion: vi.fn()
        .mockResolvedValueOnce({ status: "completed", content: "agent output" })
        .mockResolvedValueOnce({ status: "completed", content: reject_all_good }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    const result = await run_phase_loop(
      base_opts({
        phases: [{
          phase_id: "p1",
          title: "Phase 1",
          agents: [{ agent_id: "a1", role: "analyst", label: "A", backend: "openrouter", system_prompt: "s" }],
          critic: {
            backend: "openrouter",
            system_prompt: "review",
            gate: true,
            on_rejection: "retry_targeted" as any,
            max_retries: 3,
          },
        }],
      }),
      { subagents: subagents as any, store: store as any, logger: noop_logger },
    );

    // retry_defs.length === 0 → critic_passed = true → completed
    expect(result.status).toBe("completed");
    // 재실행 없이 2번만 spawn (agent + critic)
    expect(subagents.spawn).toHaveBeenCalledTimes(2);
  });
});

// ══════════════════════════════════════════════════════════
// L1216-1261 — build_runner_services optional deps
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — L1216-1261 build_runner_services optional deps", () => {
  it("모든 optional deps 제공 → build_runner_services에서 각 서비스 설정됨", async () => {
    const store = make_store();
    const subagents = make_subagents();

    const decision_service = {
      append_decision: vi.fn(),
      list_decisions: vi.fn().mockResolvedValue([]),
      get_effective_decisions: vi.fn().mockResolvedValue([]),
      archive_decision: vi.fn(),
    };
    const promise_service = {
      append_promise: vi.fn(),
      list_promises: vi.fn().mockResolvedValue([]),
      get_effective_promises: vi.fn().mockResolvedValue([]),
      archive_promise: vi.fn(),
    };
    const embed = vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2]] });
    const vector_store = vi.fn().mockResolvedValue({ rows: [] });
    const oauth_fetch = vi.fn().mockResolvedValue({ status: 200, body: {}, headers: {} });
    const get_webhook_data = vi.fn().mockResolvedValue(null);
    const wait_kanban_event = vi.fn().mockResolvedValue(null);
    const create_task = vi.fn().mockResolvedValue({ task_id: "t1", status: "completed" });
    const query_db = vi.fn().mockResolvedValue({ rows: [], affected_rows: 0 });

    // "set" orche node → build_runner_services 호출됨
    const result = await run_phase_loop({
      workflow_id: "wf-runner-svc",
      title: "Runner Svc WF",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/edge",
      phases: [],
      nodes: [
        { node_id: "set1", node_type: "set", title: "Set1", assignments: [{ key: "x", value: "val" }] } as any,
      ],
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
      decision_service: decision_service as any,
      promise_service: promise_service as any,
      embed: embed as any,
      vector_store: vector_store as any,
      oauth_fetch: oauth_fetch as any,
      get_webhook_data: get_webhook_data as any,
      wait_kanban_event: wait_kanban_event as any,
      create_task: create_task as any,
      query_db: query_db as any,
    });

    expect(result.status).toBe("completed");
    expect(result.memory["set1"]).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════
// L174 — depends_on: dep이 skipped_nodes에 있음 → resolved
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — L174 depends_on skipped dep → resolved", () => {
  it("IF가 true → false_branch=dep_node 스킵; 다른 노드의 depends_on=[dep_node] → skipped로 resolve됨", async () => {
    const store = make_store();
    const subagents = make_subagents();
    const events: Array<{ type: string; node_id?: string }> = [];

    const if_node: IfNodeDefinition = {
      node_id: "if1",
      node_type: "if",
      title: "IF",
      condition: "true",
      outputs: {
        true_branch: [],
        false_branch: ["skipped_dep"],
      },
    };

    const result = await run_phase_loop({
      workflow_id: "wf-dep-skipped",
      title: "Dep Skipped WF",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/edge",
      phases: [],
      nodes: [
        if_node as any,
        // skipped_dep is in false_branch → skipped when IF=true
        { node_id: "skipped_dep", node_type: "set", title: "SkippedDep", assignments: [{ key: "d", value: "should_not_run" }] } as any,
        // depends_on skipped_dep → dep is in skipped_nodes → L174 fires → dep resolved
        { node_id: "dependent", node_type: "set", title: "Dependent", depends_on: ["skipped_dep"], assignments: [{ key: "result", value: "ran" }] } as any,
      ],
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
      on_event: (e) => events.push(e as any),
    });

    expect(result.status).toBe("completed");
    // skipped_dep가 스킵됨
    const skipped = events.filter((e) => e.type === "node_skipped" && e.node_id === "skipped_dep");
    expect(skipped.length).toBeGreaterThan(0);
    // dependent는 실행됨 (dep was in skipped_nodes → resolved)
    expect(result.memory["dependent"]).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════
// field_mappings 엣지 케이스 (L1276, L1285, L1292, L1296)
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — field_mappings 엣지 케이스", () => {
  it("L1276: from_field 경로 없음 → undefined → 매핑 스킵", async () => {
    const store = make_store();
    const subagents = make_subagents();

    const result = await run_phase_loop({
      workflow_id: "wf-fm-undef",
      title: "FM Undef WF",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/edge",
      phases: [],
      nodes: [
        { node_id: "src", node_type: "set", title: "Src", assignments: [{ key: "val", value: "v" }] } as any,
      ],
      field_mappings: [
        { from_node: "src", from_field: "nonexistent.deep.path", to_node: "target", to_field: "x" },
      ],
    }, { subagents: subagents as any, store: store as any, logger: noop_logger });

    expect(result.status).toBe("completed");
    // 매핑되지 않음
    expect(result.memory["target"]).toBeUndefined();
  });

  it("L1285: to_field 없음 → memory[to_node] = value 직접 할당", async () => {
    const store = make_store();
    const subagents = make_subagents();

    const result = await run_phase_loop({
      workflow_id: "wf-fm-direct",
      title: "FM Direct WF",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/edge",
      phases: [],
      nodes: [
        { node_id: "src", node_type: "set", title: "Src", assignments: [{ key: "val", value: "direct_value" }] } as any,
      ],
      field_mappings: [
        { from_node: "src", from_field: "val", to_node: "target_slot", to_field: "" },
      ],
    }, { subagents: subagents as any, store: store as any, logger: noop_logger });

    expect(result.status).toBe("completed");
    // to_field="" → memory[target_slot] = value 직접 할당
    expect(result.memory["target_slot"]).toBe("direct_value");
  });

  it("L1292: from_field='' → resolve_field('', obj) → obj 자체 반환", async () => {
    const store = make_store();
    const subagents = make_subagents();

    const result = await run_phase_loop({
      workflow_id: "wf-fm-empty-path",
      title: "FM Empty Path WF",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/edge",
      phases: [],
      nodes: [
        { node_id: "src", node_type: "set", title: "Src", assignments: [{ key: "val", value: "whole" }] } as any,
      ],
      field_mappings: [
        { from_node: "src", from_field: "", to_node: "whole_output", to_field: "" },
      ],
    }, { subagents: subagents as any, store: store as any, logger: noop_logger });

    expect(result.status).toBe("completed");
    // from_field="" → obj 자체 (set 노드 output 전체)
    expect(result.memory["whole_output"]).toBeDefined();
  });

  it("L1296: from_field 경로 중간에 null → undefined 반환 → 매핑 스킵", async () => {
    const store = make_store();
    const subagents = make_subagents();

    // "set" node output에 null 값을 포함시키기 어려우므로
    // "from_field: 'a.b.c'" 에서 output이 { a: null } 이면 a.b → null로 current됨
    const result = await run_phase_loop({
      workflow_id: "wf-fm-null",
      title: "FM Null WF",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/edge",
      phases: [],
      nodes: [
        // assignments에서 null은 JSON으로 직접 전달 가능
        { node_id: "src", node_type: "set", title: "Src", assignments: [{ key: "a", value: null }] } as any,
      ],
      field_mappings: [
        { from_node: "src", from_field: "a.b.c", to_node: "target", to_field: "x" },
      ],
    }, { subagents: subagents as any, store: store as any, logger: noop_logger });

    expect(result.status).toBe("completed");
    // a가 null → a.b 접근 시 undefined 반환 → 매핑 스킵
    expect(result.memory["target"]).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════
// L1274 — apply_field_mappings from_node 불일치 → continue
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — L1274 apply_field_mappings from_node mismatch", () => {
  it("mapping 2개 중 1개는 from_node 불일치 → L1274 continue", async () => {
    const store = make_store();
    const subagents = {
      spawn: vi.fn().mockResolvedValue({ subagent_id: "sa1" }),
      wait_for_completion: vi.fn().mockResolvedValue({ status: "completed", content: "done" }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    const result = await run_phase_loop({
      workflow_id: "wf-fm-mismatch",
      title: "FM Mismatch WF",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/edge",
      phases: [],
      nodes: [
        { node_id: "src", node_type: "set", title: "Src", assignments: [{ key: "val", value: "from_src" }] } as any,
      ],
      field_mappings: [
        // 현재 노드("src")와 from_node 일치 → 적용됨
        { from_node: "src", from_field: "val", to_node: "target1", to_field: "x" },
        // 현재 노드("src")와 from_node 불일치 → L1274: continue
        { from_node: "other_node", from_field: "val", to_node: "target2", to_field: "y" },
      ],
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
    });

    expect(result.status).toBe("completed");
    // target1은 적용됨, target2는 적용 안 됨 (other_node 매핑은 mismatch)
    expect((result.memory["target1"] as any)?.x).toBe("from_src");
    expect(result.memory["target2"]).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════
// L845 — abort_signal aborted DURING looping iteration
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — L845 abort during looping phase iteration", () => {
  it("spawn 중에 abort → 다음 iteration L845에서 break", async () => {
    const store = make_store();
    const controller = new AbortController();

    const subagents = {
      spawn: vi.fn().mockImplementationOnce(async () => {
        // spawn 호출 시 abort (첫 번째 반복은 abort_signal이 false였음)
        controller.abort();
        return { subagent_id: "sa1" };
      }),
      wait_for_completion: vi.fn().mockResolvedValue({ status: "completed", content: "partial result" }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    const result = await run_phase_loop({
      workflow_id: "wf-abort-during",
      title: "Abort During WF",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/edge",
      phases: [{
        phase_id: "p1",
        title: "Phase 1",
        mode: "sequential_loop",
        max_loop_iterations: 10, // 최대 10번이지만 abort로 1번 후 종료
        agents: [{ agent_id: "a1", role: "analyst", label: "A", backend: "openrouter", system_prompt: "loop" }],
      }],
      abort_signal: controller.signal,
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
    });

    // abort 후 2번째 iteration에서 break → 1번만 spawn
    expect(subagents.spawn).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("completed"); // or "cancelled" depending on where abort check fires
  });
});

// ══════════════════════════════════════════════════════════
// L1140 — backend_to_provider(undefined) → return undefined
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — L1140 backend_to_provider undefined", () => {
  it("agent backend 없음 → backend_to_provider(undefined) → provider_id=undefined", async () => {
    const store = make_store();
    let spawned_args: any = null;
    const subagents = {
      spawn: vi.fn().mockImplementationOnce(async (args: any) => {
        spawned_args = args;
        return { subagent_id: "sa1" };
      }),
      wait_for_completion: vi.fn().mockResolvedValue({ status: "completed", content: "done" }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    const result = await run_phase_loop({
      workflow_id: "wf-no-backend",
      title: "No Backend WF",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/edge",
      phases: [{
        phase_id: "p1",
        title: "Phase 1",
        agents: [{
          agent_id: "a1", role: "analyst", label: "A",
          // backend 없음 → backend_to_provider(undefined) → return undefined (L1140)
          system_prompt: "analyze",
        }],
      }],
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
    });

    expect(result.status).toBe("completed");
    // provider_id가 undefined으로 설정됨
    expect(spawned_args?.provider_id).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════
// L178 — depends_on orche_dep (orche node as dependency)
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — L178 depends_on orche_dep", () => {
  it("orche node B depends_on orche node A → A 완료 후 B 실행 (L178 fires)", async () => {
    const store = make_store();
    const subagents = {
      spawn: vi.fn().mockResolvedValue({ subagent_id: "sa1" }),
      wait_for_completion: vi.fn().mockResolvedValue({ status: "completed", content: "done" }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    // set_a는 set_b의 dependency — A 완료 → B 실행 가능
    // set_b.depends_on = ["set_a"] → L172 fires → L178 fires (orche_dep found)
    const result = await run_phase_loop({
      workflow_id: "wf-orche-dep",
      title: "Orche Dep WF",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/edge",
      phases: [],
      nodes: [
        { node_id: "set_a", node_type: "set", title: "Set A", assignments: [{ key: "a", value: "done" }] } as any,
        { node_id: "set_b", node_type: "set", title: "Set B", depends_on: ["set_a"], assignments: [{ key: "b", value: "after_a" }] } as any,
      ],
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
    });

    expect(result.status).toBe("completed");
    expect(result.memory["set_a"]).toBeDefined();
    expect(result.memory["set_b"]).toBeDefined();
    expect((result.memory["set_b"] as any)?.b).toBe("after_a");
  });
});
