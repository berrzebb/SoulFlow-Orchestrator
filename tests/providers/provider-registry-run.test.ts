/**
 * ProviderRegistry — run_headless 커버리지:
 * - 정상 실행: messages sanitize → provider.chat → health_scorer.record
 * - circuit open → throws "circuit_open"
 * - transient exception → 재시도 (MAX_TRANSIENT_RETRIES=2)
 * - transient error content → 재시도
 * - non-transient exception → 즉시 throw
 * - abort_signal → last_error throw
 * - redact_prompt_content: array 아이템, image_url, media_url
 * - is_transient_exception / is_transient_error_content (via retry 경로)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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

vi.useFakeTimers();

function make_vault() {
  return {
    mask_known_secrets: vi.fn().mockImplementation((v: string) => Promise.resolve(v)),
  } as any;
}

function make_registry() {
  return new ProviderRegistry({
    secret_vault: make_vault(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ══════════════════════════════════════════════════════════
// 정상 실행
// ══════════════════════════════════════════════════════════

describe("ProviderRegistry — run_headless 정상 실행", () => {
  it("메시지 sanitize → provider.chat → 결과 반환", async () => {
    const registry = make_registry();
    const provider = registry.get_provider_instance("openrouter") as any;
    provider.chat.mockResolvedValue({ content: "hello", finish_reason: "stop" });

    const result = await registry.run_headless({
      provider_id: "openrouter",
      messages: [{ role: "user", content: "test msg" }],
    });

    expect(result.content).toBe("hello");
    expect(provider.chat).toHaveBeenCalledTimes(1);
  });

  it("finish_reason=error (non-transient content) → 에러 결과 반환 (재시도 없음)", async () => {
    const registry = make_registry();
    const provider = registry.get_provider_instance("openrouter") as any;
    provider.chat.mockResolvedValue({ content: "some error", finish_reason: "error" });

    const result = await registry.run_headless({
      provider_id: "openrouter",
      messages: [{ role: "user", content: "test" }],
    });

    // non-transient error content → record_failure but return result
    expect(result.finish_reason).toBe("error");
    expect(provider.chat).toHaveBeenCalledTimes(1);
  });
});

// ══════════════════════════════════════════════════════════
// circuit breaker
// ══════════════════════════════════════════════════════════

describe("ProviderRegistry — circuit open", () => {
  it("circuit 열림 → circuit_open 에러 throw", async () => {
    const registry = make_registry();
    const breaker = registry.get_circuit_breaker("openrouter")!;

    // circuit을 open 상태로 만들기
    for (let i = 0; i < 10; i++) breaker.record_failure();
    expect(registry.is_provider_available("openrouter")).toBe(false);

    await expect(
      registry.run_headless({
        provider_id: "openrouter",
        messages: [{ role: "user", content: "test" }],
      }),
    ).rejects.toThrow("circuit_open");
  });
});

// ══════════════════════════════════════════════════════════
// transient exception 재시도
// ══════════════════════════════════════════════════════════

describe("ProviderRegistry — transient exception 재시도", () => {
  it("transient 에러 2번 → 3번째 성공", async () => {
    const registry = make_registry();
    const provider = registry.get_provider_instance("openrouter") as any;
    provider.chat
      .mockRejectedValueOnce(new Error("rate limit exceeded"))
      .mockRejectedValueOnce(new Error("rate limit exceeded"))
      .mockResolvedValueOnce({ content: "ok", finish_reason: "stop" });

    const promise = registry.run_headless({
      provider_id: "openrouter",
      messages: [{ role: "user", content: "test" }],
    });
    // sleep_ms 타이머 진행
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);

    const result = await promise;
    expect(result.content).toBe("ok");
    expect(provider.chat).toHaveBeenCalledTimes(3);
  });

  it("429 에러 → is_transient_exception true → 재시도", async () => {
    const registry = make_registry();
    const provider = registry.get_provider_instance("openrouter") as any;
    provider.chat
      .mockRejectedValueOnce(new Error("HTTP 429 Too Many Requests"))
      .mockResolvedValueOnce({ content: "ok", finish_reason: "stop" });

    const promise = registry.run_headless({
      provider_id: "openrouter",
      messages: [{ role: "user", content: "test" }],
    });
    await vi.advanceTimersByTimeAsync(2000);

    const result = await promise;
    expect(result.content).toBe("ok");
    expect(provider.chat).toHaveBeenCalledTimes(2);
  });

  it("non-transient 에러 → 즉시 throw", async () => {
    const registry = make_registry();
    const provider = registry.get_provider_instance("openrouter") as any;
    provider.chat.mockRejectedValue(new Error("invalid_api_key"));

    await expect(
      registry.run_headless({
        provider_id: "openrouter",
        messages: [{ role: "user", content: "test" }],
      }),
    ).rejects.toThrow("invalid_api_key");
    expect(provider.chat).toHaveBeenCalledTimes(1);
  });

  it("MAX_TRANSIENT_RETRIES 초과 → 마지막 에러 throw", async () => {
    const registry = make_registry();
    const provider = registry.get_provider_instance("openrouter") as any;
    provider.chat.mockRejectedValue(new Error("ECONNRESET"));

    const promise = registry.run_headless({
      provider_id: "openrouter",
      messages: [{ role: "user", content: "test" }],
    });
    // .rejects를 먼저 등록해 unhandled rejection 방지
    const assertion = expect(promise).rejects.toThrow("ECONNRESET");
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    expect(provider.chat).toHaveBeenCalledTimes(3); // 1 + MAX_TRANSIENT_RETRIES(2)
  });
});

// ══════════════════════════════════════════════════════════
// transient error content 재시도
// ══════════════════════════════════════════════════════════

describe("ProviderRegistry — transient error content 재시도", () => {
  it("finish_reason=error + rate limit content → 재시도 후 성공", async () => {
    const registry = make_registry();
    const provider = registry.get_provider_instance("openrouter") as any;
    provider.chat
      .mockResolvedValueOnce({ content: "rate limit exceeded", finish_reason: "error" })
      .mockResolvedValueOnce({ content: "ok", finish_reason: "stop" });

    const promise = registry.run_headless({
      provider_id: "openrouter",
      messages: [{ role: "user", content: "test" }],
    });
    await vi.advanceTimersByTimeAsync(2000);

    const result = await promise;
    expect(result.content).toBe("ok");
    expect(provider.chat).toHaveBeenCalledTimes(2);
  });
});

// ══════════════════════════════════════════════════════════
// abort_signal
// ══════════════════════════════════════════════════════════

describe("ProviderRegistry — abort_signal", () => {
  it("abort 된 signal → throw last_error", async () => {
    const registry = make_registry();
    const provider = registry.get_provider_instance("openrouter") as any;
    const controller = new AbortController();

    provider.chat.mockImplementationOnce(async () => {
      controller.abort();
      throw new Error("ECONNRESET");
    });

    const promise = registry.run_headless({
      provider_id: "openrouter",
      messages: [{ role: "user", content: "test" }],
      abort_signal: controller.signal,
    });
    // .rejects 먼저 등록 → unhandled rejection 방지
    const assertion = expect(promise).rejects.toThrow("ECONNRESET");
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
    // abort된 상태에서 재시도 없이 종료
    expect(provider.chat).toHaveBeenCalledTimes(1);
  });
});

// ══════════════════════════════════════════════════════════
// redact_prompt_content — array 아이템 경로
// ══════════════════════════════════════════════════════════

describe("ProviderRegistry — redact_prompt_content (array content)", () => {
  it("array content에 text/media_url/image_url 포함 → mask 호출", async () => {
    const vault = make_vault();
    const registry = new ProviderRegistry({ secret_vault: vault });
    const provider = registry.get_provider_instance("openrouter") as any;
    provider.chat.mockResolvedValue({ content: "ok", finish_reason: "stop" });

    await registry.run_headless({
      provider_id: "openrouter",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "hello secret-text" },
            { type: "image", media_url: "https://example.com/img" },
            { type: "image", image_url: { url: "https://cdn.example.com/photo.jpg" } },
            null, // null 아이템 → 그대로 통과
            "plain string item", // string이 아닌 primitive → 그대로
          ] as any,
        },
      ],
    });

    // vault.mask_known_secrets 여러 번 호출
    expect(vault.mask_known_secrets).toHaveBeenCalled();
  });

  it("tool_calls 있는 메시지 → redact_sensitive_unknown 처리", async () => {
    const vault = make_vault();
    const registry = new ProviderRegistry({ secret_vault: vault });
    const provider = registry.get_provider_instance("openrouter") as any;
    provider.chat.mockResolvedValue({ content: "ok", finish_reason: "stop" });

    await registry.run_headless({
      provider_id: "openrouter",
      messages: [
        {
          role: "assistant",
          content: "calling tool",
          tool_calls: [
            { id: "tc1", function: { name: "search", arguments: "{}" } },
            null, // non-object tool call
          ] as any,
        },
      ],
    });

    expect(provider.chat).toHaveBeenCalledTimes(1);
  });
});
