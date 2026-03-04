/** 비정상 종료 이유별 사용자 경고 메시지. agent/orchestration 양쪽에서 참조. */

import type { AgentFinishReason } from "./agent.types.js";

export const FINISH_REASON_WARNINGS: Partial<Record<AgentFinishReason, string>> = {
  max_turns: "최대 턴 수에 도달하여 작업이 중단되었습니다.",
  max_budget: "예산 한도에 도달하여 작업이 중단되었습니다.",
  max_tokens: "최대 토큰 수에 도달하여 응답이 잘렸을 수 있습니다.",
  output_retries: "출력 재시도 한도에 도달했습니다.",
};
