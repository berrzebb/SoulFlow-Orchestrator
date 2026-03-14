/**
 * match_glob 속성 기반 테스트 (fast-check)
 *
 * 예시 기반 테스트: 개발자가 직접 작성한 케이스만 커버.
 * 속성 기반 테스트: fast-check가 수백~수천 개의 임의 입력을 생성하여
 * 불변 속성이 항상 성립하는지 검증. 엣지케이스 자동 탐색.
 */

import { describe, it } from "vitest";
import * as fc from "fast-check";
import { match_glob } from "@src/repo-profile/_glob.ts";

// ── 경로 임의 생성기 ──────────────────────────────────────────────────────────

const segment = fc.stringMatching(/^[a-zA-Z0-9_-]{1,12}$/);
const ext = fc.constantFrom(".ts", ".js", ".json", ".md", ".txt", "");

// 슬래시로 구분된 n단계 경로: "a/b/c.ts"
const path_arb = fc
  .tuple(
    fc.array(segment, { minLength: 0, maxLength: 4 }),
    segment,
    ext,
  )
  .map(([dirs, name, e]) => [...dirs, name + e].join("/"));

// ── 불변 속성 1: 와일드카드 없는 패턴은 정확한 경로만 매칭 ──────────────────────

describe("속성: 와일드카드 없는 패턴은 자기 자신만 매칭", () => {
  it("정확한 경로는 자기 자신과 항상 매칭된다", () => {
    fc.assert(
      fc.property(path_arb, (p) => {
        return match_glob(p, p) === true;
      }),
    );
  });

  it("와일드카드 없는 패턴은 다른 경로와 매칭되지 않는다", () => {
    fc.assert(
      fc.property(path_arb, path_arb, (p1, p2) => {
        if (p1 === p2) return true;
        return match_glob(p1, p2) === false;
      }),
    );
  });
});

// ── 불변 속성 2: ** 패턴은 모든 경로와 매칭 ──────────────────────────────────

describe("속성: ** 패턴은 모든 경로를 포함", () => {
  it("'**' 패턴은 임의의 경로에 모두 매칭된다", () => {
    fc.assert(
      fc.property(path_arb, (p) => {
        return match_glob("**", p) === true;
      }),
    );
  });

  it("'**/*.ext' 패턴은 해당 확장자를 가진 경로에 매칭된다", () => {
    fc.assert(
      fc.property(
        fc.array(segment, { minLength: 0, maxLength: 3 }),
        segment,
        (dirs, name) => {
          const p = [...dirs, name + ".ts"].join("/");
          return match_glob("**/*.ts", p) === true;
        },
      ),
    );
  });

  it("'prefix/**' 패턴은 해당 디렉토리 하위 경로에 매칭된다", () => {
    fc.assert(
      fc.property(
        segment,
        fc.array(segment, { minLength: 1, maxLength: 3 }),
        (prefix, rest) => {
          const p = [prefix, ...rest].join("/");
          return match_glob(`${prefix}/**`, p) === true;
        },
      ),
    );
  });
});

// ── 불변 속성 3: * 패턴은 슬래시를 넘지 않는다 ──────────────────────────────

describe("속성: 단일 * 패턴은 슬래시를 포함하지 않는다", () => {
  it("'dir/*' 패턴은 dir 하위 파일에만 매칭되고 중첩 경로엔 매칭 안 됨", () => {
    fc.assert(
      fc.property(
        segment,
        segment,
        segment,
        segment,
        (dir, a, b, c) => {
          const nested = `${dir}/${a}/${b}/${c}`;
          return match_glob(`${dir}/*`, nested) === false;
        },
      ),
    );
  });

  it("'dir/*' 패턴은 dir 직속 파일에는 매칭된다", () => {
    fc.assert(
      fc.property(segment, segment, (dir, file) => {
        const p = `${dir}/${file}`;
        return match_glob(`${dir}/*`, p) === true;
      }),
    );
  });
});

// ── 불변 속성 4: 정규식 특수문자 포함 경로도 안전하게 처리 ──────────────────────

describe("속성: 정규식 특수문자 포함 패턴 안전성", () => {
  it("점(.)을 포함한 경로는 리터럴로 처리된다", () => {
    fc.assert(
      fc.property(
        fc.array(segment, { minLength: 1, maxLength: 3 }),
        (parts) => {
          const p = parts.join("/") + ".ts";
          const pattern = p; // 점 포함 정확한 패턴
          return match_glob(pattern, p) === true;
        },
      ),
    );
  });

  it("점(.) 패턴은 임의 문자가 아닌 정확한 점에만 매칭된다", () => {
    // "foo.ts" 패턴이 "fooXts"에는 매칭되지 않아야 한다
    fc.assert(
      fc.property(segment, segment, (a, b) => {
        const pattern = `${a}.${b}`;
        const other = `${a}X${b}`; // X로 점 대체
        return match_glob(pattern, other) === false;
      }),
    );
  });
});

// ── 불변 속성 5: 반사성 — 모든 경로는 자기 자신의 패턴과 매칭 ───────────────────

describe("속성: 반사성 (reflexivity)", () => {
  it("어떤 경로도 자기 자신을 정확 패턴으로 쓰면 항상 매칭", () => {
    fc.assert(
      fc.property(path_arb, (p) => match_glob(p, p)),
      { numRuns: 200 },
    );
  });
});
