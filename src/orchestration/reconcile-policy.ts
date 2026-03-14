/**
 * PAR-2: DeterministicReconcilePolicy + apply_reconcile_policy.
 *
 * 병렬 에이전트 결과의 충돌을 결정론적으로 해소하는 정책 함수.
 * 동일 입력에 항상 동일 출력을 보장 (정렬 기반).
 */

import type { ParallelResultEnvelope, ConflictSet, ConflictField } from "./parallel-contracts.js";

// ── Types ────────────────────────────────────────────────────────

/** 결정론적 충돌 해소 정책. */
export type DeterministicReconcilePolicy =
  | "majority_vote"  // 과반수 동일 값 채택. 동수 시 먼저 등장한 값 선택.
  | "first_wins"     // 첫 번째 성공 에이전트 결과 우선.
  | "last_wins"      // 마지막 성공 에이전트 결과 우선.
  | "merge_union";   // parsed 객체 필드 합집합. content는 배열로 합산.

// ── apply_reconcile_policy ───────────────────────────────────────

/**
 * 병렬 결과에 정책을 적용하여 최종 합의 값을 반환.
 *
 * @param envelope — 병렬 실행 결과 봉투
 * @param policy — 적용할 해소 정책
 * @param conflict_set — 선택적 충돌 감지 결과. 제공 시 consensus 필드를 우선 사용.
 */
export function apply_reconcile_policy(
  envelope: ParallelResultEnvelope,
  policy: DeterministicReconcilePolicy,
  conflict_set?: ConflictSet,
): unknown {
  const successful = envelope.results.filter((r) => !r.error);

  if (successful.length === 0) return null;

  switch (policy) {
    case "first_wins":
      return successful[0].content;

    case "last_wins":
      return successful[successful.length - 1].content;

    case "majority_vote":
      return apply_majority_vote(successful.map((r) => r.content), conflict_set);

    case "merge_union":
      return apply_merge_union(successful, conflict_set);
  }
}

// ── Internal ─────────────────────────────────────────────────────

function apply_majority_vote(
  values: Array<string | null>,
  conflict_set?: ConflictSet,
): unknown {
  // parsed 충돌이 있는 경우 — 필드별 majority vote
  if (conflict_set && conflict_set.fields.length > 0) {
    const result: Record<string, unknown> = { ...conflict_set.consensus };
    for (const field of conflict_set.fields) {
      result[field.field] = pick_majority(field);
    }
    return result;
  }

  // content 문자열 majority vote
  const freq = new Map<string, number>();
  for (const v of values) {
    if (v === null) continue;
    freq.set(v, (freq.get(v) ?? 0) + 1);
  }
  if (freq.size === 0) return null;

  let best_val = values.find((v) => v !== null) as string;
  let best_count = 0;
  for (const [v, count] of freq) {
    if (count > best_count) { best_count = count; best_val = v; }
  }
  return best_val;
}

/** ConflictField에서 가장 많이 등장한 값을 선택. 동수 시 첫 번째. */
function pick_majority(field: ConflictField): unknown {
  const freq = new Map<string, { value: unknown; count: number }>();
  for (const v of field.values) {
    const key = JSON.stringify(v);
    const existing = freq.get(key);
    if (existing) { existing.count++; }
    else { freq.set(key, { value: v, count: 1 }); }
  }

  let best: { value: unknown; count: number } | undefined;
  for (const entry of freq.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  return best?.value ?? field.values[0];
}

function apply_merge_union(
  successful: Array<{ content: string | null; parsed?: unknown }>,
  conflict_set?: ConflictSet,
): unknown {
  const with_parsed = successful.filter(
    (r) => r.parsed !== undefined && r.parsed !== null && typeof r.parsed === "object",
  );

  if (with_parsed.length > 0) {
    // consensus에서 시작하여 고유 필드를 순서대로 추가
    const merged: Record<string, unknown> = { ...(conflict_set?.consensus ?? {}) };
    for (const r of with_parsed) {
      for (const [k, v] of Object.entries(r.parsed as Record<string, unknown>)) {
        if (!(k in merged)) merged[k] = v;
      }
    }
    return merged;
  }

  // parsed 없음 → content 배열로 합산
  return successful.map((r) => r.content).filter((c) => c !== null);
}
