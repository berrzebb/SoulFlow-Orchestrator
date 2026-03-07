import { describe, it, expect } from "vitest";
import { SemverTool } from "@src/agent/tools/semver.js";

function make_tool(): SemverTool {
  return new SemverTool();
}

describe("SemverTool", () => {
  describe("parse", () => {
    it("기본 버전 파싱", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "parse", version: "1.2.3" }));
      expect(result.major).toBe(1);
      expect(result.minor).toBe(2);
      expect(result.patch).toBe(3);
    });

    it("v 접두사 제거", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "parse", version: "v2.0.0" }));
      expect(result.major).toBe(2);
    });

    it("prerelease 포함", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "parse", version: "1.0.0-beta.1" }));
      expect(result.prerelease).toBe("beta.1");
    });

    it("build metadata 포함", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "parse", version: "1.0.0+build.123" }));
      expect(result.build).toBe("build.123");
    });

    it("잘못된 버전 → 에러", async () => {
      const result = await make_tool().execute({ action: "parse", version: "invalid" });
      expect(result).toContain("Error");
    });
  });

  describe("compare", () => {
    it("greater", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "compare", version: "2.0.0", version2: "1.0.0" }));
      expect(result.result).toBeGreaterThan(0);
      expect(result.description).toBe("greater");
    });

    it("less", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "compare", version: "1.0.0", version2: "2.0.0" }));
      expect(result.result).toBeLessThan(0);
      expect(result.description).toBe("less");
    });

    it("equal", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "compare", version: "1.2.3", version2: "1.2.3" }));
      expect(result.result).toBe(0);
      expect(result.description).toBe("equal");
    });

    it("prerelease < release", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "compare", version: "1.0.0-alpha", version2: "1.0.0" }));
      expect(result.result).toBeLessThan(0);
    });
  });

  describe("satisfies", () => {
    it(">=1.0.0 <2.0.0 범위 충족", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "satisfies", version: "1.5.0", range: ">=1.0.0 <2.0.0" }));
      expect(result.satisfies).toBe(true);
    });

    it("범위 미충족", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "satisfies", version: "2.0.0", range: ">=1.0.0 <2.0.0" }));
      expect(result.satisfies).toBe(false);
    });

    it("^ 캐럿 범위", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "satisfies", version: "1.5.0", range: "^1.0.0" }));
      expect(result.satisfies).toBe(true);
    });

    it("~ 틸데 범위", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "satisfies", version: "1.0.9", range: "~1.0.0" }));
      expect(result.satisfies).toBe(true);
    });
  });

  describe("bump", () => {
    it("major bump", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "bump", version: "1.2.3", bump_type: "major" }));
      expect(result.bumped).toBe("2.0.0");
    });

    it("minor bump", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "bump", version: "1.2.3", bump_type: "minor" }));
      expect(result.bumped).toBe("1.3.0");
    });

    it("patch bump", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "bump", version: "1.2.3", bump_type: "patch" }));
      expect(result.bumped).toBe("1.2.4");
    });

    it("prerelease bump (숫자 증가)", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "bump", version: "1.0.0-beta.1", bump_type: "prerelease" }));
      expect(result.bumped).toBe("1.0.0-beta.2");
    });
  });

  describe("sort", () => {
    it("버전 정렬", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "sort", versions: "3.0.0, 1.0.0, 2.0.0" }));
      expect(result.sorted).toEqual(["1.0.0", "2.0.0", "3.0.0"]);
    });

    it("잘못된 버전 필터링", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "sort", versions: "1.0.0, bad, 2.0.0" }));
      expect(result.sorted).toEqual(["1.0.0", "2.0.0"]);
      expect(result.count).toBe(2);
    });
  });

  describe("diff", () => {
    it("major 차이", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "diff", version: "1.0.0", version2: "2.0.0" }));
      expect(result.diff).toBe("major");
    });

    it("minor 차이", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "diff", version: "1.0.0", version2: "1.1.0" }));
      expect(result.diff).toBe("minor");
    });

    it("동일 → none", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "diff", version: "1.2.3", version2: "1.2.3" }));
      expect(result.diff).toBe("none");
    });
  });

  describe("valid", () => {
    it("유효한 버전", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "valid", version: "1.0.0" }));
      expect(result.valid).toBe(true);
      expect(result.normalized).toBe("1.0.0");
    });

    it("유효하지 않은 버전", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "valid", version: "not.a.version" }));
      expect(result.valid).toBe(false);
      expect(result.normalized).toBeNull();
    });
  });

  it("지원하지 않는 action → 에러", async () => {
    const result = await make_tool().execute({ action: "nope" });
    expect(result).toContain("unsupported action");
  });
});
