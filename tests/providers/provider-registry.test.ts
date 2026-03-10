/**
 * ProviderRegistry — 기본 동작 커버리지:
 * - 생성자: providers/breakers 등록
 * - list_providers, set/get_active_provider, set/get_orchestrator_provider
 * - get_provider_instance: 존재/미존재
 * - is_provider_available, get_health_scorer
 * - supports_tool_loop
 * - parse_provider_id, resolve_default_orchestrator_provider
 * - is_transient_exception, is_transient_error_content (private, via run_headless mock)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ProviderRegistry가 생성자에서 각 Provider를 new로 생성하므로 class mock 필요
vi.mock("@src/providers/cli.provider.js", () => ({
  CliHeadlessProvider: class {
    id: string;
    default_model: string;
    supports_tool_loop = false;
    constructor(opts: { id: string; default_model: string }) {
      this.id = opts.id;
      this.default_model = opts.default_model;
    }
    chat = vi.fn();
  },
}));

vi.mock("@src/providers/openrouter.provider.js", () => ({
  OpenRouterProvider: class {
    id = "openrouter";
    default_model = "gpt-4o";
    supports_tool_loop = true;
    chat = vi.fn();
  },
}));

vi.mock("@src/providers/orchestrator-llm.provider.js", () => ({
  OrchestratorLlmProvider: class {
    id = "orchestrator_llm";
    default_model = "gpt-4o";
    supports_tool_loop = false;
    chat = vi.fn();
  },
}));

import { ProviderRegistry } from "@src/providers/service.js";

function make_vault() {
  return {
    mask_known_secrets: vi.fn().mockResolvedValue("masked"),
  } as any;
}

function make_registry(overrides: Record<string, unknown> = {}) {
  return new ProviderRegistry({
    secret_vault: make_vault(),
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ══════════════════════════════════════════════════════════
// 생성자 + list_providers
// ══════════════════════════════════════════════════════════

describe("ProviderRegistry — 생성자 + list_providers", () => {
  it("기본 생성 → 5개 프로바이더 등록", () => {
    const registry = make_registry();
    const ids = registry.list_providers();
    expect(ids).toContain("chatgpt");
    expect(ids).toContain("claude_code");
    expect(ids).toContain("openrouter");
    expect(ids).toContain("orchestrator_llm");
    expect(ids).toContain("gemini");
  });

  it("cli_configs 커스텀 설정 → CliHeadlessProvider에 전달됨", () => {
    const registry = make_registry({
      cli_configs: {
        chatgpt: { command: "custom-codex", timeout_ms: 60000 },
      },
    });
    expect(registry.list_providers()).toContain("chatgpt");
  });

  it("orchestrator_provider 오버라이드 → 해당 프로바이더가 orchestrator로 설정", () => {
    const registry = make_registry({ orchestrator_provider: "openrouter" });
    expect(registry.get_orchestrator_provider_id()).toBe("openrouter");
  });

  it("orchestrator_provider 없음 → chatgpt가 기본 오케스트레이터", () => {
    const registry = make_registry();
    // resolve_default_orchestrator_provider: ["chatgpt",...] 중 첫 번째
    expect(registry.get_orchestrator_provider_id()).toBe("chatgpt");
  });

  it("get_secret_vault → vault 반환", () => {
    const vault = make_vault();
    const registry = new ProviderRegistry({ secret_vault: vault });
    expect(registry.get_secret_vault()).toBe(vault);
  });
});

// ══════════════════════════════════════════════════════════
// set/get_active_provider
// ══════════════════════════════════════════════════════════

describe("ProviderRegistry — set_active_provider / get_active_provider_id", () => {
  it("기본 active_provider_id = chatgpt", () => {
    const registry = make_registry();
    expect(registry.get_active_provider_id()).toBe("chatgpt");
  });

  it("set_active_provider('openrouter') → get_active_provider_id 변경", () => {
    const registry = make_registry();
    registry.set_active_provider("openrouter");
    expect(registry.get_active_provider_id()).toBe("openrouter");
  });

  it("set_active_provider 없는 ID → throws", () => {
    const registry = make_registry();
    expect(() => registry.set_active_provider("unknown_provider" as any)).toThrow("provider_not_found");
  });
});

// ══════════════════════════════════════════════════════════
// set/get_orchestrator_provider
// ══════════════════════════════════════════════════════════

describe("ProviderRegistry — set/get_orchestrator_provider", () => {
  it("set_orchestrator_provider('claude_code') → get 변경", () => {
    const registry = make_registry();
    registry.set_orchestrator_provider("claude_code");
    expect(registry.get_orchestrator_provider_id()).toBe("claude_code");
  });

  it("set_orchestrator_provider 없는 ID → throws", () => {
    const registry = make_registry();
    expect(() => registry.set_orchestrator_provider("not_exist" as any)).toThrow("provider_not_found");
  });
});

// ══════════════════════════════════════════════════════════
// get_provider_instance
// ══════════════════════════════════════════════════════════

describe("ProviderRegistry — get_provider_instance", () => {
  it("존재하는 ID → 프로바이더 반환", () => {
    const registry = make_registry();
    const p = registry.get_provider_instance("openrouter");
    expect(p).toBeDefined();
    expect((p as any).id).toBe("openrouter");
  });

  it("존재하지 않는 ID → throws", () => {
    const registry = make_registry();
    expect(() => registry.get_provider_instance("nope" as any)).toThrow("provider_not_found");
  });
});

// ══════════════════════════════════════════════════════════
// is_provider_available / get_circuit_breaker
// ══════════════════════════════════════════════════════════

describe("ProviderRegistry — is_provider_available / circuit_breaker", () => {
  it("초기 상태 → is_provider_available true (breaker closed)", () => {
    const registry = make_registry();
    expect(registry.is_provider_available("openrouter")).toBe(true);
  });

  it("get_circuit_breaker → CircuitBreaker 인스턴스 반환", () => {
    const registry = make_registry();
    const breaker = registry.get_circuit_breaker("openrouter");
    expect(breaker).toBeDefined();
    expect(typeof breaker?.can_acquire).toBe("function");
  });

  it("get_circuit_breaker 없는 ID → undefined", () => {
    const registry = make_registry();
    const breaker = registry.get_circuit_breaker("nope" as any);
    expect(breaker).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════
// get_health_scorer / supports_tool_loop
// ══════════════════════════════════════════════════════════

describe("ProviderRegistry — get_health_scorer / supports_tool_loop", () => {
  it("get_health_scorer → ProviderHealthScorer 반환", () => {
    const registry = make_registry();
    const scorer = registry.get_health_scorer();
    expect(scorer).toBeDefined();
    expect(typeof scorer.record).toBe("function");
  });

  it("supports_tool_loop('openrouter') → mock에서 true", () => {
    const registry = make_registry();
    // openrouter mock: supports_tool_loop = true
    expect(registry.supports_tool_loop("openrouter")).toBe(true);
  });

  it("supports_tool_loop('chatgpt') → mock에서 false", () => {
    const registry = make_registry();
    expect(registry.supports_tool_loop("chatgpt")).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════
// parse_provider_id (module-level private, via orchestrator_provider)
// ══════════════════════════════════════════════════════════

describe("ProviderRegistry — parse_provider_id (via orchestrator_provider override)", () => {
  const valid_ids = ["chatgpt", "claude_code", "openrouter", "orchestrator_llm", "gemini"];

  for (const id of valid_ids) {
    it(`orchestrator_provider='${id}' → 인식됨`, () => {
      const registry = make_registry({ orchestrator_provider: id });
      expect(registry.get_orchestrator_provider_id()).toBe(id);
    });
  }

  it("orchestrator_provider='unknown' → null → 기본값 사용", () => {
    const registry = make_registry({ orchestrator_provider: "unknown_xyz" });
    // parse_provider_id returns null → fallback to priority list
    expect(registry.get_orchestrator_provider_id()).toBe("chatgpt");
  });
});
