/**
 * PAR-1: ParallelResultEnvelope + ConflictSet 계약 검증.
 */

import { describe, it, expect } from "vitest";
import {
  build_parallel_envelope,
  detect_conflicts,
  type ParallelAgentResult,
} from "../../src/orchestration/parallel-contracts.js";

// ── build_parallel_envelope ──────────────────────────────────────

describe("build_parallel_envelope", () => {
  it("성공/실패 집계 — succeeded/failed 계수 정확", () => {
    const results: ParallelAgentResult[] = [
      { agent_id: "a1", content: "ok" },
      { agent_id: "a2", content: null, error: "timeout" },
      { agent_id: "a3", content: "ok2" },
    ];
    const env = build_parallel_envelope(["n1", "n2", "n3"], results);
    expect(env.succeeded).toBe(2);
    expect(env.failed).toBe(1);
    expect(env.source_node_ids).toEqual(["n1", "n2", "n3"]);
    expect(env.results).toHaveLength(3);
  });

  it("모두 성공 → failed=0", () => {
    const results: ParallelAgentResult[] = [
      { agent_id: "a1", content: "x" },
      { agent_id: "a2", content: "y" },
    ];
    const env = build_parallel_envelope(["n1", "n2"], results);
    expect(env.failed).toBe(0);
    expect(env.succeeded).toBe(2);
  });

  it("빈 결과 → succeeded=0, failed=0", () => {
    const env = build_parallel_envelope([], []);
    expect(env.succeeded).toBe(0);
    expect(env.failed).toBe(0);
    expect(env.results).toHaveLength(0);
  });
});

// ── detect_conflicts — content 비교 ─────────────────────────────

describe("detect_conflicts — content 기반", () => {
  it("모든 에이전트가 동일 content → conflicts 없음, consensus에 포함", () => {
    const results: ParallelAgentResult[] = [
      { agent_id: "a1", content: "answer" },
      { agent_id: "a2", content: "answer" },
      { agent_id: "a3", content: "answer" },
    ];
    const conflicts = detect_conflicts(results);
    expect(conflicts.fields).toHaveLength(0);
    expect(conflicts.consensus["content"]).toBe("answer");
  });

  it("content가 다를 경우 → content 필드에 conflict 감지", () => {
    const results: ParallelAgentResult[] = [
      { agent_id: "a1", content: "answer A" },
      { agent_id: "a2", content: "answer B" },
    ];
    const conflicts = detect_conflicts(results);
    const content_conflict = conflicts.fields.find((f) => f.field === "content");
    expect(content_conflict).toBeDefined();
    expect(content_conflict!.values).toContain("answer A");
    expect(content_conflict!.values).toContain("answer B");
    expect(content_conflict!.agent_ids).toContain("a1");
    expect(content_conflict!.agent_ids).toContain("a2");
  });

  it("에러가 있는 결과는 conflict 비교에서 제외", () => {
    const results: ParallelAgentResult[] = [
      { agent_id: "a1", content: "answer" },
      { agent_id: "a2", content: null, error: "failed" },
      { agent_id: "a3", content: "answer" },
    ];
    const conflicts = detect_conflicts(results);
    // 성공한 두 결과가 동일 → 충돌 없음
    expect(conflicts.fields).toHaveLength(0);
  });

  it("단일 성공 결과 → conflict 없음", () => {
    const results: ParallelAgentResult[] = [
      { agent_id: "a1", content: "solo" },
      { agent_id: "a2", content: null, error: "err" },
    ];
    const conflicts = detect_conflicts(results);
    expect(conflicts.fields).toHaveLength(0);
    expect(conflicts.consensus["content"]).toBe("solo");
  });
});

// ── detect_conflicts — parsed 필드 비교 ─────────────────────────

describe("detect_conflicts — parsed 객체 필드 비교", () => {
  it("parsed 필드가 동일 → 충돌 없음", () => {
    const results: ParallelAgentResult[] = [
      { agent_id: "a1", content: "x", parsed: { score: 0.9, label: "positive" } },
      { agent_id: "a2", content: "y", parsed: { score: 0.9, label: "positive" } },
    ];
    const conflicts = detect_conflicts(results, "parsed");
    expect(conflicts.fields).toHaveLength(0);
  });

  it("parsed.label만 다를 경우 → label 필드에 conflict", () => {
    const results: ParallelAgentResult[] = [
      { agent_id: "a1", content: "x", parsed: { score: 0.9, label: "positive" } },
      { agent_id: "a2", content: "y", parsed: { score: 0.9, label: "negative" } },
    ];
    const conflicts = detect_conflicts(results, "parsed");
    const label_conflict = conflicts.fields.find((f) => f.field === "label");
    expect(label_conflict).toBeDefined();
    expect(label_conflict!.values).toContain("positive");
    expect(label_conflict!.values).toContain("negative");
    // score는 합의 필드에 포함
    expect(conflicts.consensus["score"]).toBe(0.9);
  });

  it("parsed가 없는 결과는 비교에서 제외", () => {
    const results: ParallelAgentResult[] = [
      { agent_id: "a1", content: "x", parsed: { label: "ok" } },
      { agent_id: "a2", content: "y" }, // parsed 없음
    ];
    const conflicts = detect_conflicts(results, "parsed");
    // a2는 parsed가 없으므로 제외 → 충돌 없음
    expect(conflicts.fields).toHaveLength(0);
  });
});
