import { describe, it, expect, vi } from "vitest";
import { build_dashboard_state } from "@src/dashboard/state-builder.ts";
import type { ValidatorSummary } from "@src/repo-profile/validator-summary-adapter.ts";

function make_full_options(overrides: Record<string, unknown> = {}) {
  return {
    agent: {
      list_runtime_tasks: vi.fn(() => []),
      list_stored_tasks: vi.fn(async () => []),
      list_subagents: vi.fn(() => []),
      list_approval_requests: vi.fn(() => []),
      list_active_loops: vi.fn(() => []),
    },
    bus: { get_sizes: vi.fn(() => ({ inbound: 0, outbound: 0 })) },
    channels: {
      get_status: vi.fn(() => ({ enabled_channels: [], mention_loop_running: false })),
      get_channel_health: vi.fn(() => []),
      get_active_run_count: vi.fn(() => 0),
    },
    ops: { status: vi.fn(() => ({})) },
    heartbeat: { status: vi.fn(() => ({})) },
    process_tracker: {
      list_active: vi.fn(() => []),
      list_recent: vi.fn(() => []),
    },
    cron: {
      status: vi.fn(async () => ({ running: true })),
      list_jobs: vi.fn(async () => []),
    },
    decisions: { get_effective_decisions: vi.fn(async () => []) },
    promises: { get_effective_promises: vi.fn(async () => []) },
    events: { list: vi.fn(async () => []) },
    stats_ops: { get_cd_score: vi.fn(() => 42) },
    agent_provider_ops: { list: vi.fn(async () => []) },
    ...overrides,
  } as any;
}

// ── validator_summary_ops ─────────────────────────────────────────────────────

describe("build_dashboard_state — validator_summary_ops", () => {
  it("validator_summary_ops 미설정 시 validator_summary는 undefined", async () => {
    const state = await build_dashboard_state(make_full_options(), []);
    expect(state.validator_summary).toBeUndefined();
  });

  it("validator_summary_ops.get_latest() → null이면 validator_summary는 undefined", async () => {
    const opts = make_full_options({
      validator_summary_ops: { get_latest: vi.fn(() => null) },
    });
    const state = await build_dashboard_state(opts, []);
    expect(state.validator_summary).toBeUndefined();
  });

  it("validator_summary_ops.get_latest() → ValidatorSummary이면 state에 포함", async () => {
    const summary: ValidatorSummary = {
      repo_id: "my-repo",
      total_validators: 3,
      passed_validators: 2,
      failed_validators: [{ kind: "test", command: "vitest run", output: "1 failed" }],
      created_at: "2026-01-01T00:00:00.000Z",
    };
    const opts = make_full_options({
      validator_summary_ops: { get_latest: vi.fn(() => summary) },
    });
    const state = await build_dashboard_state(opts, []);
    const vs = state.validator_summary as ValidatorSummary;
    expect(vs.repo_id).toBe("my-repo");
    expect(vs.total_validators).toBe(3);
    expect(vs.passed_validators).toBe(2);
    expect(vs.failed_validators).toHaveLength(1);
    expect(vs.failed_validators[0].kind).toBe("test");
  });

  it("validator_summary_ops.get_latest()가 통과 요약이면 failed_validators 빈 배열", async () => {
    const summary: ValidatorSummary = {
      repo_id: "clean-repo",
      total_validators: 2,
      passed_validators: 2,
      failed_validators: [],
      created_at: "2026-01-01T00:00:00.000Z",
    };
    const opts = make_full_options({
      validator_summary_ops: { get_latest: vi.fn(() => summary) },
    });
    const state = await build_dashboard_state(opts, []);
    const vs = state.validator_summary as ValidatorSummary;
    expect(vs.failed_validators).toHaveLength(0);
  });
});

// ── PhaseLoopState artifact_bundle ────────────────────────────────────────────

describe("PhaseLoopState artifact_bundle field", () => {
  it("artifact_bundle 필드가 있으면 state에 포함된다 (타입 레벨 검증)", () => {
    // PhaseLoopState의 artifact_bundle?는 optional — 없으면 undefined
    const state: import("@src/agent/phase-loop.types.ts").PhaseLoopState = {
      workflow_id: "wf-1",
      title: "Test",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      status: "completed",
      current_phase: 0,
      phases: [],
      memory: {},
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:01Z",
      artifact_bundle: {
        repo_id: "my-repo",
        created_at: "2026-01-01T00:00:00.000Z",
        is_passing: true,
        total_validators: 2,
        passed_validators: 2,
        failed_kinds: [],
      },
    };
    expect(state.artifact_bundle?.repo_id).toBe("my-repo");
    expect(state.artifact_bundle?.is_passing).toBe(true);
    expect(state.artifact_bundle?.failed_kinds).toHaveLength(0);
  });

  it("artifact_bundle 미설정 시 undefined", () => {
    const state: import("@src/agent/phase-loop.types.ts").PhaseLoopState = {
      workflow_id: "wf-2",
      title: "Test",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      status: "running",
      current_phase: 0,
      phases: [],
      memory: {},
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    expect(state.artifact_bundle).toBeUndefined();
  });

  it("is_passing=false이면 failed_kinds에 실패 항목이 있다", () => {
    const state: import("@src/agent/phase-loop.types.ts").PhaseLoopState = {
      workflow_id: "wf-3",
      title: "Test",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      status: "failed",
      current_phase: 0,
      phases: [],
      memory: {},
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      artifact_bundle: {
        repo_id: "failing-repo",
        created_at: "2026-01-01T00:00:00.000Z",
        is_passing: false,
        total_validators: 3,
        passed_validators: 1,
        failed_kinds: ["test", "typecheck"],
      },
    };
    expect(state.artifact_bundle?.is_passing).toBe(false);
    expect(state.artifact_bundle?.failed_kinds).toEqual(["test", "typecheck"]);
  });
});
