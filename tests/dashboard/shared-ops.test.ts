/**
 * dashboard/ops/shared — sanitize_rel_path / sanitize_filename / is_inside 순수 함수 테스트.
 */
import { describe, it, expect } from "vitest";
import {
  sanitize_rel_path,
  sanitize_filename,
  is_inside,
} from "../../src/dashboard/ops/shared.js";
import { resolve } from "node:path";

// ══════════════════════════════════════════
// sanitize_rel_path
// ══════════════════════════════════════════

describe("sanitize_rel_path()", () => {
  it("정상 경로 → 그대로", () => {
    expect(sanitize_rel_path("skills/my-skill.md")).toBe("skills/my-skill.md");
  });

  it("../ 제거", () => {
    const result = sanitize_rel_path("../../etc/passwd");
    expect(result).not.toContain("..");
  });

  it("선행 슬래시 제거", () => {
    expect(sanitize_rel_path("/etc/passwd")).toBe("etc/passwd");
  });

  it("백슬래시 선행 제거", () => {
    const result = sanitize_rel_path("\\windows\\system32");
    expect(result).not.toMatch(/^[\\/]/);
  });

  it("빈 문자열 → 빈 문자열", () => {
    expect(sanitize_rel_path("")).toBe("");
  });

  it("중첩 경로 트래버설 → .. 제거", () => {
    const result = sanitize_rel_path("a/b/../c");
    expect(result).not.toContain("..");
  });
});

// ══════════════════════════════════════════
// sanitize_filename
// ══════════════════════════════════════════

describe("sanitize_filename()", () => {
  it("정상 파일명 → 그대로", () => {
    expect(sanitize_filename("SKILL.md")).toBe("SKILL.md");
  });

  it("슬래시 제거", () => {
    expect(sanitize_filename("path/file.txt")).not.toContain("/");
  });

  it("백슬래시 제거", () => {
    expect(sanitize_filename("path\\file.txt")).not.toContain("\\");
  });

  it(".. 제거", () => {
    expect(sanitize_filename("../secret.md")).not.toContain("..");
  });

  it("빈 문자열 → 빈 문자열", () => {
    expect(sanitize_filename("")).toBe("");
  });

  it("일반 파일명 유지", () => {
    expect(sanitize_filename("my-file_v2.ts")).toBe("my-file_v2.ts");
  });
});

// ══════════════════════════════════════════
// is_inside
// ══════════════════════════════════════════

describe("is_inside()", () => {
  const base = resolve("/tmp/workspace");

  it("base와 동일 → true", () => {
    expect(is_inside(base, base)).toBe(true);
  });

  it("base 하위 → true", () => {
    expect(is_inside(base, resolve("/tmp/workspace/skills/my-skill.md"))).toBe(true);
  });

  it("base 외부 → false", () => {
    expect(is_inside(base, resolve("/tmp/other"))).toBe(false);
  });

  it("부분 일치지만 다른 경로 → false", () => {
    // /tmp/workspace-evil ≠ /tmp/workspace 하위
    expect(is_inside(base, resolve("/tmp/workspace-evil/file"))).toBe(false);
  });
});
