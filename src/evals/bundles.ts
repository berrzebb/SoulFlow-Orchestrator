/**
 * EV-5: Scenario Bundle Registry.
 *
 * 반복 실행할 대표 평가 번들을 관리.
 * 각 번들은 이름 + 데이터셋 파일 목록 + smoke 여부로 구성.
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { load_eval_dataset } from "./loader.js";
import type { EvalDataset } from "./contracts.js";

export interface EvalBundle {
  /** 번들 고유 이름. */
  name: string;
  /** 번들 설명. */
  description: string;
  /** 데이터셋 파일 경로 목록 (프로젝트 루트 상대). */
  dataset_files: string[];
  /** smoke 실행 시 포함 여부. */
  smoke: boolean;
  /** 데이터셋 내 특정 태그만 필터 (미지정 시 전체). */
  tags?: string[];
}

const registry = new Map<string, EvalBundle>();

/** 번들 등록. 중복 이름 시 에러. */
export function register_bundle(bundle: EvalBundle): void {
  if (registry.has(bundle.name)) {
    throw new Error(`duplicate eval bundle: ${bundle.name}`);
  }
  registry.set(bundle.name, bundle);
}

/** 이름으로 번들 조회. */
export function get_bundle(name: string): EvalBundle | undefined {
  return registry.get(name);
}

/** 등록된 모든 번들 목록. */
export function list_bundles(): EvalBundle[] {
  return [...registry.values()];
}

/** smoke 번들만 조회. */
export function get_smoke_bundles(): EvalBundle[] {
  return list_bundles().filter((b) => b.smoke);
}

/** 번들의 데이터셋을 로드. */
export function load_bundle_datasets(bundle: EvalBundle, project_root?: string): EvalDataset[] {
  const root = project_root ?? resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  return bundle.dataset_files.map((f) => load_eval_dataset(resolve(root, f)));
}

/** 레지스트리 초기화 (테스트용). */
export function clear_registry(): void {
  registry.clear();
}

/* ── 기본 번들 등록 ────────────────────────── */

register_bundle({
  name: "routing",
  description: "메시지 라우팅 분류 평가",
  dataset_files: ["tests/evals/cases/routing.json"],
  smoke: true,
  tags: ["smoke"],
});

register_bundle({
  name: "direct-vs-agent",
  description: "direct/agent 모드 선택 평가",
  dataset_files: ["tests/evals/cases/direct-vs-agent.json"],
  smoke: true,
  tags: ["smoke"],
});

register_bundle({
  name: "compiler",
  description: "워크플로우 컴파일러 평가",
  dataset_files: ["tests/evals/cases/compiler.json"],
  smoke: false,
});

register_bundle({
  name: "memory",
  description: "메모리/검색 평가",
  dataset_files: ["tests/evals/cases/memory.json"],
  smoke: false,
});

register_bundle({
  name: "safety",
  description: "안전/정책 평가",
  dataset_files: ["tests/evals/cases/safety.json"],
  smoke: true,
  tags: ["smoke"],
});

register_bundle({
  name: "guardrails",
  description: "실행 가드레일 결정 회귀 평가",
  dataset_files: ["tests/evals/cases/guardrails.json"],
  smoke: true,
  tags: ["smoke"],
});

register_bundle({
  name: "tokenizer",
  description: "토크나이저/하이브리드 검색 회귀 평가",
  dataset_files: ["tests/evals/cases/tokenizer.json"],
  smoke: true,
  tags: ["smoke"],
});

register_bundle({
  name: "gateway",
  description: "GW-2: gateway 분류 + 비용 라우팅 + ingress 정규화 회귀 평가",
  dataset_files: ["tests/evals/cases/gateway.json"],
  smoke: true,
  tags: ["smoke"],
});

register_bundle({
  name: "parallel-conflict",
  description: "PAR-1~PAR-6: reconcile 파이프라인 + critic gate + read model 회귀 평가",
  dataset_files: ["tests/evals/cases/parallel-conflict.json"],
  smoke: true,
  tags: ["smoke"],
});

register_bundle({
  name: "output-reduction",
  description: "E4+E5: MemoryIngestionReducer + ToolOutputReducer kind 감지 + 압축률 회귀 평가",
  dataset_files: ["tests/evals/cases/output-reduction.json"],
  smoke: true,
  tags: ["smoke"],
});
