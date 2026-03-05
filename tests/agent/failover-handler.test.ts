import { describe, it, expect, vi } from "vitest";
import { AgentBackendRegistry } from "../../src/agent/agent-registry.js";
import { FailoverError } from "../../src/agent/pty/types.js";
import type { AgentBackend, AgentProviderConfig, AgentRunResult, BackendCapabilities } from "../../src/agent/agent.types.js";

const STUB_CAPABILITIES: BackendCapabilities = {
  approval: false, structured_output: false, thinking: false,
  budget_tracking: false, tool_filtering: false, tool_result_events: false,
  send_input: false, tool_executors: false,
};

function make_backend(
  id: string,
  opts: { available?: boolean; run_fn?: () => Promise<AgentRunResult> } = {},
): AgentBackend {
  return {
    id,
    native_tool_loop: false,
    supports_resume: false,
    capabilities: STUB_CAPABILITIES,
    is_available: () => opts.available ?? true,
    run: opts.run_fn ?? vi.fn(async (): Promise<AgentRunResult> => ({
      content: `ok:${id}`, session: null, tool_calls_count: 0,
      usage: {}, finish_reason: "stop", metadata: {},
    })),
  };
}

function make_config(id: string, priority: number): AgentProviderConfig {
  return {
    instance_id: id,
    provider_type: id,
    label: id,
    enabled: true,
    priority,
    supported_modes: [],
    settings: {},
    created_at: "",
    updated_at: "",
  };
}

/** provider_configs 기반 동적 fallback이 동작하도록 register()로 등록. */
function make_registry(
  backends: AgentBackend[],
  extra?: { logger?: import("../../src/logger.js").Logger },
): AgentBackendRegistry {
  const registry = new AgentBackendRegistry({
    provider_registry: {
      get_health_scorer: () => ({ record: vi.fn() }),
    } as unknown as import("../../src/providers/service.js").ProviderRegistry,
    logger: extra?.logger,
  });
  backends.forEach((b, i) => registry.register(b, make_config(b.id, i + 1)));
  return registry;
}

describe("AgentBackendRegistry — FailoverError 핸들링", () => {
  it("FailoverError(auth) 발생 시 fallback 백엔드로 전환한다", async () => {
    const primary = make_backend("claude_cli", {
      run_fn: async () => {
        throw new FailoverError("all profiles exhausted", { reason: "auth", provider: "claude" });
      },
    });
    const fallback = make_backend("codex_cli");
    const registry = make_registry([primary, fallback]);

    const result = await registry.run("claude_cli", { task: "test" });
    expect(result.content).toBe("ok:codex_cli");
    expect(result.finish_reason).toBe("stop");
  });

  it("FailoverError(auth/quota) 시 circuit breaker를 강하게 차단한다 (5회 failure)", async () => {
    const primary = make_backend("claude_cli", {
      run_fn: async () => {
        throw new FailoverError("quota exceeded", { reason: "quota", provider: "claude" });
      },
    });
    const fallback = make_backend("codex_cli");
    const registry = make_registry([primary, fallback]);

    await registry.run("claude_cli", { task: "test" });

    // primary가 circuit open 상태 → 두번째 호출도 fallback
    const result2 = await registry.run("claude_cli", { task: "test2" });
    expect(result2.content).toBe("ok:codex_cli");
  });

  it("FailoverError(rate_limit) 시 circuit breaker를 1회만 기록한다", async () => {
    let call_count = 0;
    const primary = make_backend("claude_cli", {
      run_fn: async () => {
        call_count++;
        if (call_count === 1) {
          throw new FailoverError("rate limited", { reason: "rate_limit", provider: "claude" });
        }
        return { content: "recovered", session: null, tool_calls_count: 0, usage: {}, finish_reason: "stop", metadata: {} };
      },
    });
    const fallback = make_backend("codex_cli");
    const registry = make_registry([primary, fallback]);

    // 첫 호출: rate_limit → fallback
    const r1 = await registry.run("claude_cli", { task: "test" });
    expect(r1.content).toBe("ok:codex_cli");

    // 두번째 호출: 1회 failure만 기록 → circuit still closed → primary 시도
    const r2 = await registry.run("claude_cli", { task: "test2" });
    expect(r2.content).toBe("recovered");
  });

  it("일반 Error 발생 시에도 fallback으로 전환한다", async () => {
    const primary = make_backend("claude_cli", {
      run_fn: async () => { throw new Error("generic crash"); },
    });
    const fallback = make_backend("codex_cli");
    const registry = make_registry([primary, fallback]);

    const result = await registry.run("claude_cli", { task: "test" });
    expect(result.content).toBe("ok:codex_cli");
  });

  it("fallback도 없으면 에러를 던진다", async () => {
    const primary = make_backend("claude_cli", {
      run_fn: async () => {
        throw new FailoverError("auth fail", { reason: "auth", provider: "claude" });
      },
    });
    // primary만 등록 — fallback 없음
    const registry = make_registry([primary]);

    await expect(registry.run("claude_cli", { task: "test" }))
      .rejects.toThrow("auth fail");
  });

  it("FailoverError의 meta 정보가 로그에 전달된다", async () => {
    const warn_spy = vi.fn();
    const primary = make_backend("claude_cli", {
      run_fn: async () => {
        throw new FailoverError("profile exhausted", {
          reason: "auth",
          provider: "claude",
          model: "claude-sonnet-4-6",
          profile_id: "profile-1",
        });
      },
    });
    const fallback = make_backend("codex_cli");
    const registry = make_registry([primary, fallback], {
      logger: { warn: warn_spy, info: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as import("../../src/logger.js").Logger,
    });

    await registry.run("claude_cli", { task: "test" });

    expect(warn_spy).toHaveBeenCalledWith("backend_failover", expect.objectContaining({
      backend: "claude_cli",
      reason: "auth",
      provider: "claude",
      model: "claude-sonnet-4-6",
    }));
  });

  it("FailoverError vs 일반 Error: 동일 조건에서 circuit breaker 동작이 다르다", async () => {
    // FailoverError(auth) → 5회 failure → circuit open
    const primary_a = make_backend("backend_a", {
      run_fn: async () => {
        throw new FailoverError("auth", { reason: "auth", provider: "p" });
      },
    });
    const fallback_a = make_backend("fallback_a");
    const reg_a = make_registry([primary_a, fallback_a]);

    await reg_a.run("backend_a", { task: "t" });
    // auth → 5회 failure → circuit open → 두번째 호출도 fallback
    const r_a = await reg_a.run("backend_a", { task: "t2" });
    expect(r_a.content).toBe("ok:fallback_a");

    // 일반 Error → 1회 failure → circuit still closed
    let gen_count = 0;
    const primary_b = make_backend("backend_b", {
      run_fn: async () => {
        gen_count++;
        if (gen_count === 1) throw new Error("generic");
        return { content: "recovered_b", session: null, tool_calls_count: 0, usage: {}, finish_reason: "stop" as const, metadata: {} };
      },
    });
    const fallback_b = make_backend("fallback_b");
    const reg_b = make_registry([primary_b, fallback_b]);

    await reg_b.run("backend_b", { task: "t" });
    // generic → 1회 failure → circuit still closed → primary 시도
    const r_b = await reg_b.run("backend_b", { task: "t2" });
    expect(r_b.content).toBe("recovered_b");
  });
});
