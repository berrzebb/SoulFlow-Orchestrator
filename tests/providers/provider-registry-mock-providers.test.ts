/**
 * ProviderRegistry — 미커버 분기 (cov2):
 * - L217: resolve_default_orchestrator_provider → 우선순위 목록에 없는 provider만 있을 때 fallback
 * - L287: run_headless → sleep 후 abort_signal.aborted → throw last_error
 * - L317: throw last_error → 모든 재시도 exhausted (transient error만 발생)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
    mask_known_secrets: vi.fn().mockImplementation((v: string) => Promise.resolve(v)),
  } as any;
}

function make_registry() {
  return new ProviderRegistry({ secret_vault: make_vault() });
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

// ── L217: 우선순위 provider 없음 → providers.keys().next().value 반환 ─────────

describe("ProviderRegistry — L217: non-priority provider → fallback", () => {
  it("providers map에서 우선순위 목록 외 provider만 있을 때 → L217 fallback", () => {
    const registry = make_registry();

    // providers를 비우고 비-우선순위 provider만 추가
    const providers = (registry as any).providers as Map<string, unknown>;
    providers.clear();
    providers.set("my_custom_llm", { id: "my_custom_llm", chat: vi.fn() });

    // resolve_default_orchestrator_provider 직접 호출 → L217 경로
    const result = (registry as any).resolve_default_orchestrator_provider();
    expect(result).toBe("my_custom_llm");
  });
});

// ── L287: sleep 이후 abort_signal.aborted → throw last_error ─────────────────

describe("ProviderRegistry — L287: sleep 후 abort → throw", () => {
  it("transient 에러 후 sleep 중 abort → sleep 완료 후 L287 throw", async () => {
    vi.useFakeTimers();
    const registry = make_registry();
    const provider = registry.get_provider_instance("openrouter") as any;
    const controller = new AbortController();

    // 첫 번째 시도: transient 에러
    provider.chat.mockRejectedValueOnce(new Error("rate limit exceeded"));

    const promise = registry.run_headless({
      provider_id: "openrouter",
      messages: [{ role: "user", content: "test" }],
      abort_signal: controller.signal,
    });

    // unhandled rejection 방지를 위해 먼저 등록
    const assertion = expect(promise).rejects.toThrow("rate limit exceeded");

    // 마이크로태스크: 첫 번째 chat() 실패 → catch → attempt=1 → L285 통과 → sleep(1000) 시작
    await vi.advanceTimersByTimeAsync(0);

    // sleep 도중 abort → L287에서 감지할 것
    controller.abort();

    // sleep 완료 → L287: abort_signal.aborted=true → throw last_error
    await vi.advanceTimersByTimeAsync(1100);
    await assertion;

    // abort 됐으므로 두 번째 chat()은 호출되지 않아야 함
    expect(provider.chat).toHaveBeenCalledTimes(1);
  });
});

// ── L317: 모든 재시도 exhausted → throw last_error ────────────────────────────

describe("ProviderRegistry — L317: 모든 재시도 소진 → throw last_error", () => {
  it("3회 모두 transient 에러 → loop 종료 후 L317 throw last_error", async () => {
    vi.useFakeTimers();
    const registry = make_registry();
    const provider = registry.get_provider_instance("openrouter") as any;

    // MAX_TRANSIENT_RETRIES = 2 → 총 3회 실패 (0, 1, 2)
    provider.chat.mockRejectedValue(new Error("ECONNRESET"));

    const promise = registry.run_headless({
      provider_id: "openrouter",
      messages: [{ role: "user", content: "test" }],
    });

    // unhandled rejection 방지를 위해 먼저 등록
    const assertion = expect(promise).rejects.toThrow("ECONNRESET");
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;

    // 3회 시도 → 3회 호출
    expect(provider.chat).toHaveBeenCalledTimes(3);
  });
});
