/**
 * E2: PtyOutputReducer.
 *
 * PTY 헤드리스 경로에서 AgentOutputMessage 정규화 이후 reduction 적용.
 * provider 파싱 레이어(CliAdapter)는 건드리지 않음.
 *
 * 규칙:
 *   - assistant_chunk : 크기 가드(MAX_CHUNK_CHARS)만 적용, 내용 재구성 없음
 *   - tool_result     : ToolOutputReducer.prompt_text 사용 (LLM 컨텍스트 최적화)
 *   - complete        : 매우 큰 경우에만 soft compaction (5× max_chars)
 *   - 그 외           : 원본 pass-through
 */

import type { AgentOutputMessage } from "./types.js";
import { create_tool_output_reducer, truncate_half } from "../../orchestration/tool-output-reducer.js";

/** assistant_chunk 크기 가드 상한 (10,000자). */
const MAX_CHUNK_CHARS = 10_000;

export interface PtyOutputReducer {
  /** AgentOutputMessage를 받아 reduction된 메시지를 반환. 타입은 보존. */
  reduce(msg: AgentOutputMessage): AgentOutputMessage;
}

/**
 * PtyOutputReducer 생성.
 *
 * @param max_chars  tool_result / complete의 prompt_text 기준 최대 길이 (기본 5000).
 */
export function create_pty_output_reducer(max_chars = 5_000): PtyOutputReducer {
  const tool_reducer = create_tool_output_reducer(max_chars);
  const SOFT_MAX = max_chars * 5;

  return {
    reduce(msg: AgentOutputMessage): AgentOutputMessage {
      switch (msg.type) {
        case "assistant_chunk": {
          if (msg.content.length <= MAX_CHUNK_CHARS) return msg;
          return {
            ...msg,
            content: msg.content.slice(0, MAX_CHUNK_CHARS) + "\n...[chunk size-guarded]",
          };
        }

        case "tool_result": {
          const reduced = tool_reducer.reduce({
            tool_name: msg.tool,
            params: {},
            result_text: msg.output,
            is_error: false,
          });
          if (!reduced.meta.truncated) return msg;
          return { ...msg, output: reduced.prompt_text };
        }

        case "complete": {
          if (msg.result.length <= SOFT_MAX) return msg;
          return { ...msg, result: truncate_half(msg.result, SOFT_MAX) };
        }

        default:
          return msg;
      }
    },
  };
}
