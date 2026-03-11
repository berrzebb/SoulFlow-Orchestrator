/**
 * AgentBackendRegistry — 미커버 분기 보충 (cov3):
 * - L173: _get_available_for_mode — circuit breaker open → try_acquire=false → continue
 * - L296: _try_fallback — is_error=true → fb_breaker.record_failure()
 * - L318: _find_fallback sort 비교자 — 2개 이상 후보 시 priority 정렬 비교자 실행
 * - L329: _find_fallback 레거시 맵 — provider_configs 없고 LEGACY_FALLBACK_MAP 히트
 * - L365: _diff_capabilities — primary undefined → return []
 * - L369: _diff_capabilities — primary[k] && !fallback[k] → map 실행
 */
import { describe, it, expect } from "vitest";
import { AgentBackendRegistry } from "@src/agent/agent-registry.js";
import type { AgentBackend, AgentRunResult } from "@src/agent/agent.types.js";

function make_backend(
  id: string,
  opts: {
    available?: boolean;
    run_throws?: Error;
    finish_reason?: string;
    capabilities?: Partial<import("@src/agent/agent.types.js").BackendCapabilities> | undefined;
  } = {},
): AgentBackend {
  return {
    id,
    native_tool_loop: false,
    supports_resume: false,
    capabilities: opts.capabilities as any ?? {
      approval: false, structured_output: false, thinking: false,
      budget_tracking: false, tool_filtering: false, tool_result_events: false,
      send_input: false, tool_executors: false,
    },
    is_available: () => opts.available ?? true,
    stop: undefined,
    run: async (): Promise<AgentRunResult> => {
      if (opts.run_throws) throw opts.run_throws;
      return {
        content: `result:${id}`,
        session: null,
        tool_calls_count: 0,
        usage: {},
        finish_reason: opts.finish_reason ?? "stop",
        metadata: {},
      };
    },
  };
}

const stub_registry = {
  get_health_scorer: () => ({ record: () => {} }),
} as unknown as import("@src/providers/service.js").ProviderRegistry;

// ── L173: circuit breaker open → _get_available_for_mode continue ────────────

describe("AgentBackendRegistry — L173: 서킷 브레이커 open → backend 제외", () => {
  it("backend 5회 실패 후 서킷 open → resolve_for_mode = null (L173 continue)", async () => {
    const registry = new AgentBackendRegistry({ provider_registry: stub_registry });
    registry.register(
      make_backend("cb-b1", { run_throws: new Error("provider fail") }),
      { priority: 1, enabled: true, supported_modes: ["once"], provider_type: "test" },
    );

    // 5회 실패 → 서킷 open
    for (let i = 0; i < 5; i++) {
      try {
        await registry.run("cb-b1", { task: "t", task_id: `i${i}` } as any);
      } catch { /* 예상된 실패 */ }
    }

    // 서킷 open → _get_available_for_mode L173: try_acquire()=false → continue → 후보 없음
    const result = registry.resolve_for_mode("once");
    expect(result).toBeNull();
  });
});

// ── L296: _try_fallback — fallback이 "error" finish_reason 반환 → record_failure ──

describe("AgentBackendRegistry — L296: fallback error 결과 → record_failure", () => {
  it("primary 실패 → fallback이 finish_reason=error 반환 → L296 record_failure 실행", async () => {
    const registry = new AgentBackendRegistry({ provider_registry: stub_registry });
    registry.register(
      make_backend("prim-b1", { run_throws: new Error("primary fail") }),
      { priority: 1, enabled: true, supported_modes: ["once"], provider_type: "p1" },
    );
    registry.register(
      make_backend("fall-b2", { finish_reason: "error" }),
      { priority: 2, enabled: true, supported_modes: ["once"], provider_type: "p2" },
    );

    // primary throws → _try_fallback → fallback.run returns finish_reason="error"
    // → is_error=true → L296 fb_breaker.record_failure() 실행
    const result = await registry.run("prim-b1", { task: "t", task_id: "r1" } as any);
    expect(result.finish_reason).toBe("error");
  });
});

// ── L318: _find_fallback sort 비교자 — 2개 이상 후보 → priority 정렬 ──────────

describe("AgentBackendRegistry — L318: fallback 후보 2개+ → sort 비교자 실행", () => {
  it("fallback 후보 3개 (다른 priority) → sort 비교자 L318 실행 → 가장 낮은 priority 반환", async () => {
    const registry = new AgentBackendRegistry({ provider_registry: stub_registry });
    registry.register(
      make_backend("sort-b1", { run_throws: new Error("prim fail") }),
      { priority: 5, enabled: true, supported_modes: ["once"], provider_type: "p1" },
    );
    // 2개의 fallback 후보 → sort 비교자 호출됨 (L318)
    registry.register(
      make_backend("sort-b2"),
      { priority: 3, enabled: true, supported_modes: ["once"], provider_type: "p2" },
    );
    registry.register(
      make_backend("sort-b3"),
      { priority: 1, enabled: true, supported_modes: ["once"], provider_type: "p3" },
    );

    // primary fails → _find_fallback → candidates = [b2(p3), b3(p1)] → sort → b3 먼저
    const result = await registry.run("sort-b1", { task: "t", task_id: "s1" } as any);
    expect(result.content).toBe("result:sort-b3");
  });
});

// ── L329: 레거시 LEGACY_FALLBACK_MAP — provider_configs 없을 때 ──────────────

describe("AgentBackendRegistry — L329: 레거시 fallback (LEGACY_FALLBACK_MAP)", () => {
  it("provider_configs 없고 claude_sdk 실패 → LEGACY_FALLBACK_MAP → claude_cli 반환 (L329)", async () => {
    const registry = new AgentBackendRegistry({ provider_registry: stub_registry });
    // config 없이 등록 → provider_configs.size = 0
    registry.register(make_backend("claude_sdk", { run_throws: new Error("sdk fail") }));
    registry.register(make_backend("claude_cli"));

    // _find_fallback("claude_sdk"):
    //  - provider_configs.size = 0 → dynamic path 스킵
    //  - LEGACY_FALLBACK_MAP["claude_sdk"] = "claude_cli"
    //  - backends.get("claude_cli") = cli, is_available()=true → return fb (L329) ✓
    const result = await registry.run("claude_sdk", { task: "t", task_id: "leg1" } as any);
    expect(result.content).toBe("result:claude_cli");
  });
});

// ── L365: _diff_capabilities — primary undefined → return [] ─────────────────

describe("AgentBackendRegistry — L365: _diff_capabilities primary undefined", () => {
  it("primary 백엔드가 capabilities=undefined → _diff_capabilities !primary → L365 return []", async () => {
    const registry = new AgentBackendRegistry({ provider_registry: stub_registry });
    // capabilities = undefined as any → _diff_capabilities primary = undefined
    registry.register(
      make_backend("diff-b1", {
        run_throws: new Error("fail"),
        capabilities: undefined,
      }),
      { priority: 1, enabled: true, supported_modes: ["once"], provider_type: "p1" },
    );
    registry.register(
      make_backend("diff-b2"),
      { priority: 2, enabled: true, supported_modes: ["once"], provider_type: "p2" },
    );

    // _try_fallback → logger.warn(capability_diff: _diff_capabilities(undefined, ...))
    // → !primary → return [] (L365)
    const result = await registry.run("diff-b1", { task: "t", task_id: "d1" } as any);
    expect(result).toBeDefined();
  });
});

// ── L369: _diff_capabilities — primary[k] && !fallback[k] → map ──────────────

describe("AgentBackendRegistry — L369: _diff_capabilities map 실행", () => {
  it("primary.approval=true, fallback.approval=false → filter+map 실행 (L369)", async () => {
    const registry = new AgentBackendRegistry({ provider_registry: stub_registry });
    const logger = { info: () => {}, warn: (_: string, meta: any) => { /* capability_diff 확인 가능 */ }, error: () => {}, debug: () => {} };
    const registry_with_log = new AgentBackendRegistry({
      provider_registry: stub_registry,
      logger: logger as any,
    });

    // primary: approval=true, structured_output=true → fallback: 모두 false
    registry_with_log.register(
      make_backend("cap-b1", {
        run_throws: new Error("fail"),
        capabilities: {
          approval: true, structured_output: true, thinking: false,
          budget_tracking: false, tool_filtering: false, tool_result_events: false,
          send_input: false, tool_executors: false,
        },
      }),
      { priority: 1, enabled: true, supported_modes: ["once"], provider_type: "c1" },
    );
    registry_with_log.register(
      make_backend("cap-b2", {
        capabilities: {
          approval: false, structured_output: false, thinking: false,
          budget_tracking: false, tool_filtering: false, tool_result_events: false,
          send_input: false, tool_executors: false,
        },
      }),
      { priority: 2, enabled: true, supported_modes: ["once"], provider_type: "c2" },
    );

    // _diff_capabilities: primary[approval]=true, fallback[approval]=false
    // → filter keeps ["approval", "structured_output"] → map L369 → ["-approval", "-structured_output"]
    const result = await registry_with_log.run("cap-b1", { task: "t", task_id: "c1" } as any);
    expect(result).toBeDefined();
    expect(result.content).toBe("result:cap-b2");
  });
});
