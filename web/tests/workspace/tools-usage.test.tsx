/**
 * FE-5: ToolsTab — usage_count + last_used_at 렌더 테스트.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ── 모킹 ──────────────────────────────────────────────────────────────────────

const mockUseQuery = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

vi.mock("@/i18n", () => ({
  useT: () => (key: string, p?: Record<string, string>) =>
    p ? `${key}:${JSON.stringify(p)}` : key,
}));

vi.mock("@/utils/format", () => ({
  time_ago: (v: string) => v ? "2h ago" : "-",
}));

import { ToolsTab } from "@/pages/workspace/tools";

function make_tool(name: string, overrides: Record<string, unknown> = {}) {
  return {
    type: "function",
    function: { name, description: `${name} tool`, parameters: {} },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── 테스트 ────────────────────────────────────────────────────────────────────

describe("ToolsTab — usage_count + last_used_at (FE-5)", () => {
  it("usage_count가 있으면 호출 횟수를 렌더한다", () => {
    mockUseQuery.mockReturnValue({
      data: {
        names: ["search"],
        definitions: [make_tool("search", { usage_count: 42 })],
        mcp_servers: [],
      },
      isLoading: false,
    });
    render(<ToolsTab />);
    expect(screen.getByTestId("tool-usage")).toHaveTextContent("42 calls");
  });

  it("usage_count=0이면 호출 횟수를 렌더하지 않는다", () => {
    mockUseQuery.mockReturnValue({
      data: {
        names: ["read"],
        definitions: [make_tool("read", { usage_count: 0 })],
        mcp_servers: [],
      },
      isLoading: false,
    });
    render(<ToolsTab />);
    expect(screen.queryByTestId("tool-usage")).toBeNull();
  });

  it("usage_count가 없으면 호출 횟수를 렌더하지 않는다", () => {
    mockUseQuery.mockReturnValue({
      data: {
        names: ["write"],
        definitions: [make_tool("write")],
        mcp_servers: [],
      },
      isLoading: false,
    });
    render(<ToolsTab />);
    expect(screen.queryByTestId("tool-usage")).toBeNull();
  });

  it("last_used_at가 있으면 시간을 렌더한다", () => {
    mockUseQuery.mockReturnValue({
      data: {
        names: ["exec"],
        definitions: [make_tool("exec", { last_used_at: "2026-03-15T10:00:00Z" })],
        mcp_servers: [],
      },
      isLoading: false,
    });
    render(<ToolsTab />);
    expect(screen.getByTestId("tool-last-used")).toHaveTextContent("2h ago");
  });

  it("last_used_at가 없으면 시간을 렌더하지 않는다", () => {
    mockUseQuery.mockReturnValue({
      data: {
        names: ["noop"],
        definitions: [make_tool("noop")],
        mcp_servers: [],
      },
      isLoading: false,
    });
    render(<ToolsTab />);
    expect(screen.queryByTestId("tool-last-used")).toBeNull();
  });

  it("usage_count + last_used_at 둘 다 있으면 함께 렌더", () => {
    mockUseQuery.mockReturnValue({
      data: {
        names: ["both"],
        definitions: [make_tool("both", { usage_count: 7, last_used_at: "2026-03-15T08:00:00Z" })],
        mcp_servers: [],
      },
      isLoading: false,
    });
    render(<ToolsTab />);
    expect(screen.getByTestId("tool-usage")).toHaveTextContent("7 calls");
    expect(screen.getByTestId("tool-last-used")).toHaveTextContent("2h ago");
  });

  it("여러 도구가 각각의 usage_count를 렌더한다", () => {
    mockUseQuery.mockReturnValue({
      data: {
        names: ["a", "b"],
        definitions: [
          make_tool("a", { usage_count: 10 }),
          make_tool("b", { usage_count: 20 }),
        ],
        mcp_servers: [],
      },
      isLoading: false,
    });
    render(<ToolsTab />);
    const usages = screen.getAllByTestId("tool-usage");
    expect(usages).toHaveLength(2);
    expect(usages[0]).toHaveTextContent("10 calls");
    expect(usages[1]).toHaveTextContent("20 calls");
  });
});
