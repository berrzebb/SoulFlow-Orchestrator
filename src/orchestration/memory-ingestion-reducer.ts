/**
 * E4: MemoryIngestionReducer — memory 저장 경로용 reduction port.
 *
 * ToolOutputReducer의 storage_text projection 기준으로 텍스트를 압축.
 * noisy tool output(shell/log/test/diff/table/json)이 memory에 그대로 저장되지 않도록 함.
 */

import { create_tool_output_reducer } from "./tool-output-reducer.js";

export interface MemoryIngestionReducer {
  /** memory에 저장할 텍스트로 압축. hint는 tool_name 힌트 (선택). */
  reduce(text: string, hint?: string): string;
}

/**
 * MemoryIngestionReducer 생성.
 *
 * 텍스트 kind에 따라 retention 수준을 다르게 적용:
 *   - plain (대화형 텍스트): display_text(2×) — 맥락·reasoning 보존 우선
 *   - 그 외 noisy kind (shell/log/test/diff/json/table): storage_text(1.5×) — 핵심만 추출
 */
export function create_memory_ingestion_reducer(max_prompt_chars = 1_200): MemoryIngestionReducer {
  const reducer = create_tool_output_reducer(max_prompt_chars);
  return {
    reduce(text: string, hint = ""): string {
      if (!text) return text;
      const result = reducer.reduce({
        tool_name: hint,
        params: {},
        result_text: text,
        is_error: false,
      });
      // 대화형(plain)은 더 관대하게 보존, noisy tool output은 더 압축
      return result.kind === "plain" ? result.display_text : result.storage_text;
    },
  };
}
