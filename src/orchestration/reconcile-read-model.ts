/**
 * PAR-6: Reconcile 로컬 Read Model.
 *
 * 워크플로우 memory에서 reconcile/critic_gate 노드 출력을 스캔하여
 * 대시보드/운영자가 즉시 확인할 수 있는 요약을 생성.
 */

// ── Types ────────────────────────────────────────────────────────

/** reconcile 노드 출력 요약. */
export interface ReconcileSummary {
  node_id: string;
  policy: string;
  succeeded: number;
  failed: number;
  /** 충돌 감지된 필드 수. */
  conflict_count: number;
}

/** critic_gate 노드 출력 요약. */
export interface CriticSummary {
  node_id: string;
  verdict: string;
  passed: boolean;
  rounds_used: number;
  reason?: string;
}

/** 워크플로우 실행 단위의 reconcile 통합 read model. */
export interface ReconcileReadModel {
  reconcile_summaries: ReconcileSummary[];
  critic_summaries: CriticSummary[];
  /** 실패(failed > 0) reconcile 노드가 하나라도 있으면 true. */
  has_failures: boolean;
  /** 전체 감지된 충돌 필드 수 합산. */
  total_conflicts: number;
  /** critic verdict === "fail" 인 노드 수. */
  unresolved_count: number;
}

// ── extract_reconcile_read_model ──────────────────────────────────

/**
 * 워크플로우 memory에서 ReconcileReadModel을 추출.
 *
 * - `policy_applied` 키 → reconcile 노드 출력으로 판별
 * - `verdict` + `rounds_used` 키 → critic_gate 노드 출력으로 판별
 * - 내부 추적용 `__rounds_used` 키는 건너뜀
 */
export function extract_reconcile_read_model(
  memory: Record<string, unknown>,
): ReconcileReadModel {
  const reconcile_summaries: ReconcileSummary[] = [];
  const critic_summaries: CriticSummary[] = [];

  for (const [node_id, value] of Object.entries(memory)) {
    // critic_gate 내부 budget 추적 키 건너뜀
    if (node_id.endsWith("__rounds_used")) continue;
    if (typeof value !== "object" || value === null) continue;

    const obj = value as Record<string, unknown>;

    if ("policy_applied" in obj) {
      const conflicts = obj["conflicts"] as { fields?: unknown[] } | null | undefined;
      reconcile_summaries.push({
        node_id,
        policy: String(obj["policy_applied"] ?? ""),
        succeeded: Number(obj["succeeded"] ?? 0),
        failed: Number(obj["failed"] ?? 0),
        conflict_count: Array.isArray(conflicts?.fields) ? conflicts.fields.length : 0,
      });
    } else if ("verdict" in obj && "rounds_used" in obj && "passed" in obj) {
      critic_summaries.push({
        node_id,
        verdict: String(obj["verdict"] ?? ""),
        passed: Boolean(obj["passed"]),
        rounds_used: Number(obj["rounds_used"] ?? 0),
        reason: typeof obj["reason"] === "string" ? obj["reason"] : undefined,
      });
    }
  }

  const has_failures = reconcile_summaries.some((s) => s.failed > 0);
  const total_conflicts = reconcile_summaries.reduce((sum, s) => sum + s.conflict_count, 0);
  const unresolved_count = critic_summaries.filter((c) => c.verdict === "fail").length;

  return { reconcile_summaries, critic_summaries, has_failures, total_conflicts, unresolved_count };
}
