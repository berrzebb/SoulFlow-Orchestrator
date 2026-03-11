/**
 * ClaudeSdkAgent — 미커버 분기 (cov5):
 * - L545-547: _load_query catch → _available=false, checked=true, return null
 *
 * @anthropic-ai/claude-agent-sdk 를 throw하는 factory로 mock →
 * _load_query 내부 await import() 실패 → catch 블록(L545-547) 활성화 → null 반환 → L86 포함.
 */
import { describe, it, expect, vi } from "vitest";

// SDK 모듈 import 자체를 실패시킴 → _load_query catch 블록(L545-547) 커버
vi.mock("@anthropic-ai/claude-agent-sdk", () => {
  throw new Error("@anthropic-ai/claude-agent-sdk is not installed");
});

import { ClaudeSdkAgent } from "@src/agent/backends/claude-sdk.agent.js";
import type { AgentRunOptions } from "@src/agent/agent.types.js";

function make_opts(): AgentRunOptions {
  return { task_id: "t2", task: "sdk fail test", system_prompt: "", messages: [] };
}

// ── L545-547: _load_query catch → null ────────────────────────────────────────

describe("ClaudeSdkAgent — L545-547: _load_query dynamic import 실패 → catch", () => {
  it("await import() 실패 → catch → _available=false, checked=true, return null (L545-547)", async () => {
    const agent = new ClaudeSdkAgent({} as any);

    const result = await (agent as any)._load_query();

    expect(result).toBeNull();                        // L547: return null
    expect((agent as any)._available).toBe(false);   // L545
    expect((agent as any).checked).toBe(true);        // L546
  });

  it("run() 호출 시 _load_query null 경로 → L86: not installed error result", async () => {
    const agent = new ClaudeSdkAgent({} as any);
    const result = await agent.run(make_opts());

    expect(result.content).toContain("not installed");
    expect(result.finish_reason).toBe("error");
  });
});
