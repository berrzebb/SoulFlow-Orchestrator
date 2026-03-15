/**
 * FE-6c: Duplicated Surface Path Detection — 렌더 + import 기반 검증.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PAGE_POLICIES } from "@/pages/access-policy";
import { readFileSync } from "node:fs";

// ── 모킹 ──────────────────────────────────────────────────────────────────────

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(() => ({ data: undefined, isLoading: false })),
  useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/i18n", () => ({
  useT: () => (key: string) => key,
}));

// ── ws-shared 공유 컴포넌트 직접 렌더 ──────────────────────────────────────

import { WsListItem, WsSkeletonCol } from "@/pages/workspace/ws-shared";

describe("Duplicated Surface — 공유 컴포넌트 렌더 검증 (FE-6c)", () => {
  it("WsListItem이 정상 렌더된다 (공유 컴포넌트)", () => {
    render(<WsListItem id="t" active={false} onClick={vi.fn()}>Test</WsListItem>);
    expect(screen.getByText("Test")).toBeInTheDocument();
  });

  it("WsSkeletonCol이 정상 렌더된다 (공유 컴포넌트)", () => {
    const { container } = render(<WsSkeletonCol rows={["text", "card"]} />);
    expect(container.querySelectorAll(".skeleton").length).toBe(2);
  });

  it("PAGE_POLICIES에 중복 path가 없다", () => {
    const paths = PAGE_POLICIES.map((p) => p.path);
    const unique = new Set(paths);
    expect(unique.size).toBe(paths.length);
  });
});

describe("Duplicated Surface — 공유 훅 단일 소스 검증 (FE-6c)", () => {
  it("useT가 i18n 접근의 단일 소스이다 (주요 페이지에서 import)", () => {
    const files = [
      "src/pages/admin/index.tsx", "src/pages/settings.tsx",
      "src/pages/secrets.tsx", "src/pages/workspace/memory.tsx",
    ];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file}에 useT import 누락`).toContain("useT");
    }
  });

  it("useToast가 토스트 알림의 단일 소스이다", () => {
    const files = [
      "src/pages/admin/index.tsx", "src/pages/settings.tsx",
      "src/pages/secrets.tsx", "src/pages/workspace/memory.tsx",
    ];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file}에 useToast import 누락`).toContain("useToast");
    }
  });
});
