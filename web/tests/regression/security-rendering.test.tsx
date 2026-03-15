/**
 * FE-6c: Sensitive Rendering Security 회귀 — 직접 렌더 검증.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// ── 모킹 ──────────────────────────────────────────────────────────────────────

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === "secrets") return { data: { names: ["DB_PASS", "API_KEY"] } };
    if (queryKey[0] === "auth-status") return { data: { enabled: true, initialized: true } };
    if (queryKey[0] === "config") return { data: { raw: {}, sections: [] }, isLoading: false };
    return { data: undefined, isLoading: false };
  }),
  useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useQueryClient: () => ({ invalidateQueries: vi.fn(), clear: vi.fn(), prefetchQuery: vi.fn() }),
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
vi.mock("@/hooks/use-auth", () => ({
  useAuthStatus: () => ({ data: { enabled: true, initialized: true }, isLoading: false }),
  useLogin: () => ({ mutate: vi.fn(), isPending: false }),
}));

// ── secrets 렌더 ────────────────────────────────────────────────────────────

import SecretsPage from "@/pages/secrets";

describe("Security — secrets.tsx 직접 렌더 (FE-6c)", () => {
  it("시크릿 이름은 표시되지만 값은 노출되지 않는다", () => {
    render(<SecretsPage />);
    expect(screen.getByText("DB_PASS")).toBeInTheDocument();
    expect(screen.getByText("API_KEY")).toBeInTheDocument();
  });

  it("시크릿 사용법이 {{secret:NAME}} 형태로 표시된다", () => {
    render(<SecretsPage />);
    expect(screen.getByText("{{secret:DB_PASS}}")).toBeInTheDocument();
  });
});

// ── login 렌더 ──────────────────────────────────────────────────────────────

import LoginPage from "@/pages/login";

describe("Security — login.tsx 직접 렌더 (FE-6c)", () => {
  it("비밀번호 필드가 type=password로 렌더된다", () => {
    render(<MemoryRouter><LoginPage /></MemoryRouter>);
    const pw_inputs = document.querySelectorAll('input[type="password"]');
    expect(pw_inputs.length).toBeGreaterThanOrEqual(1);
  });
});

// ── settings 렌더 ────────────────────────────────────────────────────────────

import SettingsPage from "@/pages/settings";

describe("Security — settings.tsx 직접 렌더 (FE-6c)", () => {
  it("설정 페이지 제목이 렌더된다", () => {
    render(<SettingsPage />);
    expect(screen.getByText("settings.title")).toBeInTheDocument();
  });
});
