import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { load_eval_dataset, load_eval_datasets } from "../../src/evals/loader.js";

describe("load_eval_dataset", () => {
  let tmp: string;

  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "eval-loader-")); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("유효한 JSON에서 EvalDataset 로드", () => {
    const file = join(tmp, "basic.json");
    writeFileSync(file, JSON.stringify({
      name: "greeting",
      description: "인사말 테스트",
      cases: [
        { id: "g1", input: "hello", expected: "hi" },
        { id: "g2", input: "bye", tags: ["farewell"] },
      ],
    }));
    const ds = load_eval_dataset(file);
    expect(ds.name).toBe("greeting");
    expect(ds.description).toBe("인사말 테스트");
    expect(ds.cases).toHaveLength(2);
    expect(ds.cases[0]).toEqual({ id: "g1", input: "hello", expected: "hi", tags: undefined, metadata: undefined });
    expect(ds.cases[1].tags).toEqual(["farewell"]);
  });

  it("name 미지정 시 파일명을 fallback으로 사용", () => {
    const file = join(tmp, "my-evals.json");
    writeFileSync(file, JSON.stringify({ cases: [{ id: "c1", input: "test" }] }));
    const ds = load_eval_dataset(file);
    expect(ds.name).toBe("my-evals");
  });

  it("id 미지정 시 인덱스 기반 자동 생성", () => {
    const file = join(tmp, "auto-id.json");
    writeFileSync(file, JSON.stringify({ cases: [{ input: "test" }] }));
    const ds = load_eval_dataset(file);
    expect(ds.cases[0].id).toBe("case-0");
  });

  it("파일 미존재 시 에러", () => {
    expect(() => load_eval_dataset(join(tmp, "missing.json"))).toThrow("not found");
  });

  it("cases 배열 누락 시 에러", () => {
    const file = join(tmp, "no-cases.json");
    writeFileSync(file, JSON.stringify({ name: "bad" }));
    expect(() => load_eval_dataset(file)).toThrow("'cases' array");
  });

  it("input 누락 시 에러", () => {
    const file = join(tmp, "no-input.json");
    writeFileSync(file, JSON.stringify({ cases: [{ id: "c1" }] }));
    expect(() => load_eval_dataset(file)).toThrow("'input' string");
  });

  it("metadata 보존", () => {
    const file = join(tmp, "meta.json");
    writeFileSync(file, JSON.stringify({
      cases: [{ id: "m1", input: "test", metadata: { model: "gpt-4", temp: 0.7 } }],
    }));
    const ds = load_eval_dataset(file);
    expect(ds.cases[0].metadata).toEqual({ model: "gpt-4", temp: 0.7 });
  });
});

describe("load_eval_datasets", () => {
  let tmp: string;

  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "eval-datasets-")); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("디렉토리 내 모든 JSON 로드", () => {
    writeFileSync(join(tmp, "a.json"), JSON.stringify({ name: "a", cases: [{ input: "x" }] }));
    writeFileSync(join(tmp, "b.json"), JSON.stringify({ name: "b", cases: [{ input: "y" }] }));
    writeFileSync(join(tmp, "readme.txt"), "not a dataset");
    const datasets = load_eval_datasets(tmp);
    expect(datasets).toHaveLength(2);
    expect(datasets.map((d) => d.name).sort()).toEqual(["a", "b"]);
  });

  it("디렉토리 미존재 시 빈 배열", () => {
    expect(load_eval_datasets(join(tmp, "nonexistent"))).toEqual([]);
  });

  it("빈 디렉토리 시 빈 배열", () => {
    const sub = join(tmp, "empty");
    mkdirSync(sub);
    expect(load_eval_datasets(sub)).toEqual([]);
  });
});
