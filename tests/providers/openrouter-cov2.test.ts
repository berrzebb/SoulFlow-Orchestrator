/**
 * openrouter.provider.ts — 미커버 분기 (cov2):
 * - L62: response.json() 거부 → .catch(() => ({})) 콜백 실행
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { OpenRouterProvider } from "@src/providers/openrouter.provider.js";

afterEach(() => { vi.unstubAllGlobals(); });

const USER_MSG = [{ role: "user" as const, content: "Hello" }];

// ── L62: response.json() 거부 → .catch(() => ({})) ──────────────────────────

describe("OpenRouterProvider — L62: response.json() 거부 → catch 콜백", () => {
  it("json() 거부 → {} fallback → parse 시도 후 정상 반환 (L62)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error("invalid json")),
    }));
    const p = new OpenRouterProvider({ api_key: "sk-test-key" });
    const r = await p.chat({ messages: USER_MSG });
    // json() 실패 → {} → parse_openai_response({}) → 빈 content
    expect(r).toBeDefined();
    expect(typeof r.finish_reason).toBe("string");
  });
});
