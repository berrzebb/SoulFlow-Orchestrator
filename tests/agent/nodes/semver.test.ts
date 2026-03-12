/**
 * SemverTool 미커버 경로:
 * - compare: 잘못된 버전 → "invalid version(s)"
 * - satisfies: 잘못된 버전, 다양한 연산자 (<=, <, ~, ^, default)
 * - bump: 잘못된 버전
 * - diff: 동일 버전 ("none"), prerelease 변경
 * - to_string: prerelease/build 포함 버전
 */
import { describe, it, expect } from "vitest";
import { SemverTool } from "@src/agent/tools/semver.js";

const tool = new SemverTool();

describe("SemverTool — 잘못된 버전 에러", () => {
  it("compare: 잘못된 버전 → Error 반환", async () => {
    const result = await tool.execute({ action: "compare", version: "not-semver", version2: "1.0.0" });
    expect(result).toContain("invalid version");
  });

  it("satisfies: 잘못된 버전 → Error 반환", async () => {
    const result = await tool.execute({ action: "satisfies", version: "abc", range: ">=1.0.0" });
    expect(result).toContain("invalid version");
  });

  it("bump: 잘못된 버전 → Error 반환", async () => {
    const result = await tool.execute({ action: "bump", version: "invalid", bump_type: "patch" });
    expect(result).toContain("invalid version");
  });
});

describe("SemverTool — diff 케이스", () => {
  it("동일 버전 → diff=none", async () => {
    const result = await tool.execute({ action: "diff", version: "1.2.3", version2: "1.2.3" });
    const parsed = JSON.parse(result);
    expect(parsed.diff).toBe("none");
  });

  it("prerelease 다름 → diff=prerelease", async () => {
    const result = await tool.execute({ action: "diff", version: "1.2.3-alpha", version2: "1.2.3-beta" });
    const parsed = JSON.parse(result);
    expect(parsed.diff).toBe("prerelease");
  });
});

describe("SemverTool — satisfies 연산자", () => {
  it("<= 연산자: 1.0.0 satisfies <=1.0.0 → true", async () => {
    const result = await tool.execute({ action: "satisfies", version: "1.0.0", range: "<=1.0.0" });
    const parsed = JSON.parse(result);
    expect(parsed.satisfies).toBe(true);
  });

  it("< 연산자: 0.9.0 satisfies <1.0.0 → true", async () => {
    const result = await tool.execute({ action: "satisfies", version: "0.9.0", range: "<1.0.0" });
    const parsed = JSON.parse(result);
    expect(parsed.satisfies).toBe(true);
  });

  it("~ 연산자: 1.2.5 satisfies ~1.2.3 → true", async () => {
    const result = await tool.execute({ action: "satisfies", version: "1.2.5", range: "~1.2.3" });
    const parsed = JSON.parse(result);
    expect(parsed.satisfies).toBe(true);
  });

  it("^ 연산자: 1.5.0 satisfies ^1.0.0 → true", async () => {
    const result = await tool.execute({ action: "satisfies", version: "1.5.0", range: "^1.0.0" });
    const parsed = JSON.parse(result);
    expect(parsed.satisfies).toBe(true);
  });

  it("잘못된 comparator pattern → default: true 반환", async () => {
    // 매칭 안 되는 range → check_comparator: m=null → return true
    const result = await tool.execute({ action: "satisfies", version: "1.0.0", range: "!!!" });
    const parsed = JSON.parse(result);
    expect(parsed.satisfies).toBe(true);
  });
});

describe("SemverTool — to_string prerelease/build", () => {
  it("prerelease bump → bumped 결과에 -prerelease 포함", async () => {
    // 1.0.0-alpha → prerelease bump → 1.0.0-alpha.1 (to_string에 prerelease 경로 실행)
    const result = await tool.execute({ action: "bump", version: "1.0.0-alpha", bump_type: "prerelease" });
    const parsed = JSON.parse(result);
    expect(parsed.bumped).toContain("-");
  });
});
