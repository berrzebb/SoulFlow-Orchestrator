/**
 * FE-6c: Sensitive Rendering Security 회귀 — 실제 렌더 기반 검증.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// ── 모킹 ──────────────────────────────────────────────────────────────────────

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === "secrets") return { data: { names: ["DB_PASS", "API_KEY"] } };
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

// ── 테스트 ────────────────────────────────────────────────────────────────────

describe("Sensitive Rendering — secrets.tsx 렌더 검증 (FE-6c)", () => {
  it("시크릿 이름은 표시되지만 값은 노출되지 않는다", () => {
    render(<SecretsPage />);
    expect(screen.getByText("DB_PASS")).toBeInTheDocument();
    expect(screen.getByText("API_KEY")).toBeInTheDocument();
    // 값은 API에서 반환되지 않으므로 렌더될 수 없음
  });

  it("시크릿 사용법이 {{secret:NAME}} 형태로 표시된다", () => {
    render(<SecretsPage />);
    expect(screen.getByText("{{secret:DB_PASS}}")).toBeInTheDocument();
  });
});
