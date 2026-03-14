import { describe, it, expect } from "vitest";
import {
  load_repo_profile,
  create_default_profile,
  DEFAULT_REPO_PROFILE,
} from "@src/repo-profile/repo-profile.ts";

// ── load_repo_profile — 기본 동작 ──────────────────────────────────────────

describe("load_repo_profile — 기본 동작", () => {
  it("repo_id만 있어도 유효한 profile 반환", () => {
    const p = load_repo_profile({ repo_id: "myrepo" });
    expect(p.repo_id).toBe("myrepo");
    expect(p.capabilities).toEqual([]);
    expect(p.commands).toEqual({});
    expect(p.protected_paths).toEqual([]);
  });

  it("전체 필드 포함 시 정확히 매핑", () => {
    const p = load_repo_profile({
      repo_id: "proj",
      capabilities: ["lint", "test"],
      commands: { lint: "npx eslint .", test: "npx vitest run" },
      protected_paths: ["src/auth/"],
    });
    expect(p.capabilities).toEqual(["lint", "test"]);
    expect(p.commands.lint).toBe("npx eslint .");
    expect(p.commands.test).toBe("npx vitest run");
    expect(p.protected_paths).toContain("src/auth/");
  });

  it("typecheck command 포함", () => {
    const p = load_repo_profile({ repo_id: "r", commands: { typecheck: "npx tsc --noEmit" } });
    expect(p.commands.typecheck).toBe("npx tsc --noEmit");
  });
});

// ── load_repo_profile — 유효성 검사 ────────────────────────────────────────

describe("load_repo_profile — 유효성 검사", () => {
  it("repo_id 없으면 throw", () => {
    expect(() => load_repo_profile({})).toThrow("repo_id");
  });

  it("빈 repo_id → throw", () => {
    expect(() => load_repo_profile({ repo_id: "" })).toThrow("repo_id");
  });

  it("null 입력 → throw", () => {
    expect(() => load_repo_profile(null)).toThrow();
  });

  it("알 수 없는 capability 필터링", () => {
    const p = load_repo_profile({ repo_id: "r", capabilities: ["lint", "unknown_cap", "test"] });
    expect(p.capabilities).toEqual(["lint", "test"]);
  });

  it("protected_paths의 비문자열 항목 필터링", () => {
    const p = load_repo_profile({ repo_id: "r", protected_paths: ["src/", 42, true, null] });
    expect(p.protected_paths).toEqual(["src/"]);
  });

  it("commands의 비문자열 값 무시", () => {
    const p = load_repo_profile({ repo_id: "r", commands: { lint: 123, test: "vitest run" } });
    expect(p.commands.lint).toBeUndefined();
    expect(p.commands.test).toBe("vitest run");
  });
});

// ── create_default_profile ─────────────────────────────────────────────────

describe("create_default_profile", () => {
  it("repo_id 설정, 나머지 빈 기본값", () => {
    const p = create_default_profile("test-repo");
    expect(p.repo_id).toBe("test-repo");
    expect(p.capabilities).toHaveLength(0);
    expect(p.protected_paths).toHaveLength(0);
    expect(Object.keys(p.commands)).toHaveLength(0);
  });
});

// ── DEFAULT_REPO_PROFILE ───────────────────────────────────────────────────

describe("DEFAULT_REPO_PROFILE", () => {
  it("repo_id=default, 빈 commands/capabilities/protected_paths", () => {
    expect(DEFAULT_REPO_PROFILE.repo_id).toBe("default");
    expect(DEFAULT_REPO_PROFILE.capabilities).toHaveLength(0);
    expect(DEFAULT_REPO_PROFILE.protected_paths).toHaveLength(0);
    expect(Object.keys(DEFAULT_REPO_PROFILE.commands)).toHaveLength(0);
  });
});
