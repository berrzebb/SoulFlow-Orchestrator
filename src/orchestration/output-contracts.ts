/**
 * SO-1 + SO-2: Output Contract Inventory + Shared Result Contracts.
 *
 * 오케스트레이션 파이프라인의 모든 결과 계약을 단일 진입점에서 관리.
 * 새 결과 타입 추가 시 OutputContractMap에 등록하여 인벤토리 일관성 유지.
 */

import type { OrchestrationResult } from "./types.js";
import type { ResultEnvelope } from "./gateway-contracts.js";
import type { AgentRunResult } from "../agent/agent.types.js";
import type { InvokeLlmResult } from "../agent/node-registry.js";
import type { OrcheNodeExecuteResult } from "../agent/orche-node-executor.js";

// ── SO-2: Shared Result Contracts ───────────────────────────────

/** 모든 결과 타입의 최소 공통 계약: content + optional error. */
export type ContentResult = {
  content: string | null;
  error?: string;
};

/** 구조화된 파싱 결과를 포함하는 확장 계약. T로 파싱된 출력 타입을 좁힐 수 있음. */
export type ParsedContentResult<T = unknown> = ContentResult & {
  parsed?: T;
};

/** ContentResult 생성 헬퍼. */
export function make_content_result(content: string | null, error?: string): ContentResult {
  return error !== undefined ? { content, error } : { content };
}

/** ParsedContentResult 생성 헬퍼. */
export function make_parsed_result<T = unknown>(content: string | null, parsed?: T, error?: string): ParsedContentResult<T> {
  const base: ContentResult = error !== undefined ? { content, error } : { content };
  return parsed !== undefined ? { ...base, parsed } : base;
}

/** 에러 전용 ContentResult 생성 헬퍼. content는 항상 null. */
export function make_error_result(error: string): ContentResult {
  return { content: null, error };
}

// ── SO-1: Output Contract Inventory ─────────────────────────────

/**
 * 파이프라인 전체 결과 계약 인벤토리.
 * 타입 레벨 문서: 새 계약 추가 시 이 맵에 등록.
 *
 * 계층 구조:
 *   LlmProvider → InvokeLlmResult (ParsedContentResult 확장)
 *     ↓
 *   AgentBackend → AgentRunResult
 *     ↓
 *   OrcheNodeExecutor → OrcheNodeExecuteResult
 *     ↓
 *   OrchestrationService → OrchestrationResult
 *     ↓
 *   Gateway → ResultEnvelope (delivery 관심사)
 */
export type OutputContractMap = {
  ContentResult: ContentResult;
  ParsedContentResult: ParsedContentResult;
  InvokeLlmResult: InvokeLlmResult;
  AgentRunResult: AgentRunResult;
  OrcheNodeExecuteResult: OrcheNodeExecuteResult;
  OrchestrationResult: OrchestrationResult;
  ResultEnvelope: ResultEnvelope;
};

// ── Re-exports ──────────────────────────────────────────────────

export type { OrchestrationResult, ResultUsage } from "./types.js";
export type { ResultEnvelope, CostTier, ReplyChannelRef } from "./gateway-contracts.js";
export type { AgentRunResult, AgentFinishReason } from "../agent/agent.types.js";
export type { InvokeLlmResult } from "../agent/node-registry.js";
export type { OrcheNodeExecuteResult } from "../agent/orche-node-executor.js";
