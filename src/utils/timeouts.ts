/**
 * 도메인별 타임아웃 상수 중앙화.
 * 각 모듈에서 로컬 상수 대신 이 파일을 import한다.
 */

// ── 외부 HTTP 요청 (채널 API, 미디어 다운로드, 모델 카탈로그, 임베딩) ──
export const HTTP_FETCH_TIMEOUT_MS = 30_000;
export const HTTP_FETCH_SHORT_TIMEOUT_MS = 15_000;

// ── MCP 서버 스타트업 ──
export const MCP_STARTUP_TIMEOUT_MS = 15_000;

// ── LLM 프로바이더 요청 ──
export const LLM_REQUEST_TIMEOUT_MS = 120_000;
export const LLM_CLI_TIMEOUT_MS = 180_000;
export const LLM_PER_CALL_TIMEOUT_MS = 90_000;

// ── 에이전트 턴 ──
export const AGENT_PER_TURN_TIMEOUT_MS = 600_000;

// ── 프로세스 수명주기 ──
export const SHUTDOWN_TIMEOUT_MS = 30_000;
