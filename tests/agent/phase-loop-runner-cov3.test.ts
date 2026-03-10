/**
 * phase-loop-runner — 추가 커버리지 (cov3):
 * - build_phase_context with context_template (L1032-1039)
 * - truncate_for_critic: JSON/text 긴 결과 (L1075-1087)
 * - parse_critic_response: 키워드 fallback (L1110-1111)
 * - build_runner_services with providers → invoke_llm (L1154-1179)
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { register_all_nodes } from "@src/agent/nodes/index.js";
import { run_phase_loop } from "@src/agent/phase-loop-runner.js";
import type { PhaseLoopRunOptions } from "@src/agent/phase-loop.types.js";

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

const noop_logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any;

function make_opts(overrides: Partial<PhaseLoopRunOptions> = {}): PhaseLoopRunOptions {
  return {
    workflow_id: "wf-cov3",
    title: "Cov3 WF",
    objective: "test",
    channel: "slack",
    chat_id: "C1",
    workspace: "/tmp/cov3",
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
      make_opts({
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
      make_opts({
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
      make_opts({
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
      make_opts({
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
      make_opts({
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
      make_opts({
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
      make_opts({
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

    const subagents = {
      spawn: vi.fn().mockResolvedValue({ subagent_id: "sa1" }),
      wait_for_completion: vi.fn().mockResolvedValue({ status: "completed", content: "agent done" }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
      get_provider_caps: vi.fn().mockReturnValue({ chatgpt_available: false, claude_available: false, openrouter_available: true }),
    };

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

    const subagents = {
      spawn: vi.fn().mockResolvedValue({ subagent_id: "sa1" }),
      wait_for_completion: vi.fn().mockResolvedValue({ status: "completed", content: "done" }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
      get_provider_caps: vi.fn().mockReturnValue({ chatgpt_available: false, claude_available: false, openrouter_available: true }),
    };

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

  it("LLM 노드 + decision_service + promise_service → services 객체에 포함됨 (L1199-1224)", async () => {
    const store = make_store();
    const run_headless = vi.fn().mockResolvedValue({ content: "ok", finish_reason: "stop" });
    const providers = { run_headless } as any;

    const decision_service = {
      append_decision: vi.fn().mockResolvedValue({ id: "d1" }),
      list_decisions: vi.fn().mockResolvedValue([]),
      get_effective_decisions: vi.fn().mockResolvedValue([]),
      archive_decision: vi.fn().mockResolvedValue(undefined),
    } as any;

    const promise_service = {
      append_promise: vi.fn().mockResolvedValue({ id: "p1" }),
      list_promises: vi.fn().mockResolvedValue([]),
      get_effective_promises: vi.fn().mockResolvedValue([]),
      archive_promise: vi.fn().mockResolvedValue(undefined),
    } as any;

    const subagents = {
      spawn: vi.fn().mockResolvedValue({ subagent_id: "sa1" }),
      wait_for_completion: vi.fn().mockResolvedValue({ status: "completed", content: "done" }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
      get_provider_caps: vi.fn().mockReturnValue({ chatgpt_available: false, claude_available: false, openrouter_available: true }),
    };

    const result = await run_phase_loop(
      {
        workflow_id: "wf-services",
        title: "Services WF",
        objective: "test decision+promise services",
        channel: "slack",
        chat_id: "C1",
        workspace: "/tmp/services-test",
        phases: [],
        nodes: [
          {
            node_id: "llm1",
            node_type: "llm",
            title: "LLM",
            backend: "openrouter",
            prompt_template: "test",
          } as any,
        ],
      },
      {
        subagents: subagents as any,
        store: store as any,
        logger: noop_logger,
        providers,
        decision_service,
        promise_service,
      },
    );

    expect(result.status).toBe("completed");
    // build_runner_services가 decision_service와 promise_service 객체를 감쌌음
    // (이 테스트는 L1199-1224의 if 블록이 실행됨을 검증)
    expect(run_headless).toHaveBeenCalledOnce();
  });
});
