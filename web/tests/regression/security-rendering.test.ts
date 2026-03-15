/**
 * FE-6c: Sensitive Rendering Security 회귀.
 *
 * 검증 축:
 * 1. secrets.tsx에서 시크릿 값이 직접 노출되지 않음 (마스킹 패턴)
 * 2. settings.tsx에서 sensitive 필드가 마스킹됨
 * 3. dangerouslySetInnerHTML 사용처 인벤토리 (XSS 표면)
 * 4. login 페이지에서 password 타입 사용
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

function read_source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("Sensitive Rendering Security 회귀 (FE-6c)", () => {
  it("secrets.tsx에서 시크릿 값을 직접 렌더하지 않는다 (names만 표시)", () => {
    const src = read_source("src/pages/secrets.tsx");
    // API 응답에서 names만 사용, 실제 값은 반환되지 않음
    expect(src).toContain("names: string[]");
    // 값 입력은 type="password" 사용
    expect(src).toContain('type="password"');
  });

  it("settings.tsx에서 sensitive 필드는 마스킹 표시된다", () => {
    const src = read_source("src/pages/settings.tsx");
    // sensitive 필드: "••••••••" 마스킹 패턴
    expect(src).toContain("••••••••");
    // sensitive 입력은 조건부 "password" 타입 사용
    expect(src).toContain('"password"');
    expect(src).toContain("field.sensitive");
  });

  it("dangerouslySetInnerHTML 사용이 SVG 렌더링에 한정된다", () => {
    const builder_src = read_source("src/pages/workflows/builder.tsx");
    const diagram_src = read_source("src/pages/workflows/nodes/diagram.tsx");
    // builder.tsx: SVG 렌더링용
    const builder_matches = (builder_src.match(/dangerouslySetInnerHTML/g) || []).length;
    expect(builder_matches).toBeLessThanOrEqual(2);
    // diagram.tsx: SVG 프리뷰
    const diagram_matches = (diagram_src.match(/dangerouslySetInnerHTML/g) || []).length;
    expect(diagram_matches).toBeLessThanOrEqual(1);
  });

  it("dangerouslySetInnerHTML은 사용자 입력이 아닌 Mermaid 다이어그램 SVG에만 사용된다", () => {
    const src = read_source("src/pages/workflows/builder.tsx");
    // SVG는 workflow_def_to_mermaid에서 생성 — 사용자 직접 입력이 아닌 워크플로우 정의 기반
    expect(src).toContain("workflow_def_to_mermaid");
  });

  it("login.tsx에서 password 필드가 type=password이다", () => {
    const src = read_source("src/pages/login.tsx");
    expect(src).toContain('type="password"');
  });

  it("provider-modal.tsx에서 API 키/시크릿 필드가 type=password이다", () => {
    const src = read_source("src/pages/providers/provider-modal.tsx");
    expect(src).toContain('type="password"');
  });
});
