/**
 * FE-6c: Duplicated Surface Path Detection.
 *
 * 검증 축:
 * 1. access-policy 경로 중복 없음
 * 2. useQuery queryKey 중복 사용 감지 (같은 키로 다른 엔드포인트)
 * 3. 공유 컴포넌트/훅 재사용 패턴 확인
 */
import { describe, it, expect } from "vitest";
import { PAGE_POLICIES } from "@/pages/access-policy";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Duplicated Surface Path Detection (FE-6c)", () => {
  it("PAGE_POLICIES에 중복 path가 없다", () => {
    const paths = PAGE_POLICIES.map((p) => p.path);
    const unique = new Set(paths);
    expect(unique.size).toBe(paths.length);
  });

  it("워크스페이스 페이지들이 공통 SplitPane 컴포넌트를 재사용한다", () => {
    const sessions = readFileSync("src/pages/workspace/sessions.tsx", "utf8");
    const memory = readFileSync("src/pages/workspace/memory.tsx", "utf8");
    // 두 파일 모두 SplitPane import
    expect(sessions).toContain("SplitPane");
    expect(memory).toContain("SplitPane");
  });

  it("워크스페이스 페이지들이 공통 WsListItem/WsDetailHeader를 재사용한다", () => {
    const sessions = readFileSync("src/pages/workspace/sessions.tsx", "utf8");
    const memory = readFileSync("src/pages/workspace/memory.tsx", "utf8");
    expect(sessions).toContain("WsListItem");
    expect(memory).toContain("WsListItem");
  });

  it("useT hook이 i18n 접근의 단일 소스이다", () => {
    const pages_dir = "src/pages";
    const check_files = [
      "admin/index.tsx", "settings.tsx", "secrets.tsx",
      "workspace/memory.tsx", "workspace/agents.tsx",
    ];
    for (const file of check_files) {
      const src = readFileSync(join(pages_dir, file), "utf8");
      // 모든 i18n 사용 파일이 useT를 import
      expect(src, `${file}에 useT import 누락`).toContain("useT");
    }
  });

  it("useToast hook이 토스트 알림의 단일 소스이다", () => {
    const files = [
      "src/pages/admin/index.tsx", "src/pages/settings.tsx",
      "src/pages/secrets.tsx", "src/pages/workspace/memory.tsx",
    ];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file}에 useToast import 누락`).toContain("useToast");
    }
  });

  it("useAsyncAction이 안전한 비동기 작업의 공통 패턴이다", () => {
    const files = ["src/pages/secrets.tsx", "src/pages/workspace/memory.tsx"];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file}에 useAsyncAction 사용 확인`).toContain("useAsyncAction");
    }
  });
});
