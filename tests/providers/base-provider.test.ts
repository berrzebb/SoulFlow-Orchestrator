/**
 * BaseLlmProvider — sanitize_messages / normalize_options 단위 테스트.
 * 추상 클래스이므로 최소한의 구체 구현 클래스를 로컬에서 생성.
 */
import { describe, it, expect } from "vitest";
import { BaseLlmProvider } from "../../src/providers/base.js";
import type { ChatOptions, LlmResponse } from "../../src/providers/types.js";

// 테스트용 구체 구현 (chat()만 최소 구현)
class TestProvider extends BaseLlmProvider {
  async chat(_options: ChatOptions): Promise<LlmResponse> {
    return { content: "test", model: this.default_model, usage: { input_tokens: 0, output_tokens: 0 } };
  }
}

const make_provider = () =>
  new TestProvider({ id: "test" as any, api_base: "https://api.test.com", default_model: "test-model" });

// ── sanitize_messages ────────────────────────────────────────────

describe("BaseLlmProvider — sanitize_messages", () => {
  it("빈 content 문자열 → '(empty)'로 대체", () => {
    const provider = make_provider();
    const result = (provider as any).sanitize_messages([
      { role: "user", content: "" },
    ]);
    expect(result[0].content).toBe("(empty)");
  });

  it("assistant + tool_calls + 빈 content → null로 대체", () => {
    const provider = make_provider();
    const result = (provider as any).sanitize_messages([
      { role: "assistant", content: "", tool_calls: [{ id: "tc1" }] },
    ]);
    expect(result[0].content).toBeNull();
  });

  it("정상 content → 그대로 유지", () => {
    const provider = make_provider();
    const result = (provider as any).sanitize_messages([
      { role: "user", content: "Hello" },
    ]);
    expect(result[0].content).toBe("Hello");
  });

  it("Array content — 빈 text 항목 필터링", () => {
    const provider = make_provider();
    const result = (provider as any).sanitize_messages([
      {
        role: "user",
        content: [
          { type: "text", text: "hello" },
          { type: "text", text: "" },  // 빈 텍스트 → 필터됨
          { type: "image_url", url: "http://x.com/img.png" }, // 비텍스트 → 유지
        ],
      },
    ]);
    const content = result[0].content as Array<{ type: string; text?: string }>;
    expect(content.some((c) => c.type === "text" && c.text === "hello")).toBe(true);
    expect(content.some((c) => c.type === "text" && c.text === "")).toBe(false);
    expect(content.some((c) => c.type === "image_url")).toBe(true);
  });

  it("Array content 전부 필터 → '(empty)'", () => {
    const provider = make_provider();
    const result = (provider as any).sanitize_messages([
      {
        role: "user",
        content: [
          { type: "text", text: "" },
          { type: "output_text", text: "" },
        ],
      },
    ]);
    expect(result[0].content).toBe("(empty)");
  });

  it("여러 메시지 혼합 → 각각 처리됨", () => {
    const provider = make_provider();
    const result = (provider as any).sanitize_messages([
      { role: "user", content: "first" },
      { role: "assistant", content: "" },
      { role: "user", content: "last" },
    ]);
    expect(result).toHaveLength(3);
    expect(result[0].content).toBe("first");
    expect(result[1].content).toBe("(empty)");
    expect(result[2].content).toBe("last");
  });
});

// ── normalize_options ─────────────────────────────────────────────

describe("BaseLlmProvider — normalize_options", () => {
  it("기본값 적용 (max_tokens=4096, temperature=0.7)", () => {
    const provider = make_provider();
    const result = (provider as any).normalize_options({});
    expect(result.max_tokens).toBe(4096);
    expect(result.temperature).toBe(0.7);
  });

  it("명시적 값 사용", () => {
    const provider = make_provider();
    const result = (provider as any).normalize_options({ max_tokens: 2048, temperature: 0.1 });
    expect(result.max_tokens).toBe(2048);
    expect(result.temperature).toBe(0.1);
  });

  it("max_tokens 최소 1 보장 (0 → 1)", () => {
    const provider = make_provider();
    const result = (provider as any).normalize_options({ max_tokens: 0 });
    expect(result.max_tokens).toBe(1);
  });

  it("음수 max_tokens → 1", () => {
    const provider = make_provider();
    const result = (provider as any).normalize_options({ max_tokens: -100 });
    expect(result.max_tokens).toBe(1);
  });
});

// ── 생성자 및 메타데이터 ─────────────────────────────────────────

describe("BaseLlmProvider — 생성자", () => {
  it("id, api_base, default_model 설정됨", () => {
    const provider = make_provider();
    expect(provider.id).toBe("test");
    expect((provider as any).api_base).toBe("https://api.test.com");
    expect(provider.get_default_model()).toBe("test-model");
  });

  it("supports_tool_loop 기본값 = false", () => {
    const provider = make_provider();
    expect(provider.supports_tool_loop).toBe(false);
  });

  it("supports_tool_loop = true 설정 가능", () => {
    const p = new TestProvider({
      id: "test" as any,
      api_base: "https://api.test.com",
      default_model: "model",
      supports_tool_loop: true,
    });
    expect(p.supports_tool_loop).toBe(true);
  });
});
