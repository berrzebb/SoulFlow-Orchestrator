/**
 * FE-6b: Stale State / Freshness 회귀 — SSE stale 감지와 데이터 freshness 표면 검증.
 *
 * 검증 축:
 * 1. root.tsx SSE stale 감지가 30초 임계값으로 동작
 * 2. workspace sessions/memory에 refetchInterval이 설정되어 있음 (stale 방지)
 * 3. overview/monitoring에 refetchInterval이 설정되어 있음
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

function read_source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("Stale State / Freshness 회귀 (FE-6b)", () => {
  it("root.tsx에 SSE stale 감지 로직이 존재한다 (30초 임계값)", () => {
    const src = read_source("src/layouts/root.tsx");
    expect(src).toContain("sse_stale");
    expect(src).toContain("last_event_at");
    // 30초 = 30_000ms 또는 30000
    expect(src).toMatch(/30[_]?000/);
  });

  it("workspace/sessions.tsx에 refetchInterval이 설정되어 있다", () => {
    const src = read_source("src/pages/workspace/sessions.tsx");
    expect(src).toContain("refetchInterval");
  });

  it("workspace/memory.tsx에 state 쿼리의 refetchInterval이 설정되어 있다", () => {
    const src = read_source("src/pages/workspace/memory.tsx");
    expect(src).toMatch(/refetchInterval.*10[_]?000/);
  });

  it("workspace/agents.tsx에 agents/loops/tasks/processes refetchInterval이 설정되어 있다", () => {
    const src = read_source("src/pages/workspace/agents.tsx");
    const intervals = (src.match(/refetchInterval/g) || []).length;
    expect(intervals).toBeGreaterThanOrEqual(4);
  });

  it("admin/monitoring-panel.tsx에 system-metrics refetchInterval이 설정되어 있다", () => {
    const src = read_source("src/pages/admin/monitoring-panel.tsx");
    expect(src).toContain("refetchInterval");
  });

  it("chat.tsx에 chat-sessions refetchInterval이 설정되어 있다", () => {
    const src = read_source("src/pages/chat.tsx");
    expect(src).toContain("refetchInterval");
  });
});
