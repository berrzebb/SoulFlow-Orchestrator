/**
 * AgentBackendRegistry 미커버 브랜치 보완.
 * register/unregister/resolve_for_mode/list_backend_status/close 등.
 */
import { describe, it, expect, vi } from "vitest";
import { AgentBackendRegistry } from "@src/agent/agent-registry.js";
import type { AgentBackend, AgentRunResult } from "@src/agent/agent.types.js";

// ── 헬퍼 ──────────────────────────────────────────────────

function make_backend(
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

const stub_registry = {
  get_health_scorer: () => ({ record: vi.fn() }),
} as unknown as import("@src/providers/service.js").ProviderRegistry;

// ══════════════════════════════════════════
// register / unregister
// ══════════════════════════════════════════

describe("AgentBackendRegistry — register / unregister", () => {
  it("register → get_backend으로 조회 가능", () => {
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry });
    const b = make_backend("test_backend");
    reg.register(b);
    expect(reg.get_backend("test_backend")).toBe(b);
  });

  it("register 교체 → 기존 stop() 호출", () => {
    const stop1 = vi.fn();
    const b1 = make_backend("same_id", { stop: stop1 });
    const b2 = make_backend("same_id");
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry, backends: [b1] });
    reg.register(b2);
    expect(stop1).toHaveBeenCalled();
    expect(reg.get_backend("same_id")).toBe(b2);
  });

  it("register with config → provider_configs 저장", () => {
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry });
    const b = make_backend("api_backend");
    reg.register(b, { provider_type: "claude", priority: 10, enabled: true, supported_modes: ["once"] });
    const status = reg.list_backend_status();
    const entry = status.find((s) => s.id === "api_backend");
    expect(entry?.priority).toBe(10);
    expect(entry?.provider_type).toBe("claude");
  });

  it("unregister → get_backend null 반환", async () => {
    const b = make_backend("to_remove");
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
    const b = make_backend("stoppable", { stop });
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry, backends: [b] });
    await reg.unregister("stoppable");
    expect(stop).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════
// resolve_backend_id (다양한 providers)
// ══════════════════════════════════════════

describe("AgentBackendRegistry — resolve_backend_id", () => {
  const reg = new AgentBackendRegistry({ provider_registry: stub_registry });

  it("claude_code → claude_cli (기본값)", () => {
    expect(reg.resolve_backend_id("claude_code")).toBe("claude_cli");
  });

  it("chatgpt → codex_cli (기본값)", () => {
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

  it("gemini_backend 없음 → gemini_cli 폴백", () => {
    const reg2 = new AgentBackendRegistry({
      provider_registry: stub_registry,
      config: { claude_backend: "claude_cli", codex_backend: "codex_cli" },
    });
    expect(reg2.resolve_backend_id("gemini")).toBe("gemini_cli");
  });
});

// ══════════════════════════════════════════
// resolve_for_mode
// ══════════════════════════════════════════

describe("AgentBackendRegistry — resolve_for_mode", () => {
  it("available 백엔드 없음 → null 반환", () => {
    const b = make_backend("unavailable", { available: false });
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry, backends: [b] });
    expect(reg.resolve_for_mode("once")).toBeNull();
  });

  it("mode 지원 백엔드 중 priority 낮은 것 선택", () => {
    const high = make_backend("high_priority");
    const low = make_backend("low_priority");
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry });
    reg.register(high, { priority: 1, enabled: true, supported_modes: [], provider_type: "claude" });
    reg.register(low, { priority: 10, enabled: true, supported_modes: [], provider_type: "codex" });
    const result = reg.resolve_for_mode("once");
    expect(result?.id).toBe("high_priority");
  });

  it("skill_preferences 매칭 → 선호 백엔드 반환", () => {
    const b1 = make_backend("claude_backend");
    const b2 = make_backend("codex_backend");
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry });
    reg.register(b1, { priority: 10, enabled: true, supported_modes: [], provider_type: "claude" });
    reg.register(b2, { priority: 5, enabled: true, supported_modes: [], provider_type: "codex" });
    // codex_backend를 skill preference로 지정
    const result = reg.resolve_for_mode("once", ["codex_backend"]);
    expect(result?.id).toBe("codex_backend");
  });

  it("skill_preferences provider_type 매칭", () => {
    const b = make_backend("my_claude");
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry });
    reg.register(b, { priority: 5, enabled: true, supported_modes: [], provider_type: "claude" });
    const result = reg.resolve_for_mode("once", ["claude"]);
    expect(result?.id).toBe("my_claude");
  });

  it("disabled 백엔드 → 결과에서 제외", () => {
    const b = make_backend("disabled_b");
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry });
    reg.register(b, { priority: 1, enabled: false, supported_modes: [], provider_type: "claude" });
    expect(reg.resolve_for_mode("once")).toBeNull();
  });

  it("supported_modes 불일치 → 결과에서 제외", () => {
    const b = make_backend("agent_only");
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry });
    reg.register(b, { priority: 1, enabled: true, supported_modes: ["agent"], provider_type: "claude" });
    expect(reg.resolve_for_mode("once")).toBeNull();
  });

  it("circuit half_open 상태 백엔드: resolve_for_mode가 슬롯을 소비하지 않아야 run()에서 허용됨", async () => {
    // half_open_max=1인 breaker를 가진 백엔드
    const b = make_backend("half_open_backend");
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry, backends: [b] });

    // 강제로 half_open 상태로 만들기: 5회 실패 (threshold 기본값) → reset_timeout 경과
    const breaker = (reg as any).breakers.get("half_open_backend");
    for (let i = 0; i < 5; i++) breaker.record_failure();
    // 타임아웃 후 half_open 전환을 강제하기 위해 last_failure_at을 과거로 조작
    (breaker as any).last_failure_at = Date.now() - 60_000;

    // resolve_for_mode는 can_acquire() 사용 → half_open 슬롯 소비 안 함
    const resolved = reg.resolve_for_mode("once");
    expect(resolved?.id).toBe("half_open_backend");

    // run()에서 try_acquire() → 슬롯이 아직 남아있어야 함
    const result = await reg.run("half_open_backend", { task: "ping" });
    expect(result.finish_reason).toBe("stop"); // fallback 아님
  });
});

// ══════════════════════════════════════════
// list_backend_status
// ══════════════════════════════════════════

describe("AgentBackendRegistry — list_backend_status", () => {
  it("등록된 모든 백엔드 상태 반환", () => {
    const b1 = make_backend("backend_a");
    const b2 = make_backend("backend_b", { available: false });
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry, backends: [b1, b2] });
    const statuses = reg.list_backend_status();
    expect(statuses).toHaveLength(2);
    expect(statuses.find((s) => s.id === "backend_a")?.available).toBe(true);
    expect(statuses.find((s) => s.id === "backend_b")?.available).toBe(false);
  });

  it("priority 오름차순 정렬", () => {
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry });
    reg.register(make_backend("low"), { priority: 50, enabled: true, supported_modes: [], provider_type: "x" });
    reg.register(make_backend("high"), { priority: 10, enabled: true, supported_modes: [], provider_type: "y" });
    const statuses = reg.list_backend_status();
    expect(statuses[0]?.id).toBe("high");
    expect(statuses[1]?.id).toBe("low");
  });

  it("circuit_state 포함", () => {
    const b = make_backend("cb_backend");
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry, backends: [b] });
    const status = reg.list_backend_status()[0];
    expect(["closed", "open", "half_open"]).toContain(status?.circuit_state);
  });
});

// ══════════════════════════════════════════
// get_backend / get_session_store / close
// ══════════════════════════════════════════

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
    const b1 = make_backend("b1", { stop: stop1 });
    const b2 = make_backend("b2", { stop: stop2 });
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry, backends: [b1, b2] });
    await reg.close();
    expect(stop1).toHaveBeenCalled();
    expect(stop2).toHaveBeenCalled();
  });

  it("close: stop() 예외 발생해도 완료됨", async () => {
    const b = make_backend("error_stop", { stop: () => { throw new Error("stop failed"); } });
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry, backends: [b] });
    await expect(reg.close()).resolves.not.toThrow();
  });
});

// ══════════════════════════════════════════
// run — 성공/오류/세션 저장
// ══════════════════════════════════════════

describe("AgentBackendRegistry — run (추가 케이스)", () => {
  it("run 성공 + finish_reason=error → breaker.record_failure 호출", async () => {
    const b = make_backend("error_result", { result: { finish_reason: "error" } });
    const reg = new AgentBackendRegistry({ provider_registry: stub_registry, backends: [b] });
    const result = await reg.run("error_result", { task: "test" });
    // finish_reason=error이지만 예외 없이 결과 반환
    expect(result.finish_reason).toBe("error");
  });

  it("run + session 있음 → session_store.save 호출", async () => {
    const mock_session = { id: "sess_001", messages: [] };
    const b = make_backend("with_session", {
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

// ══════════════════════════════════════════
// L173: circuit breaker open → backend 제외 (from cov3)
// ══════════════════════════════════════════

describe("AgentBackendRegistry — L173: 서킷 브레이커 open → backend 제외", () => {
  it("backend 5회 실패 후 서킷 open → resolve_for_mode = null (L173 continue)", async () => {
    const registry = new AgentBackendRegistry({ provider_registry: stub_registry });
    const failing_cb: AgentBackend = {
      id: "cb-b1",
      native_tool_loop: false,
      supports_resume: false,
      capabilities: { supported_modes: ["once", "agent"] },
      is_available: () => true,
      run: async () => { throw new Error("provider fail"); },
    };
    registry.register(
      failing_cb,
      { priority: 1, enabled: true, supported_modes: ["once"], provider_type: "test" },
    );

    for (let i = 0; i < 5; i++) {
      try {
        await registry.run("cb-b1", { task: "t", task_id: `i${i}` } as any);
      } catch { /* expected */ }
    }

    const result = registry.resolve_for_mode("once");
    expect(result).toBeNull();
  });
});

// ══════════════════════════════════════════
// L296: fallback error → record_failure (from cov3)
// ══════════════════════════════════════════

describe("AgentBackendRegistry — L296: fallback error 결과 → record_failure", () => {
  it("primary 실패 → fallback이 finish_reason=error 반환 → L296 record_failure 실행", async () => {
    const registry = new AgentBackendRegistry({ provider_registry: stub_registry });
    const failing_backend: AgentBackend = {
      id: "prim-b1",
      native_tool_loop: false,
      supports_resume: false,
      capabilities: { supported_modes: ["once", "agent"] },
      is_available: () => true,
      run: async () => { throw new Error("primary fail"); },
    };
    registry.register(
      failing_backend,
      { priority: 1, enabled: true, supported_modes: ["once"], provider_type: "p1" },
    );
    registry.register(
      make_backend("fall-b2", { result: { finish_reason: "error" } }),
      { priority: 2, enabled: true, supported_modes: ["once"], provider_type: "p2" },
    );

    const result = await registry.run("prim-b1", { task: "t", task_id: "r1" } as any);
    expect(result.finish_reason).toBe("error");
  });
});

// ══════════════════════════════════════════
// L318: fallback 후보 2개+ → sort 비교자 실행 (from cov3)
// ══════════════════════════════════════════

describe("AgentBackendRegistry — L318: fallback 후보 2개+ → sort 비교자 실행", () => {
  it("fallback 후보 3개 (다른 priority) → sort 비교자 L318 실행 → 가장 낮은 priority 반환", async () => {
    const registry = new AgentBackendRegistry({ provider_registry: stub_registry });
    const failing_backend: AgentBackend = {
      id: "sort-b1",
      native_tool_loop: false,
      supports_resume: false,
      capabilities: { supported_modes: ["once", "agent"] },
      is_available: () => true,
      run: async () => { throw new Error("prim fail"); },
    };
    registry.register(
      failing_backend,
      { priority: 5, enabled: true, supported_modes: ["once"], provider_type: "p1" },
    );
    registry.register(
      make_backend("sort-b2"),
      { priority: 3, enabled: true, supported_modes: ["once"], provider_type: "p2" },
    );
    registry.register(
      make_backend("sort-b3"),
      { priority: 1, enabled: true, supported_modes: ["once"], provider_type: "p3" },
    );

    const result = await registry.run("sort-b1", { task: "t", task_id: "s1" } as any);
    expect(result.content).toBe("result:sort-b3");
  });
});

// ══════════════════════════════════════════
// L329: 레거시 LEGACY_FALLBACK_MAP (from cov3)
// ══════════════════════════════════════════

describe("AgentBackendRegistry — L329: 레거시 fallback (LEGACY_FALLBACK_MAP)", () => {
  it("provider_configs 없고 claude_sdk 실패 → LEGACY_FALLBACK_MAP → claude_cli 반환 (L329)", async () => {
    const registry = new AgentBackendRegistry({ provider_registry: stub_registry });
    const failing_backend: AgentBackend = {
      id: "claude_sdk",
      native_tool_loop: false,
      supports_resume: false,
      capabilities: { supported_modes: ["once", "agent"] },
      is_available: () => true,
      run: async () => { throw new Error("sdk fail"); },
    };
    registry.register(failing_backend);
    registry.register(make_backend("claude_cli"));

    const result = await registry.run("claude_sdk", { task: "t", task_id: "leg1" } as any);
    expect(result.content).toBe("result:claude_cli");
  });
});

// ══════════════════════════════════════════
// L365: _diff_capabilities primary undefined (from cov3)
// ══════════════════════════════════════════

describe("AgentBackendRegistry — L365: _diff_capabilities primary undefined", () => {
  it("primary 백엔드가 capabilities=undefined → _diff_capabilities !primary → L365 return []", async () => {
    const registry = new AgentBackendRegistry({ provider_registry: stub_registry });
    const failing_backend: AgentBackend = {
      id: "diff-b1",
      native_tool_loop: false,
      supports_resume: false,
      capabilities: undefined as any,
      is_available: () => true,
      run: async () => { throw new Error("fail"); },
    };
    registry.register(
      failing_backend,
      { priority: 1, enabled: true, supported_modes: ["once"], provider_type: "p1" },
    );
    registry.register(
      make_backend("diff-b2"),
      { priority: 2, enabled: true, supported_modes: ["once"], provider_type: "p2" },
    );

    const result = await registry.run("diff-b1", { task: "t", task_id: "d1" } as any);
    expect(result).toBeDefined();
  });
});

// ══════════════════════════════════════════
// L369: _diff_capabilities map 실행 (from cov3)
// ══════════════════════════════════════════

describe("AgentBackendRegistry — L369: _diff_capabilities map 실행", () => {
  it("primary.approval=true, fallback.approval=false → filter+map 실행 (L369)", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const registry_with_log = new AgentBackendRegistry({
      provider_registry: stub_registry,
      logger: logger as any,
    });

    const failing_backend: AgentBackend = {
      id: "cap-b1",
      native_tool_loop: false,
      supports_resume: false,
      capabilities: {
        approval: true, structured_output: true, thinking: false,
        budget_tracking: false, tool_filtering: false, tool_result_events: false,
        send_input: false, tool_executors: false,
      } as any,
      is_available: () => true,
      run: async () => { throw new Error("fail"); },
    };
    registry_with_log.register(
      failing_backend,
      { priority: 1, enabled: true, supported_modes: ["once"], provider_type: "c1" },
    );
    registry_with_log.register(
      make_backend("cap-b2"),
      { priority: 2, enabled: true, supported_modes: ["once"], provider_type: "c2" },
    );

    const result = await registry_with_log.run("cap-b1", { task: "t", task_id: "c1" } as any);
    expect(result).toBeDefined();
    expect(result.content).toBe("result:cap-b2");
  });
});
