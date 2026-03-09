/**
 * AgentBackendRegistry 미커버 분기 보충 (cov2).
 * - resolve_backend with null id (L130)
 * - _get_available_for_mode continue paths (unavailable, circuit-open, disabled, wrong mode)
 * - _try_fallback catch: fb_breaker.record_failure + throw error
 * - list_backend_status priority sort
 */
import { describe, it, expect, vi } from "vitest";
import { AgentBackendRegistry } from "@src/agent/agent-registry.js";
import { FailoverError } from "@src/agent/pty/types.js";
import { CircuitBreaker } from "@src/providers/circuit-breaker.js";
import type { AgentBackend, AgentRunResult } from "@src/agent/agent.types.js";

function make_backend(
  id: string,
  opts: {
    available?: boolean;
    result?: Partial<AgentRunResult>;
    run_throws?: Error;
  } = {},
): AgentBackend {
  return {
    id,
    native_tool_loop: false,
    supports_resume: false,
    capabilities: { supported_modes: ["once", "agent"] },
    is_available: () => opts.available ?? true,
    stop: undefined,
    run: vi.fn(async (): Promise<AgentRunResult> => {
      if (opts.run_throws) throw opts.run_throws;
      return {
        content: `result:${id}`,
        session: null,
        tool_calls_count: 0,
        usage: {},
        finish_reason: opts.result?.finish_reason ?? "stop",
        metadata: {},
        ...opts.result,
      };
    }),
  };
}

const stub_registry = {
  get_health_scorer: () => ({ record: vi.fn() }),
} as unknown as import("@src/providers/service.js").ProviderRegistry;

// ══════════════════════════════════════════
// resolve_backend — null id 경로 (L130)
// ══════════════════════════════════════════

describe("AgentBackendRegistry — resolve_backend null id (L130)", () => {
  it("openrouter → resolve_backend_id=null → resolve_backend=null", () => {
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry });
    const result = reg.resolve_backend("openrouter");
    expect(result).toBeNull();
  });
});

// ══════════════════════════════════════════
// _get_available_for_mode — continue 경로들
// ══════════════════════════════════════════

describe("AgentBackendRegistry — _get_available_for_mode continue paths", () => {
  it("unavailable 백엔드 → continue 스킵", () => {
    const unavail = make_backend("unavail", { available: false });
    const avail = make_backend("avail", { available: true });
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry, backends: [unavail, avail] });
    // resolve_for_mode calls _get_available_for_mode
    const result = reg.resolve_for_mode("once");
    // unavail backend is skipped, avail returned
    expect(result?.id).toBe("avail");
  });

  it("provider_config disabled=true → continue 스킵", () => {
    const b = make_backend("disabled_b");
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry });
    reg.register(b, {
      provider_type: "claude_code",
      enabled: false,
      priority: 1,
      supported_modes: ["once", "agent"],
    });
    const result = reg.resolve_for_mode("once");
    expect(result).toBeNull();
  });

  it("provider_config supported_modes 미포함 mode → continue 스킵", () => {
    const b = make_backend("mode_restricted");
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry });
    reg.register(b, {
      provider_type: "claude_code",
      enabled: true,
      priority: 1,
      supported_modes: ["agent"],  // "once" 제외
    });
    const result = reg.resolve_for_mode("once");
    expect(result).toBeNull();
  });
});

// ══════════════════════════════════════════
// list_backend_status — priority 정렬
// ══════════════════════════════════════════

describe("AgentBackendRegistry — list_backend_status priority 정렬", () => {
  it("우선순위 다른 두 백엔드 → priority ASC 정렬 반환", () => {
    const b_high = make_backend("high_prio");
    const b_low = make_backend("low_prio");
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry });
    reg.register(b_low, {
      provider_type: "codex_cli",
      enabled: true,
      priority: 200,
      supported_modes: ["once"],
    });
    reg.register(b_high, {
      provider_type: "claude_cli",
      enabled: true,
      priority: 10,
      supported_modes: ["once"],
    });
    const statuses = reg.list_backend_status();
    const ids = statuses.map(s => s.id);
    const high_idx = ids.indexOf("high_prio");
    const low_idx = ids.indexOf("low_prio");
    expect(high_idx).toBeLessThan(low_idx);
  });
});

// ══════════════════════════════════════════
// _try_fallback catch: fb_breaker.record_failure + throw error
// ══════════════════════════════════════════

describe("AgentBackendRegistry — _try_fallback catch 경로", () => {
  it("primary 실패 + fallback도 throw → fb_breaker.record_failure + throw error", async () => {
    const primary = make_backend("primary_fail", { run_throws: new Error("primary error") });
    const fallback = make_backend("fallback_fail", { run_throws: new Error("fallback error") });

    const reg = new AgentBackendRegistry({ provider_registry: stub_registry });
    reg.register(primary, {
      provider_type: "claude_cli",
      enabled: true,
      priority: 1,
      supported_modes: ["once"],
    });
    reg.register(fallback, {
      provider_type: "codex_cli",
      enabled: true,
      priority: 2,
      supported_modes: ["once"],
    });

    // primary throw → _try_fallback(primary_id) → fallback.run throws → fb_breaker.record_failure → throw error
    await expect(reg.run("primary_fail", { task: "test" })).rejects.toThrow("fallback error");
  });
});

// ══════════════════════════════════════════
// _handle_failover_circuit default case (L267)
// ══════════════════════════════════════════

describe("AgentBackendRegistry — _handle_failover_circuit default (L267)", () => {
  it("FailoverError reason='timeout' → default 브랜치 record_failure (L267)", async () => {
    const failover_err = new FailoverError("timeout error", {
      reason: "timeout",
      provider: "claude_code",
    });
    const backend = make_backend("b_timeout", { run_throws: failover_err });
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry, backends: [backend] });
    // fallback 없으므로 _try_fallback → throw. 하지만 _handle_failover_circuit(default branch)는 실행됨
    await expect(reg.run("b_timeout", { task: "test" })).rejects.toThrow();
  });

  it("FailoverError reason='unknown' → default 브랜치 record_failure (L267)", async () => {
    const failover_err = new FailoverError("unknown error", {
      reason: "unknown",
      provider: "chatgpt",
    });
    const backend = make_backend("b_unknown", { run_throws: failover_err });
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry, backends: [backend] });
    await expect(reg.run("b_unknown", { task: "test" })).rejects.toThrow();
  });
});

// ══════════════════════════════════════════
// _circuit_state return "open" (L358)
// ══════════════════════════════════════════

describe("AgentBackendRegistry — list_backend_status circuit_state='open' (L358)", () => {
  it("서킷 브레이커가 open 상태일 때 circuit_state='open' (L358)", () => {
    // failure_threshold=1로 설정 → 1번 실패 즉시 open 상태
    const breaker = new CircuitBreaker({ failure_threshold: 1, reset_timeout_ms: 60_000 });
    breaker.record_failure(); // state=open, timeout 미경과 → can_acquire()=false

    const backend = make_backend("b_open");
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry, backends: [backend] });

    // 내부 breakers에 열린 서킷 브레이커를 주입
    (reg as any).breakers.set("b_open", breaker);

    const statuses = reg.list_backend_status();
    const b_status = statuses.find((s) => s.id === "b_open");
    expect(b_status?.circuit_state).toBe("open");
  });
});
