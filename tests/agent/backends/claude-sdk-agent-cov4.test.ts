/**
 * ClaudeSdkAgent — 미커버 분기 (cov4):
 * - L77: is_available() catch → _available = false (createRequire.resolve throws)
 * - L86: run() → _load_query() null → _error_result("not installed") 반환
 *
 * node:module 을 mock하여 createRequire가 resolve 시 throw하도록 설정 → L77 커버.
 * _load_query를 인스턴스 수준에서 null 반환으로 교체 → L86 커버.
 */
import { describe, it, expect, vi } from "vitest";

// createRequire.resolve가 throw하도록 node:module mock → L77 커버
vi.mock("node:module", async (importOriginal) => {
  const mod = await importOriginal<typeof import("node:module")>();
  return {
    ...mod,
    createRequire: vi.fn(() => ({
      resolve: vi.fn(() => {
        throw new Error("Cannot find module '@anthropic-ai/claude-agent-sdk'");
      }),
    })),
  };
});

import { ClaudeSdkAgent } from "@src/agent/backends/claude-sdk.agent.js";
import type { AgentRunOptions } from "@src/agent/agent.types.js";

function make_opts(): AgentRunOptions {
  return { task_id: "t1", task: "test task", system_prompt: "sys", messages: [] };
}

// ── L77: is_available() → createRequire.resolve throws → _available = false ──

describe("ClaudeSdkAgent — L77: is_available() catch → false", () => {
  it("createRequire.resolve throws → catch → this._available = false (L77)", () => {
    const agent = new ClaudeSdkAgent({} as any);
    // checked를 false로 리셋하여 is_available() 내부 로직 강제 실행
    (agent as any).checked = false;
    (agent as any)._available = true;

    const avail = agent.is_available();
    expect(avail).toBe(false);
    expect((agent as any)._available).toBe(false);
  });

  it("is_available() 이후 checked=true → 두 번째 호출 시 재실행 안 함 → false 유지", () => {
    const agent = new ClaudeSdkAgent({} as any);
    (agent as any).checked = false;

    agent.is_available(); // 첫 번째 → L77 fire
    const avail2 = agent.is_available(); // 두 번째 → checked=true → 재실행 없음
    expect(avail2).toBe(false);
  });
});

// ── L86: run() → _load_query null → _error_result 반환 ───────────────────────

describe("ClaudeSdkAgent — L86: run() → SDK not installed → error result", () => {
  it("_load_query null 반환 → L86: _error_result('not installed') 반환", async () => {
    const agent = new ClaudeSdkAgent({} as any);
    // _load_query를 null 반환으로 교체 → L86 커버
    (agent as any)._load_query = async () => null;

    const result = await agent.run(make_opts());
    expect(result.content).toContain("not installed");
    expect(result.finish_reason).toBe("error");
  });
});
