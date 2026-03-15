/**
 * FE-6d: Mobile + Accessibility 회귀.
 *
 * 검증 축:
 * 1. 핵심 페이지에 aria-label / role 속성 존재
 * 2. 터치 타겟 최소 크기 패턴 (btn 클래스)
 * 3. keyboard navigation 패턴 (onKeyDown)
 * 4. 모바일 반응형 패턴 (useIsMobile, matchMedia, 반응형 클래스)
 * 5. focus trap / focus management 패턴
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

function read_source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("Accessibility 회귀 (FE-6d)", () => {
  it("settings.tsx 탭에 role=tablist과 aria-selected가 있다", () => {
    const src = read_source("src/pages/settings.tsx");
    expect(src).toContain('role="tablist"');
    expect(src).toContain("aria-selected");
  });

  it("admin/index.tsx 탭에 role=tablist과 aria-selected가 있다", () => {
    const src = read_source("src/pages/admin/index.tsx");
    expect(src).toContain('role="tablist"');
    expect(src).toContain("aria-selected");
  });

  it("settings.tsx에 aria-label이 있다 (접근성)", () => {
    const src = read_source("src/pages/settings.tsx");
    expect(src).toContain("aria-label");
  });

  it("ws-shared.tsx WsListItem에 role=button과 tabIndex=0이 있다", () => {
    const src = read_source("src/pages/workspace/ws-shared.tsx");
    expect(src).toContain('role="button"');
    expect(src).toContain("tabIndex={0}");
  });

  it("ws-shared.tsx WsListItem에 keyboard navigation이 있다 (Enter/Space)", () => {
    const src = read_source("src/pages/workspace/ws-shared.tsx");
    expect(src).toContain("onKeyDown");
    expect(src).toContain('"Enter"');
    expect(src).toContain('" "');
  });

  it("modal.tsx에 ESC 키 닫기 또는 onClose 패턴이 있다", () => {
    const src = read_source("src/components/modal.tsx");
    expect(src).toMatch(/onClose|Escape|handleClose/);
  });

  it("chat-status-bar.tsx에 aria-label이 있다", () => {
    const src = read_source("src/pages/chat/chat-status-bar.tsx");
    expect(src).toContain("aria-label");
  });
});

describe("Mobile Responsive 회귀 (FE-6d)", () => {
  it("secrets.tsx에 useIsMobile 또는 모바일 분기가 있다", () => {
    const src = read_source("src/pages/secrets.tsx");
    expect(src).toMatch(/useIsMobile|is_mobile|matchMedia|secret-card/);
  });

  it("secrets.tsx에 모바일 카드 레이아웃이 있다", () => {
    const src = read_source("src/pages/secrets.tsx");
    expect(src).toContain("secret-card");
  });

  it("workspace/split-pane.tsx에 반응형 클래스가 있다", () => {
    const src = read_source("src/pages/workspace/split-pane.tsx");
    expect(src).toContain("ws-split");
  });

  it("overview에 stat-grid 반응형 레이아웃이 있다", () => {
    const src = read_source("src/pages/admin/monitoring-panel.tsx");
    expect(src).toContain("stat-grid");
  });

  it("workflow detail에 collapse 또는 반응형 패턴이 있다", () => {
    const src = read_source("src/pages/workflows/detail.tsx");
    // 모바일에서 패널 축소 가능
    expect(src).toMatch(/collapse|Collapsible|panel/i);
  });
});
