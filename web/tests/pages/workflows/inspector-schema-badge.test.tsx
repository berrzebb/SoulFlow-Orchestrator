/**
 * FE-3: NodeOutputView — schema_valid / schema_repaired 배지 조건부 렌더 테스트.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NodeOutputView } from "@/pages/workflows/inspector-output";
import type { NodeExecutionState } from "@/pages/workflows/node-inspector";

vi.mock("@/i18n", () => ({ useT: () => (key: string) => key }));

function make_state(overrides: Partial<NodeExecutionState> = {}): NodeExecutionState {
  return {
    node_id: "n1",
    node_type: "llm",
    status: "completed",
    result: "output text",
    started_at: "2026-01-01T00:00:00Z",
    completed_at: "2026-01-01T00:00:01Z",
    ...overrides,
  };
}

describe("NodeOutputView — 스키마 검증 배지", () => {
  it("schema_valid/repaired 모두 없으면 배지 미렌더", () => {
    render(<NodeOutputView state={make_state()} schema={[]} node_id="n1" />);
    expect(screen.queryByText("workflows.schema_valid")).toBeNull();
    expect(screen.queryByText("workflows.schema_invalid")).toBeNull();
    expect(screen.queryByText("workflows.schema_repaired")).toBeNull();
  });

  it("schema_valid=true → 통과 배지 렌더", () => {
    render(<NodeOutputView state={make_state({ schema_valid: true })} schema={[]} node_id="n1" />);
    // 배지 텍스트: "✓ workflows.schema_valid" — exact: false로 서브스트링 매칭
    expect(screen.getByText("workflows.schema_valid", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("workflows.schema_invalid", { exact: false })).toBeNull();
  });

  it("schema_valid=false → 실패 배지 렌더", () => {
    render(<NodeOutputView state={make_state({ schema_valid: false })} schema={[]} node_id="n1" />);
    expect(screen.getByText("workflows.schema_invalid", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("workflows.schema_valid", { exact: false })).toBeNull();
  });

  it("schema_repaired=true → 자동수정 배지 렌더", () => {
    render(<NodeOutputView state={make_state({ schema_valid: true, schema_repaired: true })} schema={[]} node_id="n1" />);
    expect(screen.getByText("workflows.schema_repaired", { exact: false })).toBeInTheDocument();
  });

  it("schema_repaired=true + schema_valid=false → 두 배지 모두 렌더", () => {
    render(<NodeOutputView state={make_state({ schema_valid: false, schema_repaired: true })} schema={[]} node_id="n1" />);
    expect(screen.getByText("workflows.schema_invalid", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("workflows.schema_repaired", { exact: false })).toBeInTheDocument();
  });

  it("pending 상태 → 배지 미렌더 (pending 뷰 렌더)", () => {
    render(<NodeOutputView state={make_state({ status: "pending" })} schema={[]} node_id="n1" />);
    expect(screen.queryByText("workflows.schema_valid")).toBeNull();
    expect(screen.getByText("workflows.node_pending")).toBeInTheDocument();
  });
});
