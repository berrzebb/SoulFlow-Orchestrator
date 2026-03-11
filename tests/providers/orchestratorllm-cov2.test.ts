/**
 * orchestrator-llm.provider.ts — 미커버 분기 (cov2):
 * - L69: content에서 tool_calls 파싱 성공 → LlmResponse(tool_calls=extracted) 반환
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { OrchestratorLlmProvider } from "@src/providers/orchestrator-llm.provider.js";

afterEach(() => { vi.unstubAllGlobals(); });

const USER_MSG = [{ role: "user" as const, content: "Hello" }];

function make_fetch_with_text_content(content: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({
      choices: [{
        message: { role: "assistant", content, tool_calls: undefined },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
  });
}

// ── L69: content가 JSON tool_calls 형식 + options.tools 있음 → 파싱 성공 ──────

describe("OrchestratorLlmProvider — L69: content tool_calls 파싱 → extracted 반환", () => {
  it("content=[{name,arguments}] + tools 있음 → L69: tool_calls 추출 후 반환", async () => {
    // parse_tool_calls_from_text 가 인식하는 포맷: [ 시작 JSON 배열
    const tool_calls_json = JSON.stringify([{ name: "get_weather", arguments: { city: "Seoul" } }]);
    vi.stubGlobal("fetch", make_fetch_with_text_content(tool_calls_json));

    const p = new OrchestratorLlmProvider({ api_base: "http://localhost:11434/v1" });
    const r = await p.chat({
      messages: USER_MSG,
      tools: [{ type: "function", function: { name: "get_weather", parameters: {} } } as any],
    });

    // L69 경로: extracted.length > 0 → tool_calls 세팅
    expect(r.tool_calls.length).toBeGreaterThan(0);
    expect(r.tool_calls[0].name).toBe("get_weather");
    expect(r.content).toBeNull();
  });
});
