/**
 * E5: OutputReductionKpi 테스트.
 *
 * - 빈 상태 summary → count=0, ratio=1.0
 * - record() → count/chars 누적 정확성
 * - overflow_count: truncated=true 시 증가
 * - kind_counts: kind별 분포 추적
 * - overall_ratio = total_reduced / total_raw
 * - summary().kind_counts 방어 복사 — 외부 수정이 내부 상태를 오염시키지 않음
 * - reset(): 모든 상태 초기화, 이후 재기록 정상 동작
 * - stat_from_reduced(): ReducedOutput → ReductionStat 정확 변환
 */

import { describe, it, expect } from "vitest";
import {
  create_output_reduction_kpi,
  stat_from_reduced,
} from "@src/orchestration/output-reduction-kpi.js";
import { create_tool_output_reducer } from "@src/orchestration/tool-output-reducer.js";

// ── 기본 누적 ──────────────────────────────────────────────────────

describe("OutputReductionKpi — 초기 상태", () => {
  it("빈 상태 summary → count=0, ratio=1.0, 모든 kind=0", () => {
    const kpi = create_output_reduction_kpi();
    const s = kpi.summary();
    expect(s.count).toBe(0);
    expect(s.total_raw_chars).toBe(0);
    expect(s.total_reduced_chars).toBe(0);
    expect(s.overall_ratio).toBe(1.0);
    expect(s.overflow_count).toBe(0);
    expect(Object.values(s.kind_counts).every((v) => v === 0)).toBe(true);
  });
});

describe("OutputReductionKpi — 단일 record", () => {
  it("count=1, chars 정확 반영", () => {
    const kpi = create_output_reduction_kpi();
    kpi.record({ raw_chars: 200, reduced_chars: 100, kind: "plain", truncated: false });
    const s = kpi.summary();
    expect(s.count).toBe(1);
    expect(s.total_raw_chars).toBe(200);
    expect(s.total_reduced_chars).toBe(100);
    expect(s.overall_ratio).toBeCloseTo(0.5);
    expect(s.overflow_count).toBe(0);
  });

  it("truncated=true → overflow_count=1", () => {
    const kpi = create_output_reduction_kpi();
    kpi.record({ raw_chars: 100, reduced_chars: 50, kind: "shell", truncated: true });
    expect(kpi.summary().overflow_count).toBe(1);
  });

  it("truncated=false → overflow_count=0", () => {
    const kpi = create_output_reduction_kpi();
    kpi.record({ raw_chars: 50, reduced_chars: 50, kind: "plain", truncated: false });
    expect(kpi.summary().overflow_count).toBe(0);
  });
});

describe("OutputReductionKpi — 복수 record 누적합", () => {
  it("3개 record → 합계 정확", () => {
    const kpi = create_output_reduction_kpi();
    kpi.record({ raw_chars: 100, reduced_chars: 80,  kind: "plain", truncated: false });
    kpi.record({ raw_chars: 200, reduced_chars: 120, kind: "log",   truncated: true  });
    kpi.record({ raw_chars: 300, reduced_chars: 150, kind: "json",  truncated: true  });
    const s = kpi.summary();
    expect(s.count).toBe(3);
    expect(s.total_raw_chars).toBe(600);
    expect(s.total_reduced_chars).toBe(350);
    expect(s.overflow_count).toBe(2);
    expect(s.overall_ratio).toBeCloseTo(350 / 600);
  });

  it("overall_ratio = 절감 없음 → 1.0", () => {
    const kpi = create_output_reduction_kpi();
    kpi.record({ raw_chars: 100, reduced_chars: 100, kind: "plain", truncated: false });
    kpi.record({ raw_chars: 200, reduced_chars: 200, kind: "plain", truncated: false });
    expect(kpi.summary().overall_ratio).toBeCloseTo(1.0);
  });
});

// ── kind_counts ────────────────────────────────────────────────────

describe("OutputReductionKpi — kind_counts 분포", () => {
  it("kind별 분포 정확 추적", () => {
    const kpi = create_output_reduction_kpi();
    kpi.record({ raw_chars: 10, reduced_chars: 10, kind: "plain", truncated: false });
    kpi.record({ raw_chars: 10, reduced_chars: 10, kind: "plain", truncated: false });
    kpi.record({ raw_chars: 10, reduced_chars: 8,  kind: "shell", truncated: false });
    kpi.record({ raw_chars: 10, reduced_chars: 8,  kind: "json",  truncated: false });
    kpi.record({ raw_chars: 10, reduced_chars: 7,  kind: "diff",  truncated: true  });
    const counts = kpi.summary().kind_counts;
    expect(counts.plain).toBe(2);
    expect(counts.shell).toBe(1);
    expect(counts.json).toBe(1);
    expect(counts.diff).toBe(1);
    expect(counts.log).toBe(0);
    expect(counts.test).toBe(0);
    expect(counts.table).toBe(0);
  });

  it("summary().kind_counts는 방어 복사 — 외부 수정이 내부 상태를 오염시키지 않음", () => {
    const kpi = create_output_reduction_kpi();
    kpi.record({ raw_chars: 10, reduced_chars: 10, kind: "plain", truncated: false });
    const counts = kpi.summary().kind_counts;
    counts.plain = 999; // 복사본 변조
    expect(kpi.summary().kind_counts.plain).toBe(1); // 원본 불변
  });
});

// ── reset() ────────────────────────────────────────────────────────

describe("OutputReductionKpi — reset()", () => {
  it("reset 후 모든 상태 초기화", () => {
    const kpi = create_output_reduction_kpi();
    kpi.record({ raw_chars: 500, reduced_chars: 200, kind: "log", truncated: true });
    kpi.reset();
    const s = kpi.summary();
    expect(s.count).toBe(0);
    expect(s.total_raw_chars).toBe(0);
    expect(s.total_reduced_chars).toBe(0);
    expect(s.overflow_count).toBe(0);
    expect(s.overall_ratio).toBe(1.0);
    expect(Object.values(s.kind_counts).every((v) => v === 0)).toBe(true);
  });

  it("reset 후 재기록 → 정상 누적", () => {
    const kpi = create_output_reduction_kpi();
    kpi.record({ raw_chars: 100, reduced_chars: 50, kind: "shell", truncated: true });
    kpi.reset();
    kpi.record({ raw_chars: 200, reduced_chars: 200, kind: "plain", truncated: false });
    const s = kpi.summary();
    expect(s.count).toBe(1);
    expect(s.total_raw_chars).toBe(200);
    expect(s.overflow_count).toBe(0);
    expect(s.kind_counts.plain).toBe(1);
    expect(s.kind_counts.shell).toBe(0);
  });
});

// ── stat_from_reduced() ────────────────────────────────────────────

describe("stat_from_reduced()", () => {
  const reducer = create_tool_output_reducer(200);

  it("ReducedOutput → ReductionStat 변환 — raw_chars, kind, truncated, reduced_chars", () => {
    const text = "x".repeat(300);
    const reduced = reducer.reduce({ tool_name: "t", params: {}, result_text: text, is_error: false });
    const stat = stat_from_reduced(reduced);
    expect(stat.raw_chars).toBe(300);
    expect(stat.kind).toBe(reduced.kind);
    expect(stat.truncated).toBe(reduced.meta.truncated);
    // prompt_text.length를 reduced_chars로 사용
    expect(stat.reduced_chars).toBe(reduced.prompt_text.length);
  });

  it("짧은 텍스트 → truncated=false, reduced_chars=raw_chars", () => {
    const text = "hello world";
    const reduced = reducer.reduce({ tool_name: "t", params: {}, result_text: text, is_error: false });
    const stat = stat_from_reduced(reduced);
    expect(stat.truncated).toBe(false);
    expect(stat.raw_chars).toBe(text.length);
    expect(stat.reduced_chars).toBe(text.length);
  });

  it("stat_from_reduced() 결과로 kpi.record() 호출 가능 — 타입 호환", () => {
    const kpi = create_output_reduction_kpi();
    const text = "log output\n".repeat(30);
    const reduced = reducer.reduce({ tool_name: "t", params: {}, result_text: text, is_error: false });
    expect(() => kpi.record(stat_from_reduced(reduced))).not.toThrow();
    expect(kpi.summary().count).toBe(1);
  });
});
