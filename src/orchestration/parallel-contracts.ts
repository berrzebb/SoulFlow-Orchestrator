/**
 * PAR-1: ParallelResultEnvelope + ConflictSet.
 *
 * 병렬 에이전트 실행 결과를 담는 봉투 타입과
 * 결과 간 충돌을 감지하는 순수 함수.
 */

// ── Types ────────────────────────────────────────────────────────

/** 단일 에이전트의 병렬 실행 결과. */
export type ParallelAgentResult = {
  agent_id: string;
  content: string | null;
  parsed?: unknown;
  error?: string;
};

/** 여러 병렬 에이전트 결과를 담는 봉투. */
export type ParallelResultEnvelope = {
  source_node_ids: string[];
  results: ParallelAgentResult[];
  succeeded: number;
  failed: number;
};

/** 특정 필드에서 에이전트 간 충돌이 감지된 항목. */
export type ConflictField = {
  field: string;
  values: unknown[];
  agent_ids: string[];
};

/** 충돌 감지 결과. consensus는 모든 에이전트가 동의한 필드. */
export type ConflictSet = {
  fields: ConflictField[];
  consensus: Record<string, unknown>;
};

// ── build_parallel_envelope ──────────────────────────────────────

/** 병렬 실행 결과를 봉투로 집계. error가 있으면 failed로 계수. */
export function build_parallel_envelope(
  source_node_ids: string[],
  results: ParallelAgentResult[],
): ParallelResultEnvelope {
  const succeeded = results.filter((r) => !r.error).length;
  const failed = results.filter((r) => !!r.error).length;
  return { source_node_ids, results, succeeded, failed };
}

// ── detect_conflicts ─────────────────────────────────────────────

/**
 * 병렬 결과 간 충돌 감지.
 *
 * @param results — 비교할 에이전트 결과 목록
 * @param compare_field — "parsed"를 전달하면 parsed 객체 필드별 비교.
 *   미지정 시 content 문자열 비교.
 */
export function detect_conflicts(
  results: ParallelAgentResult[],
  compare_field?: string,
): ConflictSet {
  const successful = results.filter((r) => !r.error);

  if (successful.length <= 1) {
    const consensus: Record<string, unknown> = {};
    const only = successful[0];
    if (only) {
      if (compare_field === "parsed" && only.parsed && typeof only.parsed === "object") {
        Object.assign(consensus, only.parsed as Record<string, unknown>);
      } else if (!compare_field) {
        consensus["content"] = only.content;
      }
    }
    return { fields: [], consensus };
  }

  if (compare_field === "parsed") {
    return detect_parsed_conflicts(successful);
  }
  return detect_content_conflicts(successful);
}

// ── Internal ─────────────────────────────────────────────────────

function detect_content_conflicts(successful: ParallelAgentResult[]): ConflictSet {
  const values = successful.map((r) => r.content);
  const unique = new Set(values);

  if (unique.size === 1) {
    return { fields: [], consensus: { content: values[0] } };
  }

  const conflict: ConflictField = {
    field: "content",
    values: [...unique],
    agent_ids: successful.map((r) => r.agent_id),
  };
  return { fields: [conflict], consensus: {} };
}

function detect_parsed_conflicts(successful: ParallelAgentResult[]): ConflictSet {
  // parsed가 있는 결과만 비교
  const with_parsed = successful.filter(
    (r) => r.parsed !== undefined && r.parsed !== null && typeof r.parsed === "object",
  );

  if (with_parsed.length <= 1) {
    const consensus: Record<string, unknown> = {};
    if (with_parsed[0]) Object.assign(consensus, with_parsed[0].parsed as Record<string, unknown>);
    return { fields: [], consensus };
  }

  // 모든 등장 필드 수집
  const all_keys = new Set<string>();
  for (const r of with_parsed) {
    for (const k of Object.keys(r.parsed as Record<string, unknown>)) {
      all_keys.add(k);
    }
  }

  const conflict_fields: ConflictField[] = [];
  const consensus: Record<string, unknown> = {};

  for (const key of all_keys) {
    const entries = with_parsed
      .filter((r) => key in (r.parsed as Record<string, unknown>))
      .map((r) => ({ agent_id: r.agent_id, value: (r.parsed as Record<string, unknown>)[key] }));

    const unique_values = new Set(entries.map((e) => JSON.stringify(e.value)));

    if (unique_values.size === 1) {
      consensus[key] = entries[0].value;
    } else {
      conflict_fields.push({
        field: key,
        values: entries.map((e) => e.value),
        agent_ids: entries.map((e) => e.agent_id),
      });
    }
  }

  return { fields: conflict_fields, consensus };
}
