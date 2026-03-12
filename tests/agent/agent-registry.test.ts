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

// ══════════════════════════════════════════
// Extended: register/unregister/resolve_for_mode/list_backend_status/close
// ══════════════════════════════════════════

function make_ext_backend(
  id: string,
  opts: {
    available?: boolean;
    native_tool_loop?: boolean;
    result?: Partial<AgentRunResult>;
    stop?: () => void | Promise<void>;
  } = {},
): AgentBackend {
  return {
    id,
    native_tool_loop: opts.native_tool_loop ?? false,
    supports_resume: false,
    capabilities: { supported_modes: ["once", "agent"] },
    is_available: () => opts.available ?? true,
    stop: opts.stop,
    run: vi.fn(async (): Promise<AgentRunResult> => ({
      content: `result:${id}`,
      session: null,
      tool_calls_count: 0,
      usage: {},
      finish_reason: "stop",
      metadata: {},
      ...opts.result,
    })),
  };
}

describe("AgentBackendRegistry — register / unregister", () => {
  it("register → get_backend으로 조회 가능", () => {
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry });
    const b = make_ext_backend("test_backend");
    reg.register(b);
    expect(reg.get_backend("test_backend")).toBe(b);
  });

  it("register 교체 → 기존 stop() 호출", () => {
    const stop1 = vi.fn();
    const b1 = make_ext_backend("same_id", { stop: stop1 });
    const b2 = make_ext_backend("same_id");
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry, backends: [b1] });
    reg.register(b2);
    expect(stop1).toHaveBeenCalled();
    expect(reg.get_backend("same_id")).toBe(b2);
  });

  it("register with config → provider_configs 저장", () => {
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry });
    const b = make_ext_backend("api_backend");
    reg.register(b, { provider_type: "claude", priority: 10, enabled: true, supported_modes: ["once"] });
    const status = reg.list_backend_status();
    const entry = status.find((s) => s.id === "api_backend");
    expect(entry?.priority).toBe(10);
    expect(entry?.provider_type).toBe("claude");
  });

  it("unregister → get_backend null 반환", async () => {
    const b = make_ext_backend("to_remove");
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry, backends: [b] });
    const ok = await reg.unregister("to_remove");
    expect(ok).toBe(true);
    expect(reg.get_backend("to_remove")).toBeNull();
  });

  it("unregister 없는 ID → false 반환", async () => {
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry });
    const ok = await reg.unregister("nonexistent");
    expect(ok).toBe(false);
  });

  it("unregister → stop() 호출됨", async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const b = make_ext_backend("stoppable", { stop });
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry, backends: [b] });
    await reg.unregister("stoppable");
    expect(stop).toHaveBeenCalled();
  });
});

describe("AgentBackendRegistry — resolve_backend_id", () => {
  const reg = new AgentBackendRegistry({ provider_registry: stub_registry });

  it("claude_code → claude_cli", () => {
    expect(reg.resolve_backend_id("claude_code")).toBe("claude_cli");
  });

  it("chatgpt → codex_cli", () => {
    expect(reg.resolve_backend_id("chatgpt")).toBe("codex_cli");
  });

  it("gemini → gemini_cli", () => {
    expect(reg.resolve_backend_id("gemini")).toBe("gemini_cli");
  });

  it("openrouter → null", () => {
    expect(reg.resolve_backend_id("openrouter")).toBeNull();
  });

  it("orchestrator_llm → null", () => {
    expect(reg.resolve_backend_id("orchestrator_llm")).toBeNull();
  });

  it("unknown provider → codex_cli (기본값 폴백)", () => {
    expect(reg.resolve_backend_id("some_unknown" as never)).toBe("codex_cli");
  });
});

describe("AgentBackendRegistry — resolve_for_mode (extended)", () => {
  it("available 백엔드 없음 → null", () => {
    const b = make_ext_backend("unavailable", { available: false });
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry, backends: [b] });
    expect(reg.resolve_for_mode("once")).toBeNull();
  });

  it("mode 지원 백엔드 중 priority 낮은 것 선택", () => {
    const high = make_ext_backend("high_priority");
    const low = make_ext_backend("low_priority");
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry });
    reg.register(high, { priority: 1, enabled: true, supported_modes: [], provider_type: "claude" });
    reg.register(low, { priority: 10, enabled: true, supported_modes: [], provider_type: "codex" });
    const result = reg.resolve_for_mode("once");
    expect(result?.id).toBe("high_priority");
  });

  it("skill_preferences 매칭 → 선호 백엔드 반환", () => {
    const b1 = make_ext_backend("claude_backend");
    const b2 = make_ext_backend("codex_backend");
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry });
    reg.register(b1, { priority: 10, enabled: true, supported_modes: [], provider_type: "claude" });
    reg.register(b2, { priority: 5, enabled: true, supported_modes: [], provider_type: "codex" });
    const result = reg.resolve_for_mode("once", ["codex_backend"]);
    expect(result?.id).toBe("codex_backend");
  });

  it("circuit half_open 상태: resolve_for_mode가 슬롯을 소비하지 않아야 함", async () => {
    const b = make_ext_backend("half_open_backend");
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry, backends: [b] });
    const breaker = (reg as any).breakers.get("half_open_backend");
    for (let i = 0; i < 5; i++) breaker.record_failure();
    (breaker as any).last_failure_at = Date.now() - 60_000;
    const resolved = reg.resolve_for_mode("once");
    expect(resolved?.id).toBe("half_open_backend");
    const result = await reg.run("half_open_backend", { task: "ping" });
    expect(result.finish_reason).toBe("stop");
  });
});

describe("AgentBackendRegistry — list_backend_status (extended)", () => {
  it("등록된 모든 백엔드 상태 반환", () => {
    const b1 = make_ext_backend("backend_a");
    const b2 = make_ext_backend("backend_b", { available: false });
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry, backends: [b1, b2] });
    const statuses = reg.list_backend_status();
    expect(statuses).toHaveLength(2);
    expect(statuses.find((s) => s.id === "backend_a")?.available).toBe(true);
    expect(statuses.find((s) => s.id === "backend_b")?.available).toBe(false);
  });

  it("circuit_state 포함", () => {
    const b = make_ext_backend("cb_backend");
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry, backends: [b] });
    const status = reg.list_backend_status()[0];
    expect(["closed", "open", "half_open"]).toContain(status?.circuit_state);
  });
});

describe("AgentBackendRegistry — get_backend / get_session_store / close", () => {
  it("get_backend: 존재하지 않는 ID → null", () => {
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry });
    expect(reg.get_backend("nonexistent")).toBeNull();
  });

  it("get_session_store: null when not provided", () => {
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry });
    expect(reg.get_session_store()).toBeNull();
  });

  it("get_session_store: 제공된 경우 반환", () => {
    const session_store = { save: vi.fn() } as never;
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry, session_store });
    expect(reg.get_session_store()).toBe(session_store);
  });

  it("close: 모든 백엔드 stop() 호출", async () => {
    const stop1 = vi.fn().mockResolvedValue(undefined);
    const stop2 = vi.fn();
    const b1 = make_ext_backend("b1", { stop: stop1 });
    const b2 = make_ext_backend("b2", { stop: stop2 });
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry, backends: [b1, b2] });
    await reg.close();
    expect(stop1).toHaveBeenCalled();
    expect(stop2).toHaveBeenCalled();
  });

  it("close: stop() 예외 발생해도 완료됨", async () => {
    const b = make_ext_backend("error_stop", { stop: () => { throw new Error("stop failed"); } });
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry, backends: [b] });
    await expect(reg.close()).resolves.not.toThrow();
  });
});

describe("AgentBackendRegistry — run (extended)", () => {
  it("run 성공 + finish_reason=error → breaker.record_failure", async () => {
    const b = make_ext_backend("error_result", { result: { finish_reason: "error" } });
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry, backends: [b] });
    const result = await reg.run("error_result", { task: "test" });
    expect(result.finish_reason).toBe("error");
  });

  it("run + session → session_store.save 호출", async () => {
    const mock_session = { id: "sess_001", messages: [] };
    const b = make_ext_backend("with_session", {
      result: { session: mock_session as never, finish_reason: "stop" },
    });
    const session_store = { save: vi.fn() };
    const reg = new AgentBackendRegistry({
      provider_registry: stub_registry,
      backends: [b],
      session_store: session_store as never,
    });
    await reg.run("with_session", { task: "q" });
    expect(session_store.save).toHaveBeenCalledWith(mock_session, expect.objectContaining({ task_id: undefined }));
  });
});

describe("AgentBackendRegistry — circuit breaker open → backend 제외", () => {
  it("5회 실패 후 서킷 open → resolve_for_mode = null", async () => {
    const registry = new AgentBackendRegistry({ provider_registry: stub_registry });
    const failing_cb: AgentBackend = {
      id: "cb-b1",
      native_tool_loop: false,
      supports_resume: false,
      capabilities: { supported_modes: ["once", "agent"] },
      is_available: () => true,
      run: async () => { throw new Error("provider fail"); },
    };
    registry.register(failing_cb, { priority: 1, enabled: true, supported_modes: ["once"], provider_type: "test" });
    for (let i = 0; i < 5; i++) {
      try { await registry.run("cb-b1", { task: "t", task_id: `i${i}` } as any); } catch { /* expected */ }
    }
    expect(registry.resolve_for_mode("once")).toBeNull();
  });
});

describe("AgentBackendRegistry — fallback error result → record_failure", () => {
  it("primary 실패 → fallback finish_reason=error", async () => {
    const registry = new AgentBackendRegistry({ provider_registry: stub_registry });
    const failing: AgentBackend = {
      id: "prim-b1", native_tool_loop: false, supports_resume: false,
      capabilities: { supported_modes: ["once", "agent"] }, is_available: () => true,
      run: async () => { throw new Error("primary fail"); },
    };
    registry.register(failing, { priority: 1, enabled: true, supported_modes: ["once"], provider_type: "p1" });
    registry.register(make_ext_backend("fall-b2", { result: { finish_reason: "error" } }), { priority: 2, enabled: true, supported_modes: ["once"], provider_type: "p2" });
    const result = await registry.run("prim-b1", { task: "t", task_id: "r1" } as any);
    expect(result.finish_reason).toBe("error");
  });
});

describe("AgentBackendRegistry — fallback sort comparator", () => {
  it("fallback 후보 3개 → 가장 낮은 priority 반환", async () => {
    const registry = new AgentBackendRegistry({ provider_registry: stub_registry });
    const failing: AgentBackend = {
      id: "sort-b1", native_tool_loop: false, supports_resume: false,
      capabilities: { supported_modes: ["once", "agent"] }, is_available: () => true,
      run: async () => { throw new Error("prim fail"); },
    };
    registry.register(failing, { priority: 5, enabled: true, supported_modes: ["once"], provider_type: "p1" });
    registry.register(make_ext_backend("sort-b2"), { priority: 3, enabled: true, supported_modes: ["once"], provider_type: "p2" });
    registry.register(make_ext_backend("sort-b3"), { priority: 1, enabled: true, supported_modes: ["once"], provider_type: "p3" });
    const result = await registry.run("sort-b1", { task: "t", task_id: "s1" } as any);
    expect(result.content).toBe("result:sort-b3");
  });
});

describe("AgentBackendRegistry — legacy fallback (LEGACY_FALLBACK_MAP)", () => {
  it("claude_sdk 실패 → claude_cli fallback", async () => {
    const registry = new AgentBackendRegistry({ provider_registry: stub_registry });
    const failing: AgentBackend = {
      id: "claude_sdk", native_tool_loop: false, supports_resume: false,
      capabilities: { supported_modes: ["once", "agent"] }, is_available: () => true,
      run: async () => { throw new Error("sdk fail"); },
    };
    registry.register(failing);
    registry.register(make_ext_backend("claude_cli"));
    const result = await registry.run("claude_sdk", { task: "t", task_id: "leg1" } as any);
    expect(result.content).toBe("result:claude_cli");
  });
});

describe("AgentBackendRegistry — _diff_capabilities primary undefined", () => {
  it("primary capabilities=undefined → _diff_capabilities return []", async () => {
    const registry = new AgentBackendRegistry({ provider_registry: stub_registry });
    const failing: AgentBackend = {
      id: "diff-b1", native_tool_loop: false, supports_resume: false,
      capabilities: undefined as any, is_available: () => true,
      run: async () => { throw new Error("fail"); },
    };
    registry.register(failing, { priority: 1, enabled: true, supported_modes: ["once"], provider_type: "p1" });
    registry.register(make_ext_backend("diff-b2"), { priority: 2, enabled: true, supported_modes: ["once"], provider_type: "p2" });
    const result = await registry.run("diff-b1", { task: "t", task_id: "d1" } as any);
    expect(result).toBeDefined();
  });
});

describe("AgentBackendRegistry — _diff_capabilities map 실행", () => {
  it("primary.approval=true, fallback.approval=false → filter+map 실행", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry, logger: logger as any });
    const failing: AgentBackend = {
      id: "cap-b1", native_tool_loop: false, supports_resume: false,
      capabilities: {
        approval: true, structured_output: true, thinking: false,
        budget_tracking: false, tool_filtering: false, tool_result_events: false,
        send_input: false, tool_executors: false,
      } as any,
      is_available: () => true,
      run: async () => { throw new Error("fail"); },
    };
    reg.register(failing, { priority: 1, enabled: true, supported_modes: ["once"], provider_type: "c1" });
    reg.register(make_ext_backend("cap-b2"), { priority: 2, enabled: true, supported_modes: ["once"], provider_type: "c2" });
    const result = await reg.run("cap-b1", { task: "t", task_id: "c1" } as any);
    expect(result.content).toBe("result:cap-b2");
  });
});
