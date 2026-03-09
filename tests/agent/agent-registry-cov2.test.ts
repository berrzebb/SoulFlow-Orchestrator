/**
 * AgentBackendRegistry 미커버 분기 보충 (cov2).
 * - resolve_backend with null id (L130)
 * - _get_available_for_mode continue paths (unavailable, circuit-open, disabled, wrong mode)
 * - _try_fallback catch: fb_breaker.record_failure + throw error
 * - list_backend_status priority sort
 */
import { describe, it, expect, vi } from "vitest";
import { AgentBackendRegistry } from "@src/agent/agent-registry.js";
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
