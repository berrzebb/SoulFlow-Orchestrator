import { describe, it, expect } from "vitest";
import {
  create_artifact_bundle,
  serialize_bundle,
  deserialize_bundle,
  is_bundle_passing,
} from "@src/repo-profile/artifact-bundle.ts";
import type { ValidatorRunResult, ResidualRisk } from "@src/repo-profile/artifact-bundle.ts";

// ── create_artifact_bundle ────────────────────────────────────────────────────

describe("create_artifact_bundle", () => {
  it("최소 입력으로 생성 — 빈 배열 기본값", () => {
    const bundle = create_artifact_bundle({ repo_id: "test-repo" });
    expect(bundle.repo_id).toBe("test-repo");
    expect(bundle.changed_files).toHaveLength(0);
    expect(bundle.validator_results).toHaveLength(0);
    expect(bundle.residual_risks).toHaveLength(0);
    expect(bundle.eval_summary).toBeUndefined();
    expect(bundle.patch).toBeUndefined();
  });

  it("created_at 미제공 시 ISO 8601 형식으로 자동 설정", () => {
    const bundle = create_artifact_bundle({ repo_id: "r" });
    expect(() => new Date(bundle.created_at)).not.toThrow();
    expect(new Date(bundle.created_at).toISOString()).toBe(bundle.created_at);
  });

  it("created_at 주입 시 해당 값 사용", () => {
    const fixed = "2026-01-01T00:00:00.000Z";
    const bundle = create_artifact_bundle({ repo_id: "r", created_at: fixed });
    expect(bundle.created_at).toBe(fixed);
  });

  it("changed_files가 bundle에 포함됨", () => {
    const bundle = create_artifact_bundle({
      repo_id: "r",
      changed_files: ["src/foo.ts", "src/bar.ts"],
    });
    expect(bundle.changed_files).toEqual(["src/foo.ts", "src/bar.ts"]);
  });

  it("validator_results가 bundle에 포함됨", () => {
    const results: ValidatorRunResult[] = [
      { kind: "lint", command: "npx eslint src/", passed: true },
      { kind: "test", command: "npx vitest run", passed: false, output: "2 failed" },
    ];
    const bundle = create_artifact_bundle({ repo_id: "r", validator_results: results });
    expect(bundle.validator_results).toHaveLength(2);
    expect(bundle.validator_results[1].passed).toBe(false);
  });

  it("eval_summary가 bundle에 포함됨", () => {
    const bundle = create_artifact_bundle({
      repo_id: "r",
      eval_summary: { total_cases: 10, passed_cases: 8, score: 0.8 },
    });
    expect(bundle.eval_summary?.score).toBe(0.8);
  });

  it("patch metadata가 bundle에 포함됨", () => {
    const bundle = create_artifact_bundle({
      repo_id: "r",
      patch: { added_lines: 50, removed_lines: 10, files_changed: 3 },
    });
    expect(bundle.patch?.files_changed).toBe(3);
  });

  it("residual_risks가 bundle에 포함됨", () => {
    const risks: ResidualRisk[] = [
      { severity: "low", description: "minor edge case" },
      { severity: "high", description: "external dependency" },
    ];
    const bundle = create_artifact_bundle({ repo_id: "r", residual_risks: risks });
    expect(bundle.residual_risks).toHaveLength(2);
    expect(bundle.residual_risks[1].severity).toBe("high");
  });
});

// ── serialize_bundle / deserialize_bundle ─────────────────────────────────────

describe("serialize_bundle / deserialize_bundle", () => {
  it("직렬화 후 역직렬화하면 동일한 bundle 복원", () => {
    const original = create_artifact_bundle({
      repo_id: "test-repo",
      changed_files: ["src/a.ts"],
      validator_results: [{ kind: "lint", command: "eslint src/", passed: true }],
      eval_summary: { total_cases: 5, passed_cases: 5, score: 1 },
      residual_risks: [{ severity: "low", description: "minor" }],
      patch: { added_lines: 10, removed_lines: 2, files_changed: 1 },
    });

    const serialized = serialize_bundle(original);
    expect(typeof serialized).toBe("string");

    const restored = deserialize_bundle(serialized);
    expect(restored.repo_id).toBe(original.repo_id);
    expect(restored.changed_files).toEqual(original.changed_files);
    expect(restored.validator_results[0].passed).toBe(true);
    expect(restored.eval_summary?.score).toBe(1);
    expect(restored.residual_risks[0].severity).toBe("low");
    expect(restored.patch?.files_changed).toBe(1);
  });

  it("객체 직접 전달도 역직렬화 가능", () => {
    const obj = { repo_id: "r", created_at: new Date().toISOString() };
    const bundle = deserialize_bundle(obj);
    expect(bundle.repo_id).toBe("r");
    expect(bundle.changed_files).toHaveLength(0);
  });

  it("repo_id 없으면 throw", () => {
    expect(() => deserialize_bundle({ created_at: "2026-01-01T00:00:00.000Z" }))
      .toThrow(TypeError);
  });

  it("created_at 없으면 throw", () => {
    expect(() => deserialize_bundle({ repo_id: "r" }))
      .toThrow(TypeError);
  });

  it("null 입력은 throw", () => {
    expect(() => deserialize_bundle(null)).toThrow(TypeError);
  });

  it("잘못된 JSON 문자열은 throw", () => {
    expect(() => deserialize_bundle("{invalid_json")).toThrow();
  });

  it("validator_results에서 필수 필드 없는 항목은 필터링", () => {
    const raw = {
      repo_id: "r",
      created_at: new Date().toISOString(),
      validator_results: [
        { kind: "lint", command: "eslint", passed: true },
        { kind: "test" }, // command, passed 없음 — 필터링
      ],
    };
    const bundle = deserialize_bundle(raw);
    expect(bundle.validator_results).toHaveLength(1);
  });

  it("residual_risks에서 잘못된 severity는 필터링", () => {
    const raw = {
      repo_id: "r",
      created_at: new Date().toISOString(),
      residual_risks: [
        { severity: "low", description: "ok" },
        { severity: "critical", description: "bad" }, // 잘못된 severity
      ],
    };
    const bundle = deserialize_bundle(raw);
    expect(bundle.residual_risks).toHaveLength(1);
  });
});

// ── is_bundle_passing ─────────────────────────────────────────────────────────

describe("is_bundle_passing", () => {
  it("validator_results 없으면 true (검증 불필요)", () => {
    const bundle = create_artifact_bundle({ repo_id: "r" });
    expect(is_bundle_passing(bundle)).toBe(true);
  });

  it("모든 validator가 passed이면 true", () => {
    const bundle = create_artifact_bundle({
      repo_id: "r",
      validator_results: [
        { kind: "lint", command: "eslint src/", passed: true },
        { kind: "test", command: "vitest run", passed: true },
      ],
    });
    expect(is_bundle_passing(bundle)).toBe(true);
  });

  it("하나라도 failed이면 false", () => {
    const bundle = create_artifact_bundle({
      repo_id: "r",
      validator_results: [
        { kind: "lint", command: "eslint src/", passed: true },
        { kind: "test", command: "vitest run", passed: false },
      ],
    });
    expect(is_bundle_passing(bundle)).toBe(false);
  });
});

// ── RPF-6: risk_tier ──────────────────────────────────────────────────────────

describe("ArtifactBundle risk_tier (RPF-6)", () => {
  it("risk_tier 주입 시 bundle에 포함됨", () => {
    const bundle = create_artifact_bundle({ repo_id: "r", risk_tier: "high" });
    expect(bundle.risk_tier).toBe("high");
  });

  it("risk_tier 미제공 시 undefined", () => {
    const bundle = create_artifact_bundle({ repo_id: "r" });
    expect(bundle.risk_tier).toBeUndefined();
  });

  it("직렬화/역직렬화 후 risk_tier 복원됨", () => {
    const original = create_artifact_bundle({ repo_id: "r", risk_tier: "critical" });
    const restored = deserialize_bundle(serialize_bundle(original));
    expect(restored.risk_tier).toBe("critical");
  });

  it("잘못된 risk_tier 값은 역직렬화 시 undefined로 처리됨", () => {
    const raw = { repo_id: "r", created_at: new Date().toISOString(), risk_tier: "extreme" };
    const bundle = deserialize_bundle(raw);
    expect(bundle.risk_tier).toBeUndefined();
  });
});
