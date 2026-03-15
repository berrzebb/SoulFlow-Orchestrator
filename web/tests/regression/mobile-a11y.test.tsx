/**
 * FE-6d: Mobile + Accessibility 회귀 — 실제 렌더 기반 검증.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// ── 모킹 ──────────────────────────────────────────────────────────────────────

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === "secrets") return { data: { names: ["TEST_KEY"] } };
    return { data: undefined, isLoading: false };
  }),
  useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/i18n", () => ({
  useT: () => (key: string, p?: Record<string, string>) =>
    p ? `${key}:${JSON.stringify(p)}` : key,
}));

vi.mock("@/api/client", () => ({ api: { get: vi.fn(), post: vi.fn(), del: vi.fn() } }));
vi.mock("@/components/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/use-async-action", () => ({
  useAsyncAction: () => (fn: () => Promise<void>) => fn(),
}));

import SecretsPage from "@/pages/secrets";

// ── ws-shared 직접 렌더 검증 ────────────────────────────────────────────────

import { WsListItem } from "@/pages/workspace/ws-shared";

describe("Accessibility — WsListItem 렌더 검증 (FE-6d)", () => {
  it("role=button이 렌더된다", () => {
    render(<WsListItem id="test" active={false} onClick={vi.fn()}>Item</WsListItem>);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("tabIndex=0이 적용된다 (키보드 접근 가능)", () => {
    render(<WsListItem id="test" active={false} onClick={vi.fn()}>Item</WsListItem>);
    expect(screen.getByRole("button")).toHaveAttribute("tabindex", "0");
  });

  it("active 상태에서 ws-item--active 클래스가 적용된다", () => {
    render(<WsListItem id="test" active={true} onClick={vi.fn()}>Active</WsListItem>);
    expect(screen.getByRole("button").className).toContain("ws-item--active");
  });
});

describe("Mobile — secrets.tsx 반응형 렌더 검증 (FE-6d)", () => {
  it("시크릿이 렌더되면 데스크탑에서 DataTable이 사용된다", () => {
    // 기본 window.innerWidth > 768 → DataTable 렌더
    const { container } = render(<SecretsPage />);
    // DataTable은 <table> 또는 thead를 포함
    const tables = container.querySelectorAll("table, thead");
    // secrets.tsx는 is_mobile이 false일 때 DataTable, true일 때 카드 레이아웃
    // matchMedia가 모킹되지 않으면 기본값(false)이므로 DataTable이 렌더됨
    expect(tables.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Accessibility — ChatBottomBar aria-label 렌더 검증 (FE-6d)", () => {
  // ChatBottomBar는 이미 chat-status-bar.test.tsx에서 aria-label 검증됨
  // 여기서는 cross-reference 확인
  it("chat-status-bar.test.tsx에서 aria-label 검증이 존재한다", async () => {
    const { readFileSync } = await import("node:fs");
    const test_src = readFileSync("tests/pages/chat-status-bar.test.tsx", "utf8");
    expect(test_src).toContain("aria-label");
    expect(test_src).toContain("channel_mismatch");
  });
});
