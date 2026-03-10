/**
 * SemverTool — parse/compare/satisfies/bump/sort/diff/valid 테스트.
 */
import { describe, it, expect } from "vitest";
import { SemverTool } from "../../../src/agent/tools/semver.js";

const tool = new SemverTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

describe("SemverTool — parse", () => {
  it("기본 버전 파싱", async () => {
    const r = await exec({ action: "parse", version: "1.2.3" }) as Record<string, unknown>;
    expect(r.major).toBe(1);
    expect(r.minor).toBe(2);
    expect(r.patch).toBe(3);
  });

  it("v 접두사 제거", async () => {
    const r = await exec({ action: "parse", version: "v2.0.0" }) as Record<string, unknown>;
    expect(r.major).toBe(2);
    expect(r.minor).toBe(0);
  });

  it("프리릴리즈 파싱", async () => {
    const r = await exec({ action: "parse", version: "1.0.0-alpha.1" }) as Record<string, unknown>;
    expect(r.prerelease).toBe("alpha.1");
  });

  it("빌드 메타데이터 파싱", async () => {
    const r = await exec({ action: "parse", version: "1.0.0+build.123" }) as Record<string, unknown>;
    expect(r.build).toBe("build.123");
  });

  it("잘못된 버전 → Error", async () => {
    const r = await exec({ action: "parse", version: "not-a-version" });
    expect(String(r)).toContain("Error");
  });
});

describe("SemverTool — compare", () => {
  it("더 높은 버전 > 낮은 버전", async () => {
    const r = await exec({ action: "compare", version: "2.0.0", version2: "1.0.0" }) as Record<string, unknown>;
    expect(Number(r.result)).toBeGreaterThan(0);
    expect(r.description).toBe("greater");
  });

  it("낮은 버전 < 높은 버전", async () => {
    const r = await exec({ action: "compare", version: "1.0.0", version2: "2.0.0" }) as Record<string, unknown>;
    expect(Number(r.result)).toBeLessThan(0);
    expect(r.description).toBe("less");
  });

  it("동일 버전 → result: 0", async () => {
    const r = await exec({ action: "compare", version: "1.0.0", version2: "1.0.0" }) as Record<string, unknown>;
    expect(r.result).toBe(0);
    expect(r.description).toBe("equal");
  });

  it("프리릴리즈는 정식보다 낮음", async () => {
    const r = await exec({ action: "compare", version: "1.0.0-alpha", version2: "1.0.0" }) as Record<string, unknown>;
    expect(Number(r.result)).toBeLessThan(0);
  });
});

describe("SemverTool — satisfies", () => {
  it(">=1.0.0 범위 만족", async () => {
    const r = await exec({ action: "satisfies", version: "1.5.0", range: ">=1.0.0" }) as Record<string, unknown>;
    expect(r.satisfies).toBe(true);
  });

  it(">=2.0.0 범위 불만족", async () => {
    const r = await exec({ action: "satisfies", version: "1.5.0", range: ">=2.0.0" }) as Record<string, unknown>;
    expect(r.satisfies).toBe(false);
  });

  it("~1.2.0 범위 (patch 호환)", async () => {
    const r = await exec({ action: "satisfies", version: "1.2.5", range: "~1.2.0" }) as Record<string, unknown>;
    expect(r.satisfies).toBe(true);
  });

  it("^1.0.0 범위 (minor 호환)", async () => {
    const r = await exec({ action: "satisfies", version: "1.9.9", range: "^1.0.0" }) as Record<string, unknown>;
    expect(r.satisfies).toBe(true);
  });

  it("복합 범위 >=1.0.0 <2.0.0", async () => {
    const r = await exec({ action: "satisfies", version: "1.5.0", range: ">=1.0.0 <2.0.0" }) as Record<string, unknown>;
    expect(r.satisfies).toBe(true);
  });
});

describe("SemverTool — bump", () => {
  it("patch bump: 1.0.0 → 1.0.1", async () => {
    const r = await exec({ action: "bump", version: "1.0.0", bump_type: "patch" }) as Record<string, unknown>;
    expect(r.bumped).toBe("1.0.1");
  });

  it("minor bump: 1.0.5 → 1.1.0", async () => {
    const r = await exec({ action: "bump", version: "1.0.5", bump_type: "minor" }) as Record<string, unknown>;
    expect(r.bumped).toBe("1.1.0");
  });

  it("major bump: 1.9.9 → 2.0.0", async () => {
    const r = await exec({ action: "bump", version: "1.9.9", bump_type: "major" }) as Record<string, unknown>;
    expect(r.bumped).toBe("2.0.0");
  });

  it("prerelease bump: 1.0.0-alpha → 1.0.0-alpha.1", async () => {
    const r = await exec({ action: "bump", version: "1.0.0-alpha", bump_type: "prerelease" }) as Record<string, unknown>;
    expect(String(r.bumped)).toContain("alpha");
  });
});

describe("SemverTool — sort", () => {
  it("버전 목록 오름차순 정렬", async () => {
    const r = await exec({ action: "sort", versions: "2.0.0,1.0.0,1.5.0" }) as Record<string, unknown>;
    const sorted = r.sorted as string[];
    expect(sorted[0]).toBe("1.0.0");
    expect(sorted[1]).toBe("1.5.0");
    expect(sorted[2]).toBe("2.0.0");
  });
});

describe("SemverTool — diff", () => {
  it("major 차이", async () => {
    const r = await exec({ action: "diff", version: "2.0.0", version2: "1.0.0" }) as Record<string, unknown>;
    expect(r.diff).toBe("major");
  });

  it("minor 차이", async () => {
    const r = await exec({ action: "diff", version: "1.2.0", version2: "1.0.0" }) as Record<string, unknown>;
    expect(r.diff).toBe("minor");
  });

  it("patch 차이", async () => {
    const r = await exec({ action: "diff", version: "1.0.3", version2: "1.0.0" }) as Record<string, unknown>;
    expect(r.diff).toBe("patch");
  });

  it("동일 버전 → diff: none", async () => {
    const r = await exec({ action: "diff", version: "1.0.0", version2: "1.0.0" }) as Record<string, unknown>;
    expect(r.diff).toBe("none");
  });
});

describe("SemverTool — valid", () => {
  it("유효한 버전 → valid: true", async () => {
    const r = await exec({ action: "valid", version: "1.2.3" }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
    expect(r.normalized).toBe("1.2.3");
  });

  it("유효하지 않은 버전 → valid: false", async () => {
    const r = await exec({ action: "valid", version: "invalid" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
    expect(r.normalized).toBeNull();
  });
});

// ══════════════════════════════════════════
// 미커버 분기 보충
// ══════════════════════════════════════════

describe("SemverTool — 미커버 분기", () => {
  it("diff: 유효하지 않은 버전 → Error (L70)", async () => {
    const r = await new (await import("@src/agent/tools/semver.js")).SemverTool().execute({ action: "diff", version: "invalid", version2: "1.0.0" });
    expect(r).toContain("Error");
  });

  it("to_string: build 메타데이터 포함 버전 (L97)", async () => {
    const r = await exec({ action: "valid", version: "1.2.3+build.001" });
    expect((r as any).valid).toBe(true);
  });

  it("satisfies: > operator (L148)", async () => {
    const r = await exec({ action: "satisfies", version: "2.0.0", range: ">1.0.0" }) as Record<string, unknown>;
    expect(r.satisfies).toBe(true);
  });

  it("satisfies: <= operator (L150)", async () => {
    const r = await exec({ action: "satisfies", version: "1.0.0", range: "<=1.0.0" }) as Record<string, unknown>;
    expect(r.satisfies).toBe(true);
  });

  it("satisfies: = operator (L151)", async () => {
    const r = await exec({ action: "satisfies", version: "1.0.0", range: "=1.0.0" }) as Record<string, unknown>;
    expect(r.satisfies).toBe(true);
  });

  it("satisfies: no operator (L154 default, compat cmp=0)", async () => {
    const r = await exec({ action: "satisfies", version: "1.2.3", range: "1.2.3" }) as Record<string, unknown>;
    expect(r.satisfies).toBe(true);
  });
});
