/**
 * SemverTool — 미커버 분기 보충.
 * compare_versions prerelease 분기, bump_version prerelease 비숫자/default,
 * diff prerelease 차이, check_range ~ ^ 연산자, check_comparator default 분기.
 */
import { describe, it, expect } from "vitest";
import { SemverTool } from "@src/agent/tools/semver.js";

const tool = new SemverTool();

async function run(params: Record<string, unknown>): Promise<unknown> {
  return JSON.parse(await (tool as any).run(params));
}

// ══════════════════════════════════════════
// compare — prerelease 분기
// ══════════════════════════════════════════

describe("SemverTool — compare: prerelease 분기", () => {
  it("prerelease 없는 버전 > prerelease 있는 버전 (동일 base)", async () => {
    // 1.0.0 vs 1.0.0-alpha → 1.0.0 > 1.0.0-alpha (stable > prerelease)
    const r = await run({ action: "compare", version: "1.0.0", version2: "1.0.0-alpha" });
    expect((r as any).result).toBeGreaterThan(0);
    expect((r as any).description).toBe("greater");
  });

  it("prerelease 있는 버전 < prerelease 없는 버전 (동일 base)", async () => {
    // 1.0.0-alpha vs 1.0.0 → 1.0.0-alpha < 1.0.0
    const r = await run({ action: "compare", version: "1.0.0-alpha", version2: "1.0.0" });
    expect((r as any).result).toBeLessThan(0);
    expect((r as any).description).toBe("less");
  });

  it("둘 다 prerelease → localeCompare 비교", async () => {
    // 1.0.0-beta vs 1.0.0-alpha → beta > alpha
    const r = await run({ action: "compare", version: "1.0.0-beta", version2: "1.0.0-alpha" });
    expect((r as any).result).toBeGreaterThan(0);
  });

  it("둘 다 prerelease 동일 → equal", async () => {
    const r = await run({ action: "compare", version: "2.0.0-rc.1", version2: "2.0.0-rc.1" });
    expect((r as any).result).toBe(0);
    expect((r as any).description).toBe("equal");
  });
});

// ══════════════════════════════════════════
// bump — prerelease 비숫자 마지막 파트
// ══════════════════════════════════════════

describe("SemverTool — bump: prerelease 비숫자 → .1 추가", () => {
  it("prerelease='alpha' → 'alpha.1'", async () => {
    // v.prerelease.split('.') last = 'alpha' → isNaN → push '1'
    const r = await run({ action: "bump", version: "1.0.0-alpha", bump_type: "prerelease" });
    expect((r as any).bumped).toBe("1.0.0-alpha.1");
  });

  it("prerelease='rc' → 'rc.1'", async () => {
    const r = await run({ action: "bump", version: "3.1.0-rc", bump_type: "prerelease" });
    expect((r as any).bumped).toBe("3.1.0-rc.1");
  });

  it("prerelease='1' (숫자) → '2'", async () => {
    // 이미 커버된 분기이나 비숫자 분기와 대비 확인
    const r = await run({ action: "bump", version: "1.0.0-1", bump_type: "prerelease" });
    expect((r as any).bumped).toBe("1.0.0-2");
  });

  it("prerelease='beta.2' (숫자) → 'beta.3'", async () => {
    const r = await run({ action: "bump", version: "1.2.3-beta.2", bump_type: "prerelease" });
    expect((r as any).bumped).toBe("1.2.3-beta.3");
  });
});

// ══════════════════════════════════════════
// bump — default 분기 (알 수 없는 type)
// ══════════════════════════════════════════

describe("SemverTool — bump: default 분기 (알 수 없는 bump_type)", () => {
  it("알 수 없는 bump_type → patch 증가 (default)", async () => {
    const r = await run({ action: "bump", version: "2.3.4", bump_type: "unknown_type" });
    // default: {...v, patch: v.patch + 1, prerelease: "", build: ""}
    expect((r as any).bumped).toBe("2.3.5");
  });
});

// ══════════════════════════════════════════
// diff — prerelease 차이
// ══════════════════════════════════════════

describe("SemverTool — diff: prerelease 차이", () => {
  it("major/minor/patch 동일, prerelease 다름 → diff='prerelease'", async () => {
    const r = await run({ action: "diff", version: "1.0.0-alpha", version2: "1.0.0-beta" });
    expect((r as any).diff).toBe("prerelease");
  });

  it("major 다름 → diff='major'", async () => {
    const r = await run({ action: "diff", version: "2.0.0", version2: "1.0.0" });
    expect((r as any).diff).toBe("major");
  });

  it("patch만 다름 → diff='patch'", async () => {
    const r = await run({ action: "diff", version: "1.0.1", version2: "1.0.0" });
    expect((r as any).diff).toBe("patch");
  });

  it("동일 버전 → diff='none'", async () => {
    const r = await run({ action: "diff", version: "1.2.3", version2: "1.2.3" });
    expect((r as any).diff).toBe("none");
  });
});

// ══════════════════════════════════════════
// satisfies — ~ (tilde) 연산자
// ══════════════════════════════════════════

describe("SemverTool — satisfies: ~ 연산자", () => {
  it("~1.2.3 → 1.2.x 일치", async () => {
    const r = await run({ action: "satisfies", version: "1.2.5", range: "~1.2.3" });
    expect((r as any).satisfies).toBe(true);
  });

  it("~1.2.3 → 1.3.0 불일치", async () => {
    const r = await run({ action: "satisfies", version: "1.3.0", range: "~1.2.3" });
    expect((r as any).satisfies).toBe(false);
  });

  it("~1.2.3 → 1.2.2 불일치 (patch 낮음)", async () => {
    const r = await run({ action: "satisfies", version: "1.2.2", range: "~1.2.3" });
    expect((r as any).satisfies).toBe(false);
  });
});

// ══════════════════════════════════════════
// satisfies — ^ (caret) 연산자
// ══════════════════════════════════════════

describe("SemverTool — satisfies: ^ 연산자", () => {
  it("^1.2.3 → 1.3.0 일치", async () => {
    const r = await run({ action: "satisfies", version: "1.3.0", range: "^1.2.3" });
    expect((r as any).satisfies).toBe(true);
  });

  it("^1.2.3 → 2.0.0 불일치 (major 다름)", async () => {
    const r = await run({ action: "satisfies", version: "2.0.0", range: "^1.2.3" });
    expect((r as any).satisfies).toBe(false);
  });

  it("^1.2.3 → 1.2.2 불일치 (동일 minor, patch 낮음)", async () => {
    const r = await run({ action: "satisfies", version: "1.2.2", range: "^1.2.3" });
    expect((r as any).satisfies).toBe(false);
  });

  it("^1.2.3 → 1.2.3 일치 (경계값)", async () => {
    const r = await run({ action: "satisfies", version: "1.2.3", range: "^1.2.3" });
    expect((r as any).satisfies).toBe(true);
  });
});

// ══════════════════════════════════════════
// satisfies — 복합 범위 (AND)
// ══════════════════════════════════════════

describe("SemverTool — satisfies: 복합 범위 AND", () => {
  it(">=1.0.0 <2.0.0 → 1.5.0 일치", async () => {
    const r = await run({ action: "satisfies", version: "1.5.0", range: ">=1.0.0 <2.0.0" });
    expect((r as any).satisfies).toBe(true);
  });

  it(">=1.0.0 <2.0.0 → 2.0.0 불일치", async () => {
    const r = await run({ action: "satisfies", version: "2.0.0", range: ">=1.0.0 <2.0.0" });
    expect((r as any).satisfies).toBe(false);
  });
});

// ══════════════════════════════════════════
// sort — prerelease 포함 정렬
// ══════════════════════════════════════════

describe("SemverTool — sort: prerelease 포함 정렬", () => {
  it("1.0.0 > 1.0.0-beta (stable > prerelease)", async () => {
    const r = await run({ action: "sort", versions: "1.0.0,1.0.0-beta" });
    // 오름차순: prerelease 먼저
    expect((r as any).sorted[0]).toBe("1.0.0-beta");
    expect((r as any).sorted[1]).toBe("1.0.0");
  });
});
