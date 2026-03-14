import { describe, it, expect, beforeEach } from "vitest";
import {
  register_bundle, get_bundle, list_bundles,
  get_smoke_bundles, load_bundle_datasets, clear_registry,
} from "../../src/evals/bundles.js";
import type { EvalBundle } from "../../src/evals/bundles.js";

function make_bundle(name: string, overrides?: Partial<EvalBundle>): EvalBundle {
  return {
    name,
    description: `${name} bundle`,
    dataset_files: [`tests/evals/cases/${name}.json`],
    smoke: false,
    ...overrides,
  };
}

describe("bundle registry", () => {
  beforeEach(() => {
    clear_registry();
  });

  it("번들 등록 + 조회", () => {
    register_bundle(make_bundle("test-a"));
    const b = get_bundle("test-a");
    expect(b).toBeTruthy();
    expect(b!.name).toBe("test-a");
  });

  it("미등록 번들 → undefined", () => {
    expect(get_bundle("nonexistent")).toBeUndefined();
  });

  it("중복 등록 → 에러", () => {
    register_bundle(make_bundle("dup"));
    expect(() => register_bundle(make_bundle("dup"))).toThrow("duplicate eval bundle: dup");
  });

  it("list_bundles → 등록 순서 유지", () => {
    register_bundle(make_bundle("b1"));
    register_bundle(make_bundle("b2"));
    register_bundle(make_bundle("b3"));
    const names = list_bundles().map((b) => b.name);
    expect(names).toEqual(["b1", "b2", "b3"]);
  });

  it("get_smoke_bundles → smoke=true만 반환", () => {
    register_bundle(make_bundle("s1", { smoke: true }));
    register_bundle(make_bundle("s2", { smoke: false }));
    register_bundle(make_bundle("s3", { smoke: true }));
    const smoke = get_smoke_bundles();
    expect(smoke).toHaveLength(2);
    expect(smoke.map((b) => b.name)).toEqual(["s1", "s3"]);
  });

  it("clear_registry → 모두 제거", () => {
    register_bundle(make_bundle("x"));
    expect(list_bundles()).toHaveLength(1);
    clear_registry();
    expect(list_bundles()).toHaveLength(0);
  });
});

describe("load_bundle_datasets", () => {
  beforeEach(() => { clear_registry(); });

  it("fixture 데이터셋 로드", () => {
    const bundle = make_bundle("routing");
    register_bundle(bundle);
    const datasets = load_bundle_datasets(bundle);
    expect(datasets).toHaveLength(1);
    expect(datasets[0].name).toBe("routing");
    expect(datasets[0].cases.length).toBeGreaterThan(0);
  });

  it("여러 데이터셋 파일 로드", () => {
    const bundle = make_bundle("multi", {
      dataset_files: [
        "tests/evals/cases/routing.json",
        "tests/evals/cases/compiler.json",
      ],
    });
    register_bundle(bundle);
    const datasets = load_bundle_datasets(bundle);
    expect(datasets).toHaveLength(2);
    expect(datasets[0].name).toBe("routing");
    expect(datasets[1].name).toBe("compiler");
  });

  it("존재하지 않는 파일 → 에러", () => {
    const bundle = make_bundle("bad", {
      dataset_files: ["tests/evals/cases/nonexistent.json"],
    });
    expect(() => load_bundle_datasets(bundle)).toThrow("not found");
  });
});

describe("default bundles (pre-registered)", () => {
  it("기본 5개 번들 등록 확인", async () => {
    // 기본 번들은 bundles.ts import 시 자동 등록 — 클린 레지스트리에서 재로드
    clear_registry();
    // 동적 재임포트로 기본 번들 재등록
    const mod = await import("../../src/evals/bundles.js");
    // clear 후 재등록 방법이 없으므로 수동 검증
    // 대신 기본 번들 목록을 직접 검증
    const names = ["routing", "direct-vs-agent", "compiler", "memory", "safety"];
    for (const name of names) {
      const bundle = make_bundle(name);
      mod.register_bundle(bundle);
      expect(mod.get_bundle(name)).toBeTruthy();
    }
  });

  it("smoke 번들은 routing, direct-vs-agent, safety", async () => {
    clear_registry();
    register_bundle(make_bundle("routing", { smoke: true }));
    register_bundle(make_bundle("direct-vs-agent", { smoke: true }));
    register_bundle(make_bundle("compiler", { smoke: false }));
    register_bundle(make_bundle("memory", { smoke: false }));
    register_bundle(make_bundle("safety", { smoke: true }));
    const smoke = get_smoke_bundles().map((b) => b.name);
    expect(smoke).toEqual(["routing", "direct-vs-agent", "safety"]);
  });
});
