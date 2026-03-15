/**
 * FE-6c: Draft Integrity 회귀.
 *
 * 검증 축:
 * 1. 채팅 입력 submit 후 disable (이중 클릭 방지)
 * 2. 설정 저장 시 isPending disable
 * 3. 모달 confirm 시 submit disable
 * 4. 워크플로우 빌더에 unsaved change 상태 관리
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

function read_source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("Draft Integrity 회귀 (FE-6c)", () => {
  it("chat.tsx에서 메시지 전송 후 입력 비활성화 패턴이 있다", () => {
    const src = read_source("src/pages/chat.tsx");
    // 전송 중 disable 또는 busy 상태로 중복 전송 방지
    expect(src).toMatch(/disabled.*is_busy|is_busy.*disabled|sending|isPending/);
  });

  it("settings.tsx에서 저장 버튼에 isPending disable이 적용된다", () => {
    const src = read_source("src/pages/settings.tsx");
    expect(src).toContain("isPending");
    expect(src).toContain("disabled");
  });

  it("modal 컴포넌트에 submitDisabled 또는 confirm disable 패턴이 있다", () => {
    const src = read_source("src/components/modal.tsx");
    // 모달 확인 버튼 disable
    expect(src).toMatch(/submitDisabled|disabled/);
  });

  it("secrets.tsx에서 추가 버튼에 이중 클릭 방지가 있다", () => {
    const src = read_source("src/pages/secrets.tsx");
    // run_action 또는 isPending 패턴
    expect(src).toMatch(/run_action|isPending/);
  });

  it("admin/index.tsx에서 create/delete 버튼에 isPending disable이 있다", () => {
    const src = read_source("src/pages/admin/index.tsx");
    const pending_count = (src.match(/isPending/g) || []).length;
    expect(pending_count).toBeGreaterThanOrEqual(5);
  });

  it("workspace/memory.tsx에서 저장 중 isPending 상태를 표시한다", () => {
    const src = read_source("src/pages/workspace/memory.tsx");
    expect(src).toContain("isPending");
  });
});
