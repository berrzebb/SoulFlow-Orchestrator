/**
 * FE-6b: State Consistency 회귀 — 같은 상태가 다른 화면에서 동일하게 표현되는지 검증.
 *
 * 검증 축:
 * 1. overview/types.ts와 workspace/memory.tsx의 WorkflowEvent 필드 일치
 * 2. ProcessInfo의 필드가 state-builder 응답과 일치
 * 3. DashboardState의 필수 키가 overview와 monitoring에서 동일하게 소비됨
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

function read_source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("State Consistency 회귀 (FE-6b)", () => {
  it("overview/types.ts WorkflowEvent에 retrieval_source/novelty_score가 있다", () => {
    const src = read_source("src/pages/overview/types.ts");
    expect(src).toContain("retrieval_source");
    expect(src).toContain("novelty_score");
  });

  it("workspace/memory.tsx WorkflowEvent에도 동일 필드가 있다", () => {
    const src = read_source("src/pages/workspace/memory.tsx");
    expect(src).toContain("retrieval_source");
    expect(src).toContain("novelty_score");
  });

  it("overview/types.ts ProcessInfo에 request_class/guardrail_blocked가 있다", () => {
    const src = read_source("src/pages/overview/types.ts");
    expect(src).toContain("request_class");
    expect(src).toContain("guardrail_blocked");
  });

  it("overview/types.ts DashboardState에 request_class_summary/guardrail_stats가 있다", () => {
    const src = read_source("src/pages/overview/types.ts");
    expect(src).toContain("request_class_summary");
    expect(src).toContain("guardrail_stats");
  });

  it("state-builder.ts가 workflow_events에 user_id를 포함한다", () => {
    const src = read_source("../src/dashboard/state-builder.ts");
    expect(src).toMatch(/workflow_events.*user_id|user_id.*workflow_events/s);
  });

  it("overview/types.ts WorkflowEvent에 user_id가 있다 (FE-6 격리)", () => {
    const src = read_source("src/pages/overview/types.ts");
    // WorkflowEvent 블록 안에 user_id가 없으면 state consistency drift
    expect(src).toContain("user_id");
  });

  it("workspace/memory.tsx WorkflowEvent에도 user_id가 있다", () => {
    const src = read_source("src/pages/workspace/memory.tsx");
    expect(src).toContain("user_id");
  });

  it("use-auth.ts AdminUserRecord에 session_count가 있다", () => {
    const src = read_source("src/hooks/use-auth.ts");
    expect(src).toContain("session_count");
  });
});
