/**
 * GW-4: DirectExecutor — agent 없이 수행 가능한 작업을 결정론적으로 실행.
 *
 * read-only/bounded write 도구부터 단계적으로 확장.
 * 실패 시 dispatcher가 agent/once로 폴백.
 */

import type { DirectToolPlan } from "../gateway-contracts.js";
import type { ToolExecutionContext } from "../../agent/tools/types.js";
import { error_message } from "../../utils/common.js";

/** 직접 실행 결과. */
export type DirectResult = {
  output: string;
  tool_name: string;
  error?: string;
};

/** 도구 실행 함수 시그니처 — tool-call-handler와 동일한 계약. */
export type ExecuteToolFn = (
  name: string,
  params: Record<string, unknown>,
  ctx?: ToolExecutionContext,
) => Promise<string>;

/** 직접 실행기 계약. */
export type DirectExecutorLike = {
  /** 도구가 직접 실행 정책에 허용되는지 판별. */
  is_allowed(tool_name: string): boolean;
  /** 도구를 결정론적으로 실행. LLM 호출 없음. */
  execute(plan: DirectToolPlan, execute_tool: ExecuteToolFn, ctx: ToolExecutionContext): Promise<DirectResult>;
};

/**
 * 직접 실행 허용 도구 목록.
 * read-only/bounded write부터 시작 — 점진적 확장.
 *
 * - datetime: 현재 시각/타임존 조회 (read-only)
 * - task_query: 활성 태스크 조회 (read-only)
 * - read_file: 파일 읽기 (read-only)
 * - list_dir: 디렉토리 목록 (read-only)
 * - search_files: 파일 검색 (read-only)
 * - memory: 메모리 읽기/쓰기 (bounded write)
 */
const DEFAULT_DIRECT_ALLOWED = new Set([
  "datetime",
  "task_query",
  "read_file",
  "list_dir",
  "search_files",
  "memory",
]);

/** DirectExecutor 팩토리. allowed를 주입하면 기본 목록을 대체. */
export function create_direct_executor(allowed?: ReadonlySet<string>): DirectExecutorLike {
  const allowed_tools = allowed ?? DEFAULT_DIRECT_ALLOWED;
  return {
    is_allowed(tool_name) {
      return allowed_tools.has(tool_name);
    },
    async execute(plan, execute_tool, ctx) {
      if (!allowed_tools.has(plan.tool_name)) {
        return {
          output: "",
          tool_name: plan.tool_name,
          error: `tool '${plan.tool_name}' is not allowed in direct mode`,
        };
      }
      try {
        const output = await execute_tool(plan.tool_name, plan.args ?? {}, ctx);
        return { output, tool_name: plan.tool_name };
      } catch (e) {
        return { output: "", tool_name: plan.tool_name, error: error_message(e) };
      }
    },
  };
}
